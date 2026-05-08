<script lang="ts">
	import { base } from '$app/paths';
	import type { AnimationStore } from '../animation.svelte';
	import { downloadAnimation, uploadAnimation } from '../json_io';
	import { DEFAULT_TERRAIN, SCHEMA_VERSION } from '../types';
	import { encodeAnimation } from '../url_state';

	let { store }: { store: AnimationStore } = $props();

	let fileInput: HTMLInputElement;
	let embedInput = $state<HTMLInputElement | undefined>(undefined);
	let menuEl = $state<HTMLDetailsElement | undefined>(undefined);
	let importError = $state<string | null>(null);
	let status = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	let embedOpen = $state(false);
	let embedCopied = $state(false);
	let embedCopyTimer: ReturnType<typeof setTimeout> | undefined;

	function flash(tone: 'ok' | 'err', text: string) {
		status = { tone, text };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => {
			status = null;
		}, 1800);
	}

	function closeMenu() {
		if (menuEl) menuEl.open = false;
	}

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
	async function onShare() {
		closeMenu();
		if (store.keyframes.length === 0) return;
		const url = `${window.location.origin}${base}/#kf=${encodeAnimation(store.toAnimation())}`;
		try {
			await navigator.clipboard.writeText(url);
			flash('ok', '✓ Share URL copied');
		} catch {
			flash('err', '✕ Could not copy URL');
		}
	}

	function onClear() {
		closeMenu();
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
		closeMenu();
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
		closeMenu();
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

	function handleDocClick(e: MouseEvent) {
		if (!menuEl?.open) return;
		if (!menuEl.contains(e.target as Node)) menuEl.open = false;
	}

	$effect(() => {
		window.addEventListener('keydown', handleKeydown);
		document.addEventListener('click', handleDocClick);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('click', handleDocClick);
		};
	});

	const hasSelection = $derived(store.selectedIndex !== null);
	const hasKeyframes = $derived(store.keyframes.length > 0);
	const canPlay = $derived(store.keyframes.length >= 2);
	const embedSnippet = $derived(embedOpen && hasKeyframes ? buildEmbedSnippet() : '');
</script>

<div class="toolbar">
	<div class="group" role="group" aria-label="Keyframe">
		<span class="group-label">Keyframe</span>
		<button type="button" onclick={onAdd} title="Add a keyframe at the current playhead time">
			+ Add
		</button>
		<button
			type="button"
			onclick={onUpdate}
			disabled={!hasSelection}
			title="Update the selected keyframe to the current camera"
		>
			↻ Update
		</button>
		<button
			type="button"
			onclick={onDelete}
			disabled={!hasSelection}
			title="Delete the selected keyframe"
		>
			✕ Delete
		</button>
	</div>

	<div class="group playback">
		<button
			type="button"
			class="primary"
			onclick={onTogglePlay}
			disabled={!canPlay}
			title="Spacebar"
		>
			{store.isPlaying ? '⏸ Pause' : '▶ Play'}
		</button>
		<button type="button" onclick={onRestart} disabled={!hasKeyframes}>⏮ Restart</button>
	</div>

	<div class="spacer"></div>

	{#if status}
		<span class="status" class:ok={status.tone === 'ok'} class:err={status.tone === 'err'}>
			{status.text}
		</span>
	{/if}

	<details bind:this={menuEl} class="more">
		<summary aria-label="More actions" title="More actions">⋯</summary>
		<div class="menu" role="menu">
			<button type="button" role="menuitem" onclick={onShare} disabled={!hasKeyframes}>
				🔗 Share URL
			</button>
			<button type="button" role="menuitem" onclick={onToggleEmbed} disabled={!hasKeyframes}>
				🖼 Embed…
			</button>
			<hr />
			<button type="button" role="menuitem" onclick={onExport} disabled={!hasKeyframes}>
				↓ Export JSON
			</button>
			<button type="button" role="menuitem" onclick={onImportClick}>↑ Import JSON</button>
			<hr />
			<button type="button" role="menuitem" onclick={onLoadExample}>★ Load example</button>
			<button type="button" role="menuitem" onclick={onClear} disabled={!hasKeyframes}>
				⌫ Clear
			</button>
		</div>
	</details>

	<input
		bind:this={fileInput}
		type="file"
		accept="application/json,.json"
		onchange={onImportChange}
		hidden
	/>
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
		align-items: center;
	}
	.group.playback {
		margin-left: 1.5rem;
	}
	.group-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
		margin-right: 0.15rem;
	}
	.spacer {
		flex: 1 1 auto;
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

	.status {
		font-size: 12px;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}
	.status.ok {
		background: rgba(80, 200, 120, 0.18);
		border: 1px solid #4ac888;
		color: #b6f0c9;
	}
	.status.err {
		background: rgba(255, 80, 80, 0.18);
		border: 1px solid #ff7070;
		color: #ffbcbc;
	}

	.more {
		position: relative;
	}
	.more > summary {
		list-style: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.2rem;
		height: 1.85rem;
		padding: 0;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}
	.more > summary::-webkit-details-marker {
		display: none;
	}
	.more > summary:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: #4a9eff;
	}
	.more[open] > summary {
		background: rgba(74, 158, 255, 0.18);
		border-color: #4a9eff;
		color: #cfe4ff;
	}
	.menu {
		position: absolute;
		bottom: calc(100% + 0.3rem);
		right: 0;
		min-width: 12rem;
		padding: 0.3rem;
		background: #16191f;
		border: 1px solid #333;
		border-radius: 6px;
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		z-index: 5;
	}
	.menu button {
		text-align: left;
		padding: 0.4rem 0.6rem;
		background: transparent;
		border: 1px solid transparent;
		font-size: 13px;
	}
	.menu button:hover:not(:disabled) {
		background: rgba(74, 158, 255, 0.14);
		border-color: transparent;
	}
	.menu hr {
		margin: 0.2rem 0.1rem;
		border: 0;
		border-top: 1px solid #2a2a2a;
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
	.embed-row button.copied {
		background: rgba(80, 200, 120, 0.18);
		border-color: #4ac888;
		color: #b6f0c9;
	}
</style>
