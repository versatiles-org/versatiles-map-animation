<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { downloadAnimation, uploadAnimation } from '../json_io';
	import { SCHEMA_VERSION } from '../types';
	import { encodeAnimation } from '../url_state';

	let { store }: { store: AnimationStore } = $props();

	let fileInput: HTMLInputElement;
	let importError = $state<string | null>(null);
	let shareState = $state<'idle' | 'copied' | 'error'>('idle');
	let shareTimer: ReturnType<typeof setTimeout> | undefined;

	function onAdd() {
		store.addKeyframeFromCamera(store.liveCamera);
	}
	function onUpdate() {
		store.updateSelectedFromCamera(store.liveCamera);
	}
	function onDelete() {
		if (store.selectedIndex !== null) store.deleteAt(store.selectedIndex);
	}
	function onTogglePlay() {
		store.togglePlay();
	}
	function onRestart() {
		store.restart();
	}
	function onExport() {
		downloadAnimation(store.toAnimation());
	}
	function onImportClick() {
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
	async function onShare() {
		if (store.keyframes.length === 0) return;
		const url =
			window.location.origin +
			window.location.pathname +
			'#kf=' +
			encodeAnimation(store.toAnimation());
		try {
			await navigator.clipboard.writeText(url);
			shareState = 'copied';
		} catch {
			shareState = 'error';
		}
		if (shareTimer) clearTimeout(shareTimer);
		shareTimer = setTimeout(() => {
			shareState = 'idle';
		}, 1800);
	}

	function onClear() {
		if (store.keyframes.length > 0 && !confirm('Discard the current animation and start over?')) {
			return;
		}
		store.reset();
	}

	function onLoadExample() {
		store.loadFromAnimation({
			version: SCHEMA_VERSION,
			style: 'colorful',
			keyframes: [
				{ t: 0, lng: 0, lat: 30, zoom: 1.5, pitch: 0, bearing: 0, roll: 0 },
				{ t: 3, lng: 13.405, lat: 52.52, zoom: 9, pitch: 60, bearing: 30, roll: 0 },
				{ t: 6, lng: 13.405, lat: 52.52, zoom: 14, pitch: 70, bearing: 120, roll: 0 }
			]
		});
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.code !== 'Space') return;
		const target = e.target as HTMLElement;
		if (target.matches('input, textarea, [contenteditable="true"]')) return;
		e.preventDefault();
		store.togglePlay();
	}

	$effect(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	const hasSelection = $derived(store.selectedIndex !== null);
	const canPlay = $derived(store.keyframes.length >= 2);
</script>

<div class="toolbar">
	<div class="group">
		<button type="button" onclick={onAdd}>+ Add KF</button>
		<button type="button" onclick={onUpdate} disabled={!hasSelection}>↻ Update KF</button>
		<button type="button" onclick={onDelete} disabled={!hasSelection}>✕ Delete KF</button>
	</div>

	<div class="group">
		<button
			type="button"
			class="primary"
			onclick={onTogglePlay}
			disabled={!canPlay}
			title="Spacebar"
		>
			{store.isPlaying ? '⏸ Pause' : '▶ Play'}
		</button>
		<button type="button" onclick={onRestart} disabled={store.keyframes.length === 0}>
			⏮ Restart
		</button>
	</div>

	<div class="group">
		<button
			type="button"
			onclick={onShare}
			disabled={store.keyframes.length === 0}
			class:copied={shareState === 'copied'}
			class:error={shareState === 'error'}
			title="Copy a shareable link to the clipboard"
		>
			{#if shareState === 'copied'}
				✓ Link copied
			{:else if shareState === 'error'}
				✕ Copy failed
			{:else}
				🔗 Share URL
			{/if}
		</button>
		<button type="button" onclick={onExport} disabled={store.keyframes.length === 0}
			>↓ Export JSON</button
		>
		<button type="button" onclick={onImportClick}>↑ Import JSON</button>
		<button type="button" onclick={onLoadExample}>★ Load example</button>
		<button type="button" onclick={onClear} disabled={store.keyframes.length === 0}>⌫ Clear</button>

		<input
			bind:this={fileInput}
			type="file"
			accept="application/json,.json"
			onchange={onImportChange}
			hidden
		/>
	</div>
</div>

{#if importError}
	<div class="import-error" role="alert">
		Import failed: {importError}
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}
	.group {
		display: flex;
		gap: 0.25rem;
	}
	button {
		padding: 0.4rem 0.7rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
	}
	button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.12);
		border-color: #4a9eff;
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	button.primary {
		background: #4a9eff;
		border-color: #4a9eff;
		color: #fff;
		font-weight: 600;
	}
	button.primary:hover:not(:disabled) {
		background: #5fa9ff;
	}
	button.copied {
		background: rgba(80, 200, 120, 0.18);
		border-color: #4ac888;
		color: #b6f0c9;
	}
	button.error {
		background: rgba(255, 80, 80, 0.18);
		border-color: #ff7070;
		color: #ffbcbc;
	}
	.import-error {
		margin-top: 0.5rem;
		padding: 0.4rem 0.6rem;
		background: rgba(255, 80, 80, 0.15);
		border: 1px solid rgba(255, 80, 80, 0.4);
		border-radius: 4px;
		color: #ffaaaa;
		font-size: 13px;
	}
</style>
