import type { RequestHandler } from './$types';
import { SOL_NETWORK, SOL_PRIV_PHANTOM, SOL_PRIV_SOLFLARE } from '$env/static/private';
import { customCreateUmiKeypair } from '$lib/umi';
import { clusterApiUrl, Connection } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { createCollection, fetchCollection, create, ruleSet } from '@metaplex-foundation/mpl-core';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

const privKey = SOL_PRIV_PHANTOM;

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
  const { umi, signer } = customCreateUmiKeypair(connection, privKey);

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

async function handleCreateToken(prodKey: string, tokenNum: number, collectionAddr: string): Promise<string> {
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
  const { umi, signer } = customCreateUmiKeypair(connection, privKey);

  const collection = await fetchCollection(umi, collectionAddr);

  const builder = create(umi, {
    asset: signer, // yes, pass the signer in the asset field.
    collection,
    name: `${collectionData.name}`,
    uri: `https://member.auroriaverse.com/products/${prodKey}/${tokenNum}`
  });

  const { signature, result } = await builder.sendAndConfirm(umi);
  const sig = bs58.encode(signature);

  // NOTE: bs58 encode will result in a string that can be used to find the transaction in solscan/explorer.
  console.log('Create token tx', sig);

  return sig;
}

type ReqJson = {
  create: 'collection' | 'token';
  prodKey: string;
  collectionAddr: string;
  tokenNum: number;
};

export const POST: RequestHandler = async ({ request }) => {
  const reqJson = await request.json() as ReqJson;

  let tx = '';

  if (reqJson.create == 'collection') {
    tx = await handleCreateCollection(reqJson.prodKey);
  }

  if (reqJson.create == 'token') {
    const { prodKey, tokenNum, collectionAddr } = reqJson;
    tx = await handleCreateToken(prodKey, tokenNum, collectionAddr);
  }

  return new Response(tx);
};