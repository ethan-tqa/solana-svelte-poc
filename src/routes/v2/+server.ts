import type { RequestHandler } from './$types';
import { SOL_NETWORK, SOL_WALLET_PRIV } from '$env/static/private';
import { customCreateUmiKeypair } from '$lib/umi';
import { clusterApiUrl, Connection, type ParsedInstruction } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { createCollection, fetchCollection, create, transfer, transferV1, ruleSet } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { error } from '@sveltejs/kit';
import { PUBLIC_SOL_WALLET_ADDR } from '$env/static/public';

type ProdData = {
  name: string;
  productName: string;
  brand: string;
  description: string;
  external_url: string;
  image: string;
  attributes: string[];
};

function createConnection() {
  const network = SOL_NETWORK as WalletAdapterNetwork.Devnet;
  const endpoint = clusterApiUrl(network);
  const connection = new Connection(endpoint);

  return connection;
}

// use -1 for collection data.
async function fetchData(prodKey: string, tokenId: number) {
  const trimed = prodKey.trim();
  if (trimed == '') {
    throw new Error('missing prod key');
  }

  const tokenIdStr = tokenId == -1 ? 'info.json' : tokenId;
  const resp = await fetch(`https://member.auroriaverse.com/products/${prodKey}/${tokenIdStr}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const jsonStr = await resp.text();
  const data = JSON.parse(jsonStr);

  return data;
}

async function handleGetCollectionData(prodKey: string) {
  const data = await fetchData(prodKey, -1);
  return data as ProdData;
}

async function handleCreateCollection(prodKey: string): Promise<string> {
  const collectionData = await handleGetCollectionData(prodKey);

  if (!collectionData) {
    console.error('Failed to retrieve collection data');
    return '';
  }

  const connection = createConnection();
  const { umi, signer } = customCreateUmiKeypair(connection, SOL_WALLET_PRIV);

  const builder = createCollection(umi, {
    collection: signer, // yes, pass the signer in the asset field.
    name: `${collectionData.name}`,
    uri: `https://member.auroriaverse.com/products/${prodKey}/info.json`,
    plugins: [
      {
        type: 'VerifiedCreators',
        signatures: [
          {
            address: umi.identity.publicKey,
            verified: true
          }
        ]
      },
      {
        type: 'Royalties',
        basisPoints: 100,
        creators: [{ address: umi.identity.publicKey, percentage: 100 }],
        ruleSet: ruleSet('None')
      }
    ]
  });

  const { signature, result } = await builder.sendAndConfirm(umi);
  const sig = bs58.encode(signature);

  // NOTE: bs58 encode will result in a string that can be used to find the transaction in solscan/explorer.
  console.log('Create collection tx', sig);

  return sig;
}

async function handleCreateToken(prodKey: string, tokenNum: number, collectionAddr: string, receiver: string): Promise<string> {
  const collectionData = await handleGetCollectionData(prodKey);

  if (!collectionData) {
    console.error('Failed to retrieve collection data');
    return '';
  }

  const data = await fetchData(prodKey, tokenNum);
  const prodData = data as ProdData;

  if (!collectionData || !prodData) {
    console.error('Failed to retrieve token data');
    return '';
  }

  const connection = createConnection();
  const { umi, signer } = customCreateUmiKeypair(connection, SOL_WALLET_PRIV);

  const collection = await fetchCollection(umi, collectionAddr);

  const builder = create(umi, {
    asset: signer, // yes, pass the signer in the asset field.
    collection,
    name: `${collectionData.name}`,
    uri: `https://member.auroriaverse.com/products/${prodKey}/${tokenNum}`
  });

  const { signature, result } = await builder.sendAndConfirm(umi);
  const tokenSig = bs58.encode(signature);

  // NOTE: bs58 encode will result in a string that can be used to find the transaction in solscan/explorer.
  console.log('Create token tx', tokenSig, result);

  const {
    value: { blockhash, lastValidBlockHeight }
  } = await connection.getLatestBlockhashAndContext();

  const confirmResult = await connection.confirmTransaction(
    {
      blockhash,
      lastValidBlockHeight,
      signature: tokenSig
    },
    'finalized'
  );

  if (confirmResult.value.err) {
    error(400);
  }

  console.log('confrm result', confirmResult);

  // ok at this point

  const mintTransaction = await connection.getParsedTransaction(tokenSig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });

  if (mintTransaction == null) {
    // TODO a graceful way to inform the user.
    error(500);
  }

  // NOTE:
  // In the accountKeys array, the accounts that should appear are as follow (in order): 
  // 0. the minter wallet
  // 1. the newly minted NFT token
  // 2. the NFT collection address
  // 3. the Metaplex Core programm (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d)
  // 4. the System program

  const msg = mintTransaction.transaction.message;
  const tokenAddr = msg.accountKeys[1].pubkey;

  console.log('account keys', msg.accountKeys, tokenAddr);
  // console.log('instructions', msg.instructions);

  const transferBuilder = transferV1(umi, {
    asset: publicKey(tokenAddr),
    collection: publicKey(collectionAddr),
    newOwner: publicKey(receiver),
  });

  const transferResult = await transferBuilder.sendAndConfirm(umi);
  
  if (transferResult.result.value.err) {
    error(500);
  }

  console.log('transfer token tx', bs58.encode(transferResult.signature));

  return tokenSig;
}

type ReqJson = {
  create: 'collection' | 'token';
  prodKey: string;
  collectionAddr: string;
  tokenNum: number;
  transferSignature: string;
};

type TransferInfo = {
  destination: string; // public key of the receiver.
  lamports: number; // amount in lamports.
  source: string; // public key of the sender.
};

export const POST: RequestHandler = async ({ request }) => {
  const reqJson = await request.json() as ReqJson;

  let tx = '';

  // TODO This shall not be available to end users.
  if (reqJson.create == 'collection') {
    tx = await handleCreateCollection(reqJson.prodKey);
  }

  if (reqJson.create == 'token') {
    const { prodKey, tokenNum, collectionAddr, transferSignature } = reqJson;

    if (!transferSignature) {
      error(400);
    }

    // TODO: shouw we wait a second here to ensure the tx is truly finalized on the chain?
    // This is because I'm not sure how well the sdk respect our request for commitment level in the call below.
    // On client side we should be asking for finalized transaction confirmation too before calling this API endpoint.

    const connection = createConnection();
    const transferTransaction = await connection.getParsedTransaction(transferSignature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });

    // console.log('transferTransaction', transferSignature, transferTransaction);

    let transferFound: TransferInfo | undefined = undefined;

    if (transferTransaction != null) {
      const msg = transferTransaction.transaction.message;
      // console.log('account keys', msg.accountKeys);
      // console.log('instructions', msg.instructions);

      for (const instruction of msg.instructions) {
        if ('parsed' in instruction) {
          const parsedInst = instruction as ParsedInstruction;
          if (parsedInst.parsed.type == 'transfer') {
            // console.log('found transfer', parsedInst.parsed.info);
            const transferInfo = parsedInst.parsed.info as TransferInfo;

            // TODO: verify the amount and the source wallet.
            if (transferInfo.destination == PUBLIC_SOL_WALLET_ADDR) {
              transferFound = transferInfo;
            }
          }
        }
      }
    }

    console.log('solana create token transferFound=', transferFound);

    if (!transferFound) {
      error(400);
    }

    tx = await handleCreateToken(prodKey, tokenNum, collectionAddr, transferFound.source);
  }

  return new Response(tx);
};