<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		Adapter,
		MessageSignerWalletAdapterProps,
		SignerWalletAdapterProps,
		WalletAdapterProps	} from '@solana/wallet-adapter-base';
	import {
		WalletAdapterNetwork,
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

	const network = WalletAdapterNetwork.Devnet;
	const endpoint = clusterApiUrl(network);
	let connection: Connection;

	let adapters: Adapter[] = [];
	let connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'disconnecting';
	let currentWallet: Adapter | undefined = undefined;

	let prodKey = 'ksng_acidlush';
	let collectionAddr = '';
	let tokenNum = '';

	async function handleCreateCollection() {
		if (!currentWallet || connectionStatus != 'connected') {
			console.error('No wallet connected');
			return;
		}

		if (!currentWallet.publicKey) {
			throw new Error('Wallet missing publickey');
		}
		
		const tx = await fetch('/v2', {
			method: 'post', 
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				create: 'collection',
				prodKey,
			}),
		});

		console.log('handleCreateCollection tx', tx);
	}

	async function handleCreateToken() {
		if (!currentWallet || connectionStatus != 'connected') {
			console.error('No wallet connected');
			return;
		}

		if (!collectionAddr) {
			throw new Error('invalid collection addr');
		}

		if (!tokenNum) {
			throw new Error('invalid token num');
		}

		const tx = await fetch('/v2', {
			method: 'post', 
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				create: 'token',
				prodKey,
				collectionAddr,
				tokenNum
			}),
		});

		console.log('handleCreateCollection tx', tx);
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
		if (connectionStatus != 'connected' || !currentWallet || !currentWallet.publicKey) {
			console.error('Wallet not connected');
			return;
		}

		const msg = new TextEncoder().encode(`What's up homie? ${Date.now()}`);
		const sig = await signMessage(msg);

		// console.log('signature', sig);

		if (!ed25519.verify(sig, msg, currentWallet.publicKey.toBytes())) {
			console.error('Invalid signature!');
		}

		const sigStr = bs58.encode(sig);
		console.log('Signature', sigStr);
	}

	// This will send a legacy type transaction
	async function handleSendTransaction() {
		if (connectionStatus != 'connected' || !currentWallet || !currentWallet.publicKey) {
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
				feePayer: currentWallet.publicKey,
				blockhash,
				lastValidBlockHeight
			}).add(
				new TransactionInstruction({
					data: Buffer.from('Hello from v2'),
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
		if (connectionStatus != 'connected' || !currentWallet || !currentWallet.publicKey) {
			console.error('Wallet not connected');
			return;
		}

		try {
			const {
				context: { slot: minContextSlot },
				value: { blockhash, lastValidBlockHeight }
			} = await connection.getLatestBlockhashAndContext();

			const transaction = new Transaction({
				feePayer: currentWallet.publicKey,
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
				console.log('connect', ad.name, pubKey, ad.publicKey == pubKey);
				currentWallet = ad;
			});

			ad.on('disconnect', () => {
				console.log('disconnect', ad.name);
				currentWallet = undefined;
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
