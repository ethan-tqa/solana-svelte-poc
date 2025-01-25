// import type { WalletAdapter } from '@solana/wallet-adapter-base';
// import { Connection } from '@solana/web3.js';
// import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
// import { Keypair as Web3JsKeypair, PublicKey as Web3JsPublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { createSignerFromKeypair, createUmi, generateSigner, keypairIdentity, publicKey as umiPublicKey, publicKeyBytes, resolveClusterFromEndpoint, lamports as umiLamports, dateTime as umiDateTime, ACCOUNT_HEADER_SIZE, isZeroAmount } from '@metaplex-foundation/umi';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import type {
  EddsaInterface,
  Keypair,
  Pda,
  PublicKey as UmiPublicKey,
  UmiPlugin,
  PublicKeyInput as UmiPublicKeyInput,
  Umi,
  KeypairSigner,
  Signer,
  RpcInterface,
  Cluster,
  PublicKey,
  RpcGetAccountOptions,
  MaybeRpcAccount,
  RpcGetAccountsOptions,
  RpcGetProgramAccountsOptions,
  RpcAccount,
  RpcGetBlockTimeOptions,
  DateTime,
  RpcGetBalanceOptions,
  SolAmount,
  RpcGetRentOptions,
  RpcGetSlotOptions,
  RpcGetLatestBlockhashOptions,
  BlockhashWithExpiryBlockHeight,
  TransactionSignature,
  RpcGetTransactionOptions,
  TransactionWithMeta,
  RpcAccountExistsOptions,
  RpcAirdropOptions,
  RpcCallOptions,
  Transaction,
  RpcSendTransactionOptions,
  Context,
  ProgramError,
  ErrorWithLogs,
  RpcSimulateTransactionOptions,
  RpcSimulateTransactionResult,
  RpcConfirmTransactionOptions,
  RpcConfirmTransactionResult
} from '@metaplex-foundation/umi';
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsPublicKey
} from '@metaplex-foundation/umi-web3js-adapters';
import { defaultProgramRepository } from '@metaplex-foundation/umi-program-repository';
// import { web3JsTransactionFactory } from '@metaplex-foundation/umi-transaction-factory-web3js';
import bs58 from 'bs58';

export function createWeb3JsEddsa(): EddsaInterface {
  const generateKeypair = (): Keypair => fromWeb3JsKeypair(Web3JsKeypair.generate());

  const createKeypairFromSecretKey = (secretKey: Uint8Array): Keypair =>
    fromWeb3JsKeypair(Web3JsKeypair.fromSecretKey(secretKey));

  const createKeypairFromSeed = (seed: Uint8Array): Keypair =>
    fromWeb3JsKeypair(Web3JsKeypair.fromSeed(seed));

  const isOnCurve = (input: UmiPublicKeyInput): boolean =>
    Web3JsPublicKey.isOnCurve(toWeb3JsPublicKey(umiPublicKey(input)));

  const findPda = (programId: UmiPublicKeyInput, seeds: Uint8Array[]): Pda => {
    const [key, bump] = Web3JsPublicKey.findProgramAddressSync(
      seeds,
      toWeb3JsPublicKey(umiPublicKey(programId))
    );
    return [fromWeb3JsPublicKey(key), bump] as Pda;
  };

  const sign = (message: Uint8Array, keypair: Keypair): Uint8Array =>
    ed25519.sign(message, keypair.secretKey.slice(0, 32));

  const verify = (message: Uint8Array, signature: Uint8Array, publicKey: UmiPublicKey): boolean =>
    ed25519.verify(signature, message, publicKeyBytes(publicKey));

  const createKeypairFromFile = (): Keypair => {
    throw new Error('Unsupported operation');
  };

  const createKeypairFromSolanaConfig = (): Keypair => {
    throw new Error('Unsupported operation');
  };

  return {
    generateKeypair,
    createKeypairFromSecretKey,
    createKeypairFromSeed,
    createKeypairFromFile,
    createKeypairFromSolanaConfig,
    isOnCurve,
    findPda,
    sign,
    verify
  };
}

const web3JsEddsa = (): UmiPlugin => ({
  install(umi) {
    umi.eddsa = createWeb3JsEddsa();
  }
});

import { solanaWeb3, Solana } from "@quicknode/sdk";

function createQuicknodeRpc(context: Pick<Context, 'programs' | 'transactions'>, endpoint: string): RpcInterface {

  const _solana = new Solana({
    endpointUrl: endpoint
  });

  // umi to quicknode
  const convertPublicKey = (publicKey: PublicKey) : solanaWeb3.PublicKey => {
    return new solanaWeb3.PublicKey(publicKey.__publicKey);
  }

  /** The RPC endpoint used by the client. */
  const getEndpoint = (): string => {
    return _solana.endpointUrl;
  }

  /** The Solana cluster of the RPC being used. */
  const getCluster = (): Cluster => {
    const cluster = resolveClusterFromEndpoint(_solana.endpointUrl);
    return cluster;
  }

  const parseMaybeRentEpoch = (val: number | undefined): bigint | undefined => {
    return val ? BigInt(val) : undefined;
  }

  const parseMaybeAccount = (publicKey: PublicKey, info: solanaWeb3.AccountInfo<Buffer> | null): MaybeRpcAccount => {
    if (info) {
      return {
        exists: true,
        data: info.data,
        executable: info.executable,
        lamports: umiLamports(info.lamports),
        owner: umiPublicKey(info.owner.toString()),
        publicKey,
        rentEpoch: parseMaybeRentEpoch(info.rentEpoch),
      }
    } else {
      return {
        exists: false,
        publicKey,
      }
    }
  }

  /**
   * Fetch a raw account at the given address.
   *
   * @param publicKey The public key of the account to fetch.
   * @param options The options to use when fetching the account.
   * @returns A raw account that may or may not exist.
   */
  const getAccount = async (publicKey: PublicKey, options?: RpcGetAccountOptions): Promise<MaybeRpcAccount> => {
    const pk = convertPublicKey(publicKey);

    // TODO options
    const info = await _solana.connection.getAccountInfo(pk, {});
    return parseMaybeAccount(publicKey, info);
  }

  /**
   * Fetch multiple raw accounts at the given addresses.
   *
   * @param publicKey The public keys of the accounts to fetch.
   * @param options The options to use when fetching multiple accounts.
   * @returns An array of raw accounts that may or may not exist.
   */
  const getAccounts = async (publicKeys: PublicKey[], options?: RpcGetAccountsOptions): Promise<MaybeRpcAccount[]> => {
    const pks = publicKeys.map(convertPublicKey);

    const infos = await _solana.connection.getMultipleAccountsInfo(pks, {});
    const results = infos.map((info, idx) => parseMaybeAccount(publicKeys[idx], info));

    return results;
  }

  const parseAccount = (publicKey: PublicKey, account: solanaWeb3.AccountInfo<Buffer>): RpcAccount => {
    return {
      data: account.data,
      executable: account.executable,
      lamports: umiLamports(account.lamports),
      owner: umiPublicKey(account.owner.toString()),
      publicKey,
      rentEpoch: parseMaybeRentEpoch(account.rentEpoch),
    }
  }

  /**
   * Fetch multiple raw accounts from a program.
   *
   * @param programId The public key of the program to fetch accounts from.
   * @param options The options to use when fetching program accounts.
   * @returns An array of raw accounts.
   */
  const getProgramAccounts = async (programId: PublicKey, options?: RpcGetProgramAccountsOptions): Promise<RpcAccount[]> => {
    const pk = convertPublicKey(programId);

    // TODO options
    const accounts = await _solana.connection.getProgramAccounts(pk, {});
    const results = accounts.map(acc => parseAccount(programId, acc.account));

    return results;
  }

  /**
   * Fetch the estimated production time of a block.
   *
   * @param slot The slot to get the estimated production time for.
   * @param options The options to use when getting the block time of a slot.
   * @returns The estimated production time of the block in Unix time.
   */
  const getBlockTime = async (slot: number, options?: RpcGetBlockTimeOptions): Promise<DateTime | null> => {
    const blockTime = await _solana.connection.getBlockTime(slot);
    return blockTime ? umiDateTime(blockTime) : null;
  }

  /**
   * Fetch the balance of an account.
   *
   * @param publicKey The public key of the account.
   * @param options The options to use when fetching an account's balance.
   * @returns An amount of SOL.
   */
  const getBalance = async (publicKey: PublicKey, options?: RpcGetBalanceOptions): Promise<SolAmount> => {
    const pk = convertPublicKey(publicKey);
    const amount = await _solana.connection.getBalance(pk);
    return umiLamports(amount);
  }

  /**
   * Get the genesis hash.
   *
   * @returns The genesis hash.
   */
  const getGenesisHash = async (): Promise<string> => {
    const hash = await _solana.connection.getGenesisHash();
    return hash;
  }


  /**
   * Get the amount of rent-exempt SOL required to create an account of the given size.
   *
   * @param bytes The size of the account in bytes.
   * @param options The options to use when fetching the rent exempt amount.
   * @returns An amount of SOL.
   */
  const getRent = async (bytes: number, options?: RpcGetRentOptions): Promise<SolAmount> => {
    const rentFor = (bytes: number) => {
      return _solana.connection.getMinimumBalanceForRentExemption(bytes, options?.commitment);
    }

    if (options?.includesHeaderBytes ?? false) {
      const headerRent = await rentFor(0);
      const rentPerByte = BigInt(headerRent) / BigInt(ACCOUNT_HEADER_SIZE);
      return umiLamports(rentPerByte * BigInt(bytes));
    }

    return umiLamports(await rentFor(bytes));
  }

  /**
   * Fetch the recent slot.
   *
   * @param options The options to use when fetching the recent slot.
   * @returns The recent slot.
   */
  const getSlot = async (options?: RpcGetSlotOptions): Promise<number> => {
    // TODO options
    return await _solana.connection.getSlot();
  }

  /**
   * Fetch the latest blockhash.
   *
   * @param options The options to use when fetching the latest blockhash.
   * @returns The latest blockhash and its block height.
   */
  const getLatestBlockhash = async (options?: RpcGetLatestBlockhashOptions): Promise<BlockhashWithExpiryBlockHeight> => {
    // TODO options
    return await _solana.connection.getLatestBlockhash();
  }

  /**
   * Fetch a transaction by its signature.
   *
   * @param signature The signature of the transaction to fetch.
   * @param options The options to use when fetching transactions.
   * @returns A transaction with its metadata or `null` if the transaction was not found.
   */
  const getTransaction = async (signature: TransactionSignature, options?: RpcGetTransactionOptions): Promise<TransactionWithMeta | null> => {
    const response = await _solana.connection.getTransaction(bs58.encode(signature), { commitment: options?.commitment as 'confirmed' | 'finalized' | undefined, maxSupportedTransactionVersion: 0 });
    
    if (!response) {
      return null;
    }

    if (!response.meta) {
      // TODO: Custom error.
      throw new Error('Transaction meta is missing.');
    }
  }

  /**
   * Fetch transaction commitments from an array of signatures.
   *
   * @param signatures The signatures of all transactions we want to fetch commitments for.
   * @param options The options to use when fetching transaction commitments.
   * @returns An array of transaction statuses in the same order as the signatures.
   * If a transaction was not found, `null` will be returned instead.
   */
  getSignatureStatuses(signatures: TransactionSignature[], options ?: RpcGetSignatureStatusesOptions): Promise<Array<TransactionStatus | null>>;

  /**
   * Whether or not an account at a given address exists.
   *
   * @param publicKey The public key of the account.
   * @param options The options to use when checking if an account exists.
   * @returns `true` if the account exists, `false` otherwise.
   */
  const accountExists = async (publicKey: PublicKey, options ?: RpcAccountExistsOptions): Promise<boolean> => {
    const balance = await getBalance(publicKey, options);
    return !isZeroAmount(balance);
  }

  /**
   * Send and confirm an airdrop transaction to the given address.
   *
   * @param publicKey The public key of the account to airdrop to.
   * @param amount The amount of SOL to airdrop.
   * @param options The options to use when airdropping SOL.
   */
  const airdrop = async (publicKey: PublicKey, amount: SolAmount, options ?: RpcAirdropOptions): Promise<void> => {
    const pk = new solanaWeb3.PublicKey(publicKey.__publicKey);
    const sign = await _solana.connection.requestAirdrop(pk, Number(amount.basisPoints));

    if (options?.strategy) {
      // TODO
    }

    await ;
  }

  /**
   * Send a custom RPC request to the node.
   *
   * @param method The method to call.
   * @param params The parameters to pass to the method.
   * @param options The options to use when sending a custom RPC request.
   * @returns The generic result of the RPC call.
   */
  const call = async < R, P extends any[] = any[] > (method: string, params ?: [...P], options ?: RpcCallOptions): Promise<R> => {
    throw new Error('call is not supported');
  }
  
  /**
   * Send a transaction to the blockchain.
   *
   * @param transaction The transaction to send.
   * @param options The options to use when sending a transaction.
   * @returns The signature of the sent transaction.
   */
  const sendTransaction = async (transaction: Transaction, options ?: RpcSendTransactionOptions): Promise<TransactionSignature> => {
    try {
      const signature = await _solana.connection.sendRawTransaction(
        context.transactions.serialize(transaction),
        options
      );
      return bs58.decode(signature);
    } catch (error: any) {
      let resolvedError: ProgramError | null = null;
      if (error instanceof Error && 'logs' in error) {
        resolvedError = context.programs.resolveError(
          error as ErrorWithLogs,
          transaction
        );
      }
      throw resolvedError || error;
    }
  }
  
  /**
   * Simulate a transaction.
   *
   * @param transaction The transaction to simulate.
   * @param options The options to use when simulating a transaction.
   * @returns The signature of the sent transaction.
   */
  const simulateTransaction = async (transaction: Transaction, options ?: RpcSimulateTransactionOptions): Promise<RpcSimulateTransactionResult> => {
    try {
      const tx = toWeb3JsTransaction(transaction);

      // TODO convert the transaction type.
      const result = await _solana.connection.simulateTransaction(tx, {
        sigVerify: options?.verifySignatures,
        accounts: {
          addresses: options?.accounts || [],
          encoding: 'base64',
        },
      });
      return result.value;
    } catch (error: any) {
      let resolvedError: ProgramError | null = null;
      if (error instanceof Error && 'logs' in error) {
        resolvedError = context.programs.resolveError(
          error as ErrorWithLogs,
          transaction
        );
      }
      throw resolvedError || error;
    }
  }


  function parseConfirmStrategy(
    signature: TransactionSignature,
    options: RpcConfirmTransactionOptions
  ): solanaWeb3.TransactionConfirmationStrategy {
    if (options.strategy.type === 'blockhash') {
      return {
        ...options.strategy,
        signature: bs58.encode(signature),
      };
    }
    return {
      ...options.strategy,
      signature: bs58.encode(signature),
      nonceAccountPubkey: toWeb3JsPublicKey(options.strategy.nonceAccountPubkey),
    };
  }

  /**
   * Confirm a sent transaction.
   *
   * @param signature The signature of the transaction to confirm.
   * @param options The options to use when confirming a transaction.
   * @returns The RPC response of the transaction confirmation.
   */
  const confirmTransaction = async (signature: TransactionSignature, options: RpcConfirmTransactionOptions): Promise<RpcConfirmTransactionResult> => {
    await _solana.connection.confirmTransaction();
  }

  return {
    getEndpoint,
    getCluster,
    getAccount,
    getAccounts,
    getProgramAccounts,
    getBlockTime,
    getGenesisHash,
    getBalance,
    getRent,
    getSlot,
    getLatestBlockhash,
    getTransaction,
    getSignatureStatuses,
    accountExists,
    airdrop,
    call,
    sendTransaction,
    simulateTransaction,
    confirmTransaction,
  }
}

const quicknodeRpc = (endpoint: string): UmiPlugin => ({
  install(umi) {
    umi.rpc = createQuicknodeRpc(umi, endpoint);
  },
})

export type UmiResult = {
  umi: Umi;
  signer: Signer;
};

// custom version for the server side that works with Cloudflare workers where using node types is a huge problem.

export const createUmiServer = (endpoint: string, secretKey: string): UmiResult => {
  const umi = createUmi().use(web3JsEddsa()).use(quicknodeRpc(endpoint)).use(defaultProgramRepository()).use(web3JsTransactionFactory());
  const secretKeyBytes = bs58.decode(secretKey);
  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKeyBytes);
  umi.use(keypairIdentity(keypair));
  const signer = generateSigner(umi);

  return { umi, signer };
};
