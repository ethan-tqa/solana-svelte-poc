import type {
  WalletAdapter
} from '@solana/wallet-adapter-base';
import {
  Connection
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { createUmi, publicKey, publicKeyBytes } from '@metaplex-foundation/umi';
// import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
import type {
  EddsaInterface,
  Keypair,
  Pda,
  PublicKey as UmiPublicKey,
  UmiPlugin,
  PublicKeyInput as UmiPublicKeyInput,
  Umi
} from '@metaplex-foundation/umi';
import {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsPublicKey
} from '@metaplex-foundation/umi-web3js-adapters';
import { defaultProgramRepository } from '@metaplex-foundation/umi-program-repository';
import { web3JsTransactionFactory } from '@metaplex-foundation/umi-transaction-factory-web3js';

import { Keypair as Web3JsKeypair, PublicKey as Web3JsPublicKey } from '@solana/web3.js';

export function createWeb3JsEddsa(): EddsaInterface {
  const generateKeypair = (): Keypair => fromWeb3JsKeypair(Web3JsKeypair.generate());

  const createKeypairFromSecretKey = (secretKey: Uint8Array): Keypair =>
    fromWeb3JsKeypair(Web3JsKeypair.fromSecretKey(secretKey));

  const createKeypairFromSeed = (seed: Uint8Array): Keypair =>
    fromWeb3JsKeypair(Web3JsKeypair.fromSeed(seed));

  const isOnCurve = (input: UmiPublicKeyInput): boolean =>
    Web3JsPublicKey.isOnCurve(toWeb3JsPublicKey(publicKey(input)));

  const findPda = (programId: UmiPublicKeyInput, seeds: Uint8Array[]): Pda => {
    const [key, bump] = Web3JsPublicKey.findProgramAddressSync(
      seeds,
      toWeb3JsPublicKey(publicKey(programId))
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

// Have to do this myself because some idiots think that it is totally reasonable to include fs usage in client side library.
export const customCreateUmi = (connection: Connection, wallet: WalletAdapter): Umi => {
  const umi = createUmi().use(web3JsEddsa()).use(web3JsRpc(connection)).use(walletAdapterIdentity(wallet)).use(defaultProgramRepository()).use(web3JsTransactionFactory());
  return umi;
};