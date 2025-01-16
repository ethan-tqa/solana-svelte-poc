<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		Adapter,
		MessageSignerWalletAdapterProps,
		SignerWalletAdapterProps,
		SignInMessageSignerWalletAdapterProps,
		WalletAdapterProps,
		WalletError,
		WalletName
	} from '@solana/wallet-adapter-base';
	import {
		BaseSignInMessageSignerWalletAdapter,
		WalletAdapterNetwork,
		WalletNotConnectedError,
		WalletNotReadyError,
		WalletReadyState,
		isWalletAdapterCompatibleStandardWallet
	} from '@solana/wallet-adapter-base';
	import { UnsafeBurnerWalletAdapter } from '@solana/wallet-adapter-wallets';
	import {
		clusterApiUrl,
		Connection,
		type ConnectionConfig,
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
	let currentPublicKey: PublicKey | undefined = undefined;

	async function connectWallet(evt: Event) {
		const el = evt.target as HTMLElement;
		const name = el.dataset.name ?? '';

		if (name == '') {
			console.warn('invalid wallet button');
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
				console.error(ad.name, err);
			});
		}
	});
</script>

<div class="flex gap-2">
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
	<div>
		{#each adapters as adapter}
			<div>
				<button onclick={connectWallet} data-name={adapter.name}>
					{adapter.name}
				</button>
			</div>
		{/each}
	</div>
</div>
