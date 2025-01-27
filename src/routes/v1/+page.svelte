<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		Adapter,
		MessageSignerWalletAdapterProps,
		SignerWalletAdapterProps,
		WalletAdapterProps,
		WalletError,
		WalletName
	} from '@solana/wallet-adapter-base';
	import {
		WalletAdapterNetwork,
		WalletNotConnectedError,
		WalletNotReadyError,
		WalletReadyState,
		isWalletAdapterCompatibleStandardWallet
	} from '@solana/wallet-adapter-base';
	import {
		clusterApiUrl,
		Connection,
		PublicKey,
		Transaction,
		TransactionInstruction,
		type TransactionSignature
	} from '@solana/web3.js';
	import { getWallets } from '@wallet-standard/app';
	import { StandardWalletAdapter } from '@solana/wallet-standard-wallet-adapter-base';
	import { ed25519 } from '@noble/curves/ed25519';
	import bs58 from 'bs58';
	import {
		createCollection,
		create,
		ruleSet,
		fetchCollection
	} from '@metaplex-foundation/mpl-core';
	import { customCreateUmi, customCreateUmiKeypair } from '$lib/umi';

	type ProdData = {
		name: string;
		productName: string;
		brand: string;
		description: string;
		external_url: string;
		image: string;
		attributes: string[];
	};

	const network = WalletAdapterNetwork.Devnet;
	const endpoint = clusterApiUrl(network);
	let connection: Connection;

	let adapters: Adapter[] = [];
	let connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
	let currentWallet: Adapter | undefined = undefined;
	let currentPublicKey: PublicKey | undefined = undefined;

	let prodKey = 'ksng_eclatdiamante';
	let collectionData: ProdData | undefined = undefined;
	let prodData: ProdData | undefined = undefined;
	let collectionAddr = '';
	let tokenNum = '';

	// use -1 for collection data.
	async function fetchData(tokenId: number) {
		const trimed = prodKey.trim();
		if (trimed == '') {
			console.error('missing prod key');
			return;
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

		console.log('fetched product data', data);

		return data;
	}

	async function handleGetCollectionData() {
		const data = await fetchData(-1);
		collectionData = data as ProdData;
	}

	async function handleCreateCollection() {
		if (!currentWallet || connectionStatus != 'connected') {
			console.error('No wallet connected');
			return;
		}

		if (!currentWallet.publicKey) {
			throw new Error('Wallet missing publickey');
		}

		if (!collectionData) {
			await handleGetCollectionData();
		}

		if (!collectionData) {
			console.error('missing product data');
			return;
		}

		const { umi, signer } = customCreateUmi(connection, currentWallet);

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

		console.log('createCollection result', signature, result);
		const sig = bs58.encode(signature);

		// NOTE: bs58 encode will result in a string that can be used to find the transaction in solscan/explorer.
		console.log('create asset result', sig, result);

		collectionAddr = sig;
	}

	async function handleCreateToken() {
		if (!currentWallet || connectionStatus != 'connected') {
			console.error('No wallet connected');
			return;
		}

		if (!collectionData) {
			await handleGetCollectionData();
		}

		if (!collectionData) {
			console.error('missing product data');
			return;
		}

		const data = await fetchData(parseInt(tokenNum));
		prodData = data as ProdData;

		if (!collectionData || !prodData) {
			console.error('missing collection/product data');
			return;
		}

		const {umi, signer} = customCreateUmi(connection, currentWallet);

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
		console.log('create asset result', sig, result);
	}

	async function handleConnectWallet(evt: Event) {
		const el = evt.target as HTMLElement;
		const name = el.dataset.name ?? '';

		if (name == '') {
			console.error('invalid wallet button');
			return;
		}

		const found = adapters.find((ad) => ad.name === name);
		if (found == null) {
			console.error('No wallet found', name);
			return;
		}

		if (currentWallet != null) {
			await currentWallet.disconnect();
		}

		currentWallet = found;

		if (
			currentWallet.readyState !== WalletReadyState.Installed &&
			currentWallet.readyState != WalletReadyState.Loadable
		) {
			// TODO throw?
			return;
		}

		connectionStatus = 'connecting';

		try {
			// The *ACTUAL* connection call. This will trigger the wallet browser extension to popup with a prompt.
			// Note that Phantom wallet seems to silently accept after the first connection.
			// Solflare would not do that unless user tick the "Auto-connect" box in its prompt.
			await currentWallet.connect();
			connectionStatus = 'connected';
		} catch (error) {
			connectionStatus = 'disconnected';
		}
	}

	async function handleDisconnect() {
		if (!currentWallet || connectionStatus != 'connected') {
			console.error('Invalid connection status', connectionStatus, currentWallet);
			return;
		}

		await currentWallet.disconnect();
	}

	async function handleSignMessage() {
		if (connectionStatus != 'connected' || !currentWallet || !currentPublicKey) {
			console.error('Wallet not connected');
			return;
		}

		const msg = new TextEncoder().encode(`What's up homie? ${Date.now()}`);
		const sig = await signMessage(msg);

		// console.log('signature', sig);

		if (!ed25519.verify(sig, msg, currentPublicKey.toBytes())) {
			console.error('Invalid signature!');
		}

		const sigStr = bs58.encode(sig);
		console.log('Signature', sigStr);
	}

	// This will send a legacy type transaction
	async function handleSendTransaction() {
		if (connectionStatus != 'connected' || !currentWallet || !currentPublicKey) {
			console.error('Wallet not connected');
			return;
		}

		let signature: TransactionSignature | undefined = undefined;

		try {
			const {
				context: { slot: minContextSlot },
				value: { blockhash, lastValidBlockHeight }
			} = await connection.getLatestBlockhashAndContext();
			const transaction = new Transaction({
				feePayer: currentPublicKey,
				blockhash,
				lastValidBlockHeight
			}).add(
				new TransactionInstruction({
					data: Buffer.from('Hey there'),
					keys: [],
					programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
				})
			);

			signature = await sendTransaction(transaction, connection, { minContextSlot });
			console.log('Transaction sent', signature);

			await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
			console.log('Transaction successful', signature);
		} catch (err) {
			console.error('Transaction failed', err, signature);
		}
	}

	// Not sure what is the purpose of this. Offline signing? Hardware device?
	// https://solana.stackexchange.com/a/548
	async function handleSignTransaction() {
		if (connectionStatus != 'connected' || !currentWallet || !currentPublicKey) {
			console.error('Wallet not connected');
			return;
		}

		try {
			const {
				context: { slot: minContextSlot },
				value: { blockhash, lastValidBlockHeight }
			} = await connection.getLatestBlockhashAndContext();

			const transaction = new Transaction({
				feePayer: currentPublicKey,
				blockhash,
				lastValidBlockHeight
			}).add(
				new TransactionInstruction({
					data: Buffer.from('Hello'),
					keys: [],
					programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
				})
			);

			const transaction2 = await signTransaction(transaction);
			if (!transaction2.signature) {
				console.error('Transaction was not signed');
				return;
			}

			const sig = bs58.encode(transaction2.signature);

			console.log('Transaction signed', sig);

			if (!transaction2.verifySignatures()) {
				console.error('Invalid transaction signature', sig);
			} else {
				console.log('Transaction signature is valid', sig);
			}
		} catch (err) {
			console.error('Transaction sign failed', err);
		}
	}

	const sendTransaction: WalletAdapterProps['sendTransaction'] = async (
		transaction,
		connection,
		options
	) => {
		if (!currentWallet || connectionStatus != 'connected') {
			throw new Error('No wallet connected');
		}

		return await currentWallet.sendTransaction(transaction, connection, options);
	};

	const signTransaction: SignerWalletAdapterProps['signTransaction'] = async (transaction) => {
		if (currentWallet && 'signTransaction' in currentWallet) {
			// TODO check connected.
			return await currentWallet.signTransaction(transaction);
		}

		throw new Error('Invalid wallet');
	};

	const signMessage: MessageSignerWalletAdapterProps['signMessage'] = async (message) => {
		if (currentWallet && 'signMessage' in currentWallet) {
			// TODO check connected.
			return await currentWallet.signMessage(message);
		}

		throw new Error('Invalid wallet');
	};

	// Do I even need this function?
	function handleReadyStateChanged(this: Adapter, readyState: WalletReadyState) {
		console.log('handleReadyStateChanged', this.name, readyState);
	}

	onMount(() => {
		connection = new Connection(endpoint);

		// This is the first entry point, call the function below to get an object which contains a function to get all available wallets.
		// Very weird API design.
		const walletGetter = getWallets();
		const allAdapters = walletGetter.get();

		// probably for dealing with extensions being added or removed while app is running.
		walletGetter.on('register', (wallets) => {
			console.log('huh register', wallets);
		});

		// probably for dealing with extensions being added or removed while app is running.
		walletGetter.on('unregister', (wallets) => {
			console.log('huh unregister', wallets);
		});

		// Only take compatible ones.
		// Then have to wrap them in a standard interface.
		// Then remove unsupported wallets.
		adapters = allAdapters
			.filter(isWalletAdapterCompatibleStandardWallet)
			.map((wallet) => new StandardWalletAdapter({ wallet }))
			.filter((ad) => ad.readyState != WalletReadyState.Unsupported);

		// At this point, on the browser with Solana wallet extensions, I will be able to see their names, like Phantom or Solflare.
		for (const ad of adapters) {
			console.log('found wallet', ad.name);

			ad.on('readyStateChange', handleReadyStateChanged, ad);

			ad.on('connect', (pubKey) => {
				console.log('connect', ad.name, pubKey);
				currentWallet = ad;
				currentPublicKey = pubKey;
			});

			ad.on('disconnect', () => {
				console.log('disconnect', ad.name);
				currentWallet = undefined;
				currentPublicKey = undefined;
			});

			ad.on('error', (err) => {
				// Somehow wallet disconnecting can trigger an error? WalletDisconnectedError
				console.error(ad.name, err);
			});
		}
	});
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-2">
		<div>Basic ops</div>
		<div>
			<button
				class="border px-2 py-1"
				onclick={handleDisconnect}
				disabled={connectionStatus != 'connected'}>Disconnect</button
			>
			<button
				class="border px-2 py-1"
				onclick={handleSignMessage}
				disabled={connectionStatus != 'connected'}>Sign Msg</button
			>
			<button
				class="border px-2 py-1"
				onclick={handleSendTransaction}
				disabled={connectionStatus != 'connected'}>Send Transaction</button
			>
			<button
				class="border px-2 py-1"
				onclick={handleSignTransaction}
				disabled={connectionStatus != 'connected'}>Sign Transaction</button
			>
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<div>MPL Core</div>
		<div class="flex gap-2">
			<span>Product key </span><input bind:value={prodKey} type="text" class="border px-2" />
		</div>
		<div class="flex gap-2">
			<span>Token # </span><input bind:value={tokenNum} type="number" class="border px-2" />
		</div>
		<div class="flex gap-2">
			<span>Collection Addr </span><input
				bind:value={collectionAddr}
				type="text"
				class="border px-2"
			/>
		</div>

		<div class="flex gap-2">
			<button class="border px-2 py-1" onclick={handleGetCollectionData}>Get collection data</button
			>
			<button
				class="border px-2 py-1"
				onclick={handleCreateCollection}
				disabled={connectionStatus != 'connected'}>Create collection</button
			>
			<button
				class="border px-2 py-1"
				onclick={handleCreateToken}
				disabled={connectionStatus != 'connected'}>Create token</button
			>
		</div>
	</div>

	<div class="">
		Active wallet:
		{#if currentWallet === undefined}
			None
		{:else}
			{currentWallet.name}
		{/if}
	</div>

	<div class="flex gap-2">
		<div>Select a wallet to connect</div>
		<div class="flex gap-2">
			{#each adapters as adapter}
				<button class="border px-2 py-1" onclick={handleConnectWallet} data-name={adapter.name}>
					{adapter.name}
				</button>
			{/each}
		</div>
	</div>
</div>
