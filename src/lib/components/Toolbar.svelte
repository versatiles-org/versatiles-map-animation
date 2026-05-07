<script lang="ts">
	import { base } from '$app/paths';
	import type { AnimationStore } from '../animation.svelte';
	import { downloadAnimation, uploadAnimation } from '../json_io';
	import { DEFAULT_TERRAIN, MAP_STYLE_IDS, MAP_STYLE_LABELS, SCHEMA_VERSION } from '../types';
	import { encodeAnimation } from '../url_state';

	let { store }: { store: AnimationStore } = $props();

	let fileInput: HTMLInputElement;
	let embedInput = $state<HTMLInputElement | undefined>(undefined);
	let importError = $state<string | null>(null);
	let shareState = $state<'idle' | 'copied' | 'error'>('idle');
	let shareTimer: ReturnType<typeof setTimeout> | undefined;
	let embedOpen = $state(false);
	let embedCopied = $state(false);
	let embedCopyTimer: ReturnType<typeof setTimeout> | undefined;

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

	function buildEmbedSnippet(): string {
		const encoded = encodeAnimation(store.toAnimation());
		const url = `${window.location.origin}${base}/view#kf=${encoded}`;
		return `<iframe src="${url}" style="width:100%;aspect-ratio:16/9;border:0" loading="lazy" allowfullscreen></iframe>`;
	}

	function onToggleEmbed() {
		if (store.keyframes.length === 0) return;
		embedOpen = !embedOpen;
		embedCopied = false;
		if (embedOpen) {
			queueMicrotask(() => embedInput?.select());
		}
	}

	async function onCopyEmbed() {
		if (!embedInput) return;
		try {
			await navigator.clipboard.writeText(embedInput.value);
			embedCopied = true;
		} catch {
			embedInput.select();
			document.execCommand?.('copy');
			embedCopied = true;
		}
		if (embedCopyTimer) clearTimeout(embedCopyTimer);
		embedCopyTimer = setTimeout(() => {
			embedCopied = false;
		}, 1800);
	}

	function onLoadExample() {
		store.loadFromAnimation({
			version: SCHEMA_VERSION,
			style: 'colorful',
			terrain: DEFAULT_TERRAIN,
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
	const embedSnippet = $derived(embedOpen && store.keyframes.length > 0 ? buildEmbedSnippet() : '');
</script>

<div class="toolbar">
	<div class="group">
		<button type="button" onclick={onAdd}>+ Add KF</button>
		<button type="button" onclick={onUpdate} disabled={!hasSelection}>↻ Update KF</button>
		<button type="button" onclick={onDelete} disabled={!hasSelection}>✕ Delete KF</button>
	</div>

	<div class="group map-controls">
		<label class="control-label" title="Base map style">
			Map
			<select bind:value={store.style}>
				{#each MAP_STYLE_IDS as id (id)}
					<option value={id}>{MAP_STYLE_LABELS[id]}</option>
				{/each}
			</select>
		</label>
		<label class="control-label checkbox" title="Toggle 3D terrain">
			<input type="checkbox" bind:checked={store.terrain} />
			Terrain
		</label>
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
		<button
			type="button"
			onclick={onToggleEmbed}
			disabled={store.keyframes.length === 0}
			class:active={embedOpen}
			title="Get an iframe snippet to embed this animation"
			aria-expanded={embedOpen}
		>
			🖼 Embed
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

{#if embedOpen}
	<div class="embed-panel" role="region" aria-label="Embed snippet">
		<label for="embed-input">Paste this into your page:</label>
		<div class="embed-row">
			<input
				id="embed-input"
				bind:this={embedInput}
				type="text"
				readonly
				value={embedSnippet}
				onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
			/>
			<button type="button" onclick={onCopyEmbed} class:copied={embedCopied} title="Copy snippet">
				{embedCopied ? '✓ Copied' : '⧉ Copy'}
			</button>
			<button type="button" onclick={onToggleEmbed} aria-label="Close" title="Close">✕</button>
		</div>
		<p class="hint">The iframe scales to its container at a fixed 16:9 aspect ratio.</p>
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

	button.active {
		background: rgba(74, 158, 255, 0.18);
		border-color: #4a9eff;
		color: #cfe4ff;
	}

	.map-controls {
		align-items: center;
		gap: 0.5rem;
	}
	.control-label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 12px;
		color: #aaa;
	}
	.control-label select {
		padding: 0.35rem 0.5rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
	}
	.control-label select:hover {
		border-color: #4a9eff;
	}
	.control-label.checkbox {
		cursor: pointer;
		user-select: none;
	}
	.control-label.checkbox input {
		margin: 0;
		accent-color: #4a9eff;
	}

	.embed-panel {
		margin-top: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #333;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.embed-panel label {
		font-size: 12px;
		color: #aaa;
	}
	.embed-row {
		display: flex;
		gap: 0.4rem;
		align-items: stretch;
	}
	.embed-row input {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		background: #0d1117;
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
	}
	.embed-row input:focus {
		outline: none;
		border-color: #4a9eff;
	}
	.embed-panel .hint {
		margin: 0;
		font-size: 11px;
		color: #888;
	}
</style>
