<script lang="ts">
	/**
	 * Bar across the top of the editor: everything that concerns the animation
	 * as a whole. The File menu loads, saves and clears it, the Examples menu
	 * offers ready-made ones, and the buttons on the right are the ways to
	 * get it out of the editor.
	 */

	import { resolve } from '$app/paths';
	import type { AnimationStore } from '../animation.svelte';
	import { EXAMPLES, type Example } from '../examples';
	import { downloadAnimation, uploadAnimation } from '../json_io';
	import { encodeAnimation } from '../url_state';
	import EmbedDialog from './EmbedDialog.svelte';
	import Icon from './Icon.svelte';
	import VideoDialog from './VideoDialog.svelte';

	let {
		store,
		canUndo,
		canRedo,
		onUndo,
		onRedo
	}: {
		store: AnimationStore;
		canUndo: boolean;
		canRedo: boolean;
		onUndo: () => void;
		onRedo: () => void;
	} = $props();

	/** The key that goes with Z for undo: ⌘ on a Mac, Ctrl elsewhere. */
	const MOD =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

	let fileInput: HTMLInputElement;
	let menuEl = $state<HTMLDetailsElement | undefined>(undefined);
	let examplesEl = $state<HTMLDetailsElement | undefined>(undefined);
	let importError = $state<string | null>(null);
	// Embed and video share the space below the bar, so only one is open.
	let panel = $state<'embed' | 'video' | null>(null);

	// Status flash for the share-link copy result. The two dialogs each have
	// their own internal "Copied" badge state.
	let status = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	function flash(tone: 'ok' | 'err', text: string) {
		status = { tone, text };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => (status = null), 1800);
	}

	function closeMenu() {
		if (menuEl) menuEl.open = false;
		if (examplesEl) examplesEl.open = false;
	}

	function onExport() {
		closeMenu();
		downloadAnimation(store.toAnimation());
	}
	function onImportClick() {
		closeMenu();
		importError = null;
		fileInput.click();
	}
	async function onImportChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const anim = await uploadAnimation(file);
			store.loadFromAnimation(anim);
		} catch (err) {
			importError = err instanceof Error ? err.message : String(err);
		} finally {
			input.value = '';
		}
	}
	function onLoadExample(example: Example) {
		closeMenu();
		store.loadFromAnimation(example.animation);
	}
	function onClear() {
		closeMenu();
		if (store.keyframes.length > 0 && !confirm('Discard the current animation and start over?')) {
			return;
		}
		store.reset();
	}

	async function onShare() {
		const url = `${window.location.origin}${resolve('/')}#kf=${encodeAnimation(store.toAnimation())}`;
		try {
			await navigator.clipboard.writeText(url);
			flash('ok', 'Share link copied');
		} catch {
			flash('err', 'Could not copy link');
		}
	}
	function togglePanel(which: 'embed' | 'video') {
		panel = panel === which ? null : which;
	}

	function handleDocClick(e: MouseEvent) {
		// A click anywhere else closes a menu — also a click on the other menu.
		for (const el of [menuEl, examplesEl]) {
			if (el?.open && !el.contains(e.target as Node)) el.open = false;
		}
	}

	$effect(() => {
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});

	const hasKeyframes = $derived(store.keyframes.length > 0);
	// The panels describe the current animation; without one there is nothing to show.
	const openPanel = $derived(hasKeyframes ? panel : null);
</script>

<header class="topbar">
	<h1 title="Drop keyframes on a map, hit play.">Map Animator</h1>

	<details bind:this={menuEl} class="dropdown file-menu">
		<summary>File <span class="caret"><Icon name="caret" size={12} /></span></summary>
		<div class="menu" role="menu">
			<button type="button" role="menuitem" onclick={onImportClick}
				><Icon name="import" /> Import JSON</button
			>
			<button type="button" role="menuitem" onclick={onExport} disabled={!hasKeyframes}>
				<Icon name="export" /> Export JSON
			</button>
			<hr />
			<button type="button" role="menuitem" onclick={onClear} disabled={!hasKeyframes}>
				<Icon name="trash" /> Clear
			</button>
		</div>
	</details>

	<details bind:this={examplesEl} class="dropdown examples-menu">
		<summary>Examples <span class="caret"><Icon name="caret" size={12} /></span></summary>
		<div class="menu" role="menu">
			{#each EXAMPLES as example (example.id)}
				<button
					type="button"
					role="menuitem"
					title={example.description}
					onclick={() => onLoadExample(example)}
				>
					<Icon name="star" />
					{example.title}
				</button>
			{/each}
		</div>
	</details>

	<div class="history" role="group" aria-label="Undo and redo">
		<button
			type="button"
			onclick={onUndo}
			disabled={!canUndo}
			aria-label="Undo"
			title="Undo ({MOD}Z)"
		>
			<Icon name="undo" />
		</button>
		<button
			type="button"
			onclick={onRedo}
			disabled={!canRedo}
			aria-label="Redo"
			title="Redo ({MOD === '⌘' ? '⇧⌘Z' : 'Ctrl+Y'})"
		>
			<Icon name="redo" />
		</button>
	</div>

	<div class="spacer"></div>

	{#if status}
		<span class="status" class:ok={status.tone === 'ok'} class:err={status.tone === 'err'}>
			<Icon name={status.tone === 'ok' ? 'check' : 'close'} size={12} />
			{status.text}
		</span>
	{/if}

	<div class="outputs" role="group" aria-label="Share and export">
		<button
			type="button"
			onclick={onShare}
			disabled={!hasKeyframes}
			title="Copy a link that opens this animation in the editor"
		>
			<Icon name="link" /> Share link
		</button>
		<button
			type="button"
			class:active={openPanel === 'embed'}
			aria-expanded={openPanel === 'embed'}
			onclick={() => togglePanel('embed')}
			disabled={!hasKeyframes}
			title="Get an iframe snippet for your own page"
		>
			<Icon name="embed" /> Embed…
		</button>
		<button
			type="button"
			class:active={openPanel === 'video'}
			aria-expanded={openPanel === 'video'}
			onclick={() => togglePanel('video')}
			disabled={!hasKeyframes}
			title="Get the command that renders this animation to a video file"
		>
			<Icon name="video" /> Export video…
		</button>
	</div>

	<input
		bind:this={fileInput}
		type="file"
		accept="application/json,.json"
		onchange={onImportChange}
		hidden
	/>
</header>

{#if importError}
	<div class="import-error" role="alert">
		<span>Import failed: {importError}</span>
		<button type="button" onclick={() => (importError = null)} aria-label="Dismiss"
			><Icon name="close" /></button
		>
	</div>
{/if}

{#if openPanel === 'embed'}
	<EmbedDialog {store} onClose={() => (panel = null)} />
{:else if openPanel === 'video'}
	<VideoDialog {store} onClose={() => (panel = null)} />
{/if}

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	h1 {
		margin: 0 0.25rem 0 0;
		font-size: 1.05rem;
		white-space: nowrap;
	}
	.spacer {
		flex: 1 1 auto;
	}
	.history,
	.outputs {
		display: flex;
		gap: 0.25rem;
	}
	button,
	summary {
		padding: 0.4rem 0.7rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;

		&:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.12);
			border-color: #4a9eff;
		}
		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
		&.active {
			background: rgba(74, 158, 255, 0.2);
			border-color: #4a9eff;
			color: #fff;
		}
	}

	.status {
		font-size: 12px;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;

		&.ok {
			background: rgba(80, 200, 120, 0.18);
			border: 1px solid #4ac888;
			color: #b6f0c9;
		}
		&.err {
			background: rgba(255, 80, 80, 0.18);
			border: 1px solid #ff7070;
			color: #ffbcbc;
		}
	}

	.dropdown {
		position: relative;

		& > summary {
			list-style: none;
			user-select: none;

			&::-webkit-details-marker {
				display: none;
			}
			.caret {
				color: #888;
			}
		}
		&[open] > summary {
			background: rgba(74, 158, 255, 0.18);
			border-color: #4a9eff;
			color: #cfe4ff;
		}
	}
	.menu {
		position: absolute;
		top: calc(100% + 0.3rem);
		left: 0;
		min-width: 12rem;
		width: max-content;
		padding: 0.3rem;
		background: #16191f;
		border: 1px solid #333;
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		z-index: 5;

		button {
			text-align: left;
			padding: 0.4rem 0.6rem;
			background: transparent;
			border: 1px solid transparent;

			&:hover:not(:disabled) {
				background: rgba(74, 158, 255, 0.14);
				border-color: transparent;
			}
		}
		hr {
			margin: 0.2rem 0.1rem;
			border: 0;
			border-top: 1px solid #2a2a2a;
		}
	}

	.import-error {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.4rem 0.6rem;
		background: rgba(255, 80, 80, 0.15);
		border: 1px solid rgba(255, 80, 80, 0.4);
		border-radius: 4px;
		color: #ffaaaa;
		font-size: 13px;

		button {
			padding: 0.1rem 0.4rem;
			background: transparent;
			border: none;
			color: #ffaaaa;

			&:hover:not(:disabled) {
				background: transparent;
				color: #fff;
			}
		}
	}

	/* Embed/Video dialog chrome lives in EmbedDialog.svelte / VideoDialog.svelte. */
</style>
