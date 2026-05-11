<script lang="ts">
	import { base } from '$app/paths';
	import type { AnimationStore } from '../animation.svelte';
	import { EXAMPLE_ANIMATION } from '../example_animation';
	import { downloadAnimation, uploadAnimation } from '../json_io';
	import { DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_ICON } from '../types';
	import { encodeAnimation } from '../url_state';
	import EmbedDialog from './EmbedDialog.svelte';
	import VideoDialog from './VideoDialog.svelte';

	let { store }: { store: AnimationStore } = $props();

	let fileInput: HTMLInputElement;
	let menuEl = $state<HTMLDetailsElement | undefined>(undefined);
	let importError = $state<string | null>(null);
	let embedOpen = $state(false);
	let videoOpen = $state(false);

	// Status flash for the share-URL copy result. The two dialogs each have
	// their own internal "✓ Copied" badge state; this one is just for the
	// transient ok/err toast above the ⋯ menu.
	let status = $state<{ tone: 'ok' | 'err'; text: string } | null>(null);
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	function flash(tone: 'ok' | 'err', text: string) {
		status = { tone, text };
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(() => (status = null), 1800);
	}

	function closeMenu() {
		if (menuEl) menuEl.open = false;
	}

	function onAdd() {
		store.addKeyframeFromCamera(store.liveCamera);
	}
	function onPinAnnotation() {
		const cam = store.liveCamera;
		store.addAnnotation({
			lng: cam.lng,
			lat: cam.lat,
			icon: DEFAULT_ANNOTATION_ICON,
			iconColor: DEFAULT_ANNOTATION_COLOR,
			label: ''
		});
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

	function onToggleEmbed() {
		closeMenu();
		if (store.keyframes.length === 0) return;
		embedOpen = !embedOpen;
	}
	function onToggleVideo() {
		closeMenu();
		if (store.keyframes.length === 0) return;
		videoOpen = !videoOpen;
	}

	function onLoadExample() {
		closeMenu();
		store.loadFromAnimation(EXAMPLE_ANIMATION);
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
		<label
			class="control-label path-picker"
			title="Trajectory shape from the selected keyframe to the next one"
		>
			<span class="lbl">Path →</span>
			<select
				value={store.selectedKeyframe?.path ?? 'arc'}
				disabled={!hasSelection || store.selectedIndex === store.keyframes.length - 1}
				onchange={(e) => {
					if (store.selectedIndex !== null) {
						store.setKeyframePath(
							store.selectedIndex,
							(e.currentTarget as HTMLSelectElement).value as 'arc' | 'linear'
						);
					}
				}}
			>
				<option value="arc">⌒ Arc</option>
				<option value="linear">— Linear</option>
			</select>
		</label>
	</div>

	<div class="group" role="group" aria-label="Annotation">
		<span class="group-label">Annotation</span>
		<button type="button" onclick={onPinAnnotation} title="Pin a marker at the current map center">
			📍 Pin
		</button>
		<label
			class="control-label scale-control"
			title="Scale all annotations (markers and labels). Stacks on top of automatic container-size scaling."
		>
			<span class="lbl">Size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={store.annotationScale}
				oninput={(e) => {
					store.annotationScale = Number((e.currentTarget as HTMLInputElement).value);
				}}
			/>
			<span class="num">{store.annotationScale.toFixed(2)}×</span>
		</label>
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
			<button type="button" role="menuitem" onclick={onToggleVideo} disabled={!hasKeyframes}>
				🎬 Export video…
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
	<EmbedDialog {store} onClose={() => (embedOpen = false)} />
{/if}

{#if videoOpen}
	<VideoDialog {store} onClose={() => (videoOpen = false)} />
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

		&.playback {
			margin-left: 1.5rem;
		}
	}
	.group-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
		margin-right: 0.15rem;
	}
	.path-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: 0.4rem;
		font-size: 12px;
		color: #aaa;

		.lbl {
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #777;
		}
		select {
			padding: 0.3rem 0.45rem;
			background: rgba(255, 255, 255, 0.06);
			border: 1px solid #333;
			border-radius: 4px;
			color: #ddd;
			font-size: 13px;
			font-family: inherit;
			cursor: pointer;

			&:hover:not(:disabled) {
				border-color: #4a9eff;
			}
			&:disabled {
				opacity: 0.4;
				cursor: not-allowed;
			}
		}
	}
	.scale-control {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: 0.4rem;
		font-size: 12px;
		color: #aaa;

		.lbl {
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #777;
		}
		input[type='range'] {
			width: 90px;
		}
		.num {
			font-variant-numeric: tabular-nums;
			min-width: 2.6em;
			text-align: right;
		}
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

		&:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.12);
			border-color: #4a9eff;
		}
		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
		&.primary {
			background: #4a9eff;
			border-color: #4a9eff;
			color: #fff;
			font-weight: 600;

			&:hover:not(:disabled) {
				background: #5fa9ff;
			}
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

	.more {
		position: relative;

		& > summary {
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

			&::-webkit-details-marker {
				display: none;
			}
			&:hover {
				background: rgba(255, 255, 255, 0.12);
				border-color: #4a9eff;
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

		button {
			text-align: left;
			padding: 0.4rem 0.6rem;
			background: transparent;
			border: 1px solid transparent;
			font-size: 13px;

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
		margin-top: 0.5rem;
		padding: 0.4rem 0.6rem;
		background: rgba(255, 80, 80, 0.15);
		border: 1px solid rgba(255, 80, 80, 0.4);
		border-radius: 4px;
		color: #ffaaaa;
		font-size: 13px;
	}

	/* Embed/Video dialog chrome lives in EmbedDialog.svelte / VideoDialog.svelte. */
</style>
