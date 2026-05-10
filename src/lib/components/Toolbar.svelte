<script lang="ts">
	import { base } from '$app/paths';
	import type { AnimationStore } from '../animation.svelte';
	import { downloadAnimation, uploadAnimation } from '../json_io';
	import { aspectRatioValue, DEFAULT_ANNOTATION_COLOR, DEFAULT_ANNOTATION_ICON } from '../types';
	import { encodeAnimation } from '../url_state';

	let { store }: { store: AnimationStore } = $props();

	const RENDER_IMAGE = 'ghcr.io/versatiles-org/versatiles-map-animation:latest';
	const VIDEO_WIDTHS = [640, 1280, 1920, 3840] as const;
	type VideoWidth = (typeof VIDEO_WIDTHS)[number];
	const VIDEO_FPS = [24, 25, 30, 50, 60] as const;
	type VideoFps = (typeof VIDEO_FPS)[number];

	let fileInput: HTMLInputElement;
	let embedInput = $state<HTMLInputElement | undefined>(undefined);
	let videoInput = $state<HTMLInputElement | undefined>(undefined);
	let menuEl = $state<HTMLDetailsElement | undefined>(undefined);
	let importError = $state<string | null>(null);
	let embedOpen = $state(false);
	let videoOpen = $state(false);
	let videoWidth = $state<VideoWidth>(1920);
	let videoFps = $state<VideoFps>(30);

	/**
	 * Reactive transient value that auto-clears after `timeoutMs`. Used for the
	 * status flash chip and the "✓ Copied" button states — set on action, then
	 * the value reverts to null on its own. Calling `.set` again before the
	 * timer fires resets the countdown.
	 */
	function flashState<T>(timeoutMs: number) {
		let value = $state<T | null>(null);
		let timer: ReturnType<typeof setTimeout> | undefined;
		return {
			get value() {
				return value;
			},
			set(v: T) {
				value = v;
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => {
					value = null;
				}, timeoutMs);
			},
			clear() {
				if (timer) clearTimeout(timer);
				timer = undefined;
				value = null;
			}
		};
	}

	const status = flashState<{ tone: 'ok' | 'err'; text: string }>(1800);
	const embedCopied = flashState<true>(1800);
	const videoCopied = flashState<true>(1800);

	function flash(tone: 'ok' | 'err', text: string) {
		status.set({ tone, text });
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

	function buildEmbedSnippet(): string {
		const encoded = encodeAnimation(store.toAnimation());
		const url = `${window.location.origin}${base}/view#kf=${encoded}`;
		// `aspect-ratio` mirrors the composition aspect so the iframe stays
		// the right shape in any container width (the viewer letterboxes
		// internally too, but matching here avoids visible bars).
		const aspect = store.aspectRatio.replace(':', '/');
		return `<iframe src="${url}" style="width:100%;aspect-ratio:${aspect};border:0" loading="lazy" allowfullscreen></iframe>`;
	}

	function onToggleEmbed() {
		closeMenu();
		if (store.keyframes.length === 0) return;
		embedOpen = !embedOpen;
		embedCopied.clear();
		if (embedOpen) {
			queueMicrotask(() => embedInput?.select());
		}
	}

	async function onCopyEmbed() {
		if (!embedInput) return;
		try {
			await navigator.clipboard.writeText(embedInput.value);
		} catch {
			embedInput.select();
			document.execCommand?.('copy');
		}
		embedCopied.set(true);
	}

	const videoHeight = $derived(Math.round(videoWidth / aspectRatioValue(store.aspectRatio)));

	function buildVideoCommand(): string {
		const hash = encodeAnimation(store.toAnimation());
		// Single-line so users can paste-and-run; --pull always keeps the image
		// fresh; the working directory is mounted at /out so the MP4 lands next
		// to where the user invoked the command. `--height` is derived from
		// `--width` and the composition aspect ratio chosen in the editor.
		return `docker run --rm --pull always -v "$PWD:/out" ${RENDER_IMAGE} --hash '${hash}' --width ${videoWidth} --height ${videoHeight} --fps ${videoFps} --output /out/animation.mp4`;
	}

	function onToggleVideo() {
		closeMenu();
		if (store.keyframes.length === 0) return;
		videoOpen = !videoOpen;
		videoCopied.clear();
		if (videoOpen) {
			queueMicrotask(() => videoInput?.select());
		}
	}

	async function onCopyVideo() {
		if (!videoInput) return;
		try {
			await navigator.clipboard.writeText(videoInput.value);
		} catch {
			videoInput.select();
			document.execCommand?.('copy');
		}
		videoCopied.set(true);
	}

	function onLoadExample() {
		closeMenu();
		store.loadFromAnimation({
			version: 1,
			style: 'satellite',
			labels: false,
			terrain: true,
			sky: true,
			// 10-second flight around Germany's Zugspitze (2962 m) and the
			// surrounding Wetterstein massif. Starts as a wide aerial north of
			// Garmisch-Partenkirchen, descends toward the Eibsee at the foot of
			// the Zugspitze, then pulls into a high-pitch panorama that reveals
			// the whole massif from west to east.
			keyframes: [
				{
					t: 0,
					lng: 11.05,
					lat: 47.62,
					zoom: 10,
					pitch: 30,
					bearing: 200,
					roll: 0
				},
				{
					t: 3,
					lng: 10.99,
					lat: 47.52,
					zoom: 11.5,
					pitch: 55,
					bearing: 200,
					roll: 0
				},
				{
					t: 6.5,
					lng: 10.96,
					lat: 47.5,
					zoom: 11.8,
					pitch: 72,
					bearing: 220,
					roll: 0,
					path: 'linear'
				},
				{
					t: 10,
					lng: 11.05,
					lat: 47.52,
					zoom: 11.3,
					pitch: 78,
					bearing: 245,
					roll: 0
				}
			],
			annotations: [
				// Zugspitze — the headliner: Germany's highest peak. Larger
				// icon and bolder colour to stand out from the supporting peaks.
				{
					lng: 10.985278,
					lat: 47.421111,
					icon: 'symbol-arrow1',
					label: 'Zugspitze\n2962 m',
					labelPosition: 'top',
					visibleFrom: 0,
					labelDistance: 2.5,
					fadeIn: 1,

					iconColor: '#660000',
					iconHaloColor: '#ffffff',
					iconHaloWidth: 1,
					iconSize: 2.5,
					labelColor: '#660000',
					labelHaloColor: '#ffffff',
					labelHaloWidth: 1,
					labelSize: 1.75
				},
				// Supporting peaks of the Wetterstein massif, fanned out so the
				// labels don't collide at the panoramic shot. Coordinates from
				// each peak's Wikipedia summit page.
				{
					lng: 10.971944,
					lat: 47.412917,
					icon: 'symbol-arrow1',
					iconColor: '#7a3030',
					label: 'Schneefernerkopf\n2875 m',
					labelPosition: 'bottom-left',
					visibleFrom: 2,
					iconSize: 1.8,
					labelSize: 1.3,
					labelDistance: 2.2,
					fadeIn: 1,
					labelColor: '#7a3030',
					labelHaloWidth: 1
				},
				{
					lng: 11.0375,
					lat: 47.4525,
					icon: 'symbol-arrow1',
					iconColor: '#7a3030',
					label: 'Alpspitze\n2628 m',
					labelPosition: 'top-right',
					visibleFrom: 2,
					iconSize: 1.8,
					labelSize: 1.3,
					labelDistance: 2.2,
					fadeIn: 1,
					labelColor: '#7a3030',
					labelHaloWidth: 1
				},
				{
					lng: 11.082222,
					lat: 47.413056,
					icon: 'symbol-arrow1',
					iconColor: '#7a3030',
					label: 'Hochwanner\n2744 m',
					labelPosition: 'bottom-right',
					visibleFrom: 2,
					iconSize: 1.8,
					labelSize: 1.3,
					labelDistance: 2.2,
					fadeIn: 1,
					labelColor: '#7a3030',
					labelHaloWidth: 1
				},
				{
					lng: 11.013333,
					lat: 47.430278,
					icon: 'symbol-arrow1',
					iconColor: '#7a3030',
					label: 'Höllentalspitze\n2743 m',
					labelPosition: 'right',
					visibleFrom: 2,
					iconSize: 1.8,
					labelSize: 1.3,
					labelDistance: 2.2,
					fadeIn: 1,
					labelColor: '#7a3030',
					labelHaloWidth: 1
				},
				// Eibsee — the turquoise alpine lake at the foot of the Zugspitze.
				// Different icon (marker pin) so it reads as a point of interest
				// rather than another peak.
				{
					lng: 10.9783,
					lat: 47.4581,
					icon: 'symbol-marker',
					iconColor: '#1a6fa8',
					label: 'Eibsee\n973 m',
					labelPosition: 'top-left',
					visibleFrom: 2,
					iconSize: 1.6,
					labelSize: 1.2,
					labelDistance: 1.8,
					fadeIn: 1,
					labelColor: '#1a6fa8',
					labelHaloWidth: 1
				}
			],
			annotationScale: 1,
			aspectRatio: '16:9'
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
	const videoCommand = $derived(
		videoOpen && hasKeyframes ? buildVideoCommand() : ''
		// videoCommand re-derives when keyframes/style/terrain or videoWidth change.
	);
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

	{#if status.value}
		<span
			class="status"
			class:ok={status.value.tone === 'ok'}
			class:err={status.value.tone === 'err'}
		>
			{status.value.text}
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
			<button
				type="button"
				onclick={onCopyEmbed}
				class:copied={embedCopied.value}
				title="Copy snippet"
			>
				{embedCopied.value ? '✓ Copied' : '⧉ Copy'}
			</button>
			<button type="button" onclick={onToggleEmbed} aria-label="Close" title="Close">✕</button>
		</div>
		<p class="hint">The iframe scales to its container at a fixed 16:9 aspect ratio.</p>
	</div>
{/if}

{#if videoOpen}
	<div class="embed-panel" role="region" aria-label="Render to video">
		<div class="video-row-1">
			<label for="video-width" class="control-label">
				<span class="lbl">Resolution</span>
				<select id="video-width" bind:value={videoWidth}>
					{#each VIDEO_WIDTHS as w (w)}
						<option value={w}>{w} × {Math.round(w / aspectRatioValue(store.aspectRatio))}</option>
					{/each}
				</select>
			</label>
			<label for="video-fps" class="control-label">
				<span class="lbl">FPS</span>
				<select id="video-fps" bind:value={videoFps}>
					{#each VIDEO_FPS as f (f)}
						<option value={f}>{f}</option>
					{/each}
				</select>
			</label>
			<span class="hint">
				Renders this animation as MP4. Requires <strong>Docker</strong>; the file lands in the
				directory you run the command from as <code>animation.mp4</code>.
			</span>
		</div>
		<div class="embed-row">
			<input
				id="video-input"
				bind:this={videoInput}
				type="text"
				readonly
				value={videoCommand}
				onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
			/>
			<button
				type="button"
				onclick={onCopyVideo}
				class:copied={videoCopied.value}
				title="Copy command"
			>
				{videoCopied.value ? '✓ Copied' : '⧉ Copy'}
			</button>
			<button type="button" onclick={onToggleVideo} aria-label="Close" title="Close">✕</button>
		</div>
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

	.embed-panel {
		margin-top: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #333;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;

		label {
			font-size: 12px;
			color: #aaa;
		}
		.hint {
			margin: 0;
			font-size: 11px;
			color: #888;
		}
		code {
			font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			font-size: 11px;
			background: rgba(255, 255, 255, 0.06);
			padding: 0 0.25rem;
			border-radius: 3px;
		}
	}
	.embed-row {
		display: flex;
		gap: 0.4rem;
		align-items: stretch;

		input {
			flex: 1 1 auto;
			min-width: 0;
			padding: 0.4rem 0.6rem;
			background: #0d1117;
			border: 1px solid #333;
			border-radius: 4px;
			color: #ddd;
			font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			font-size: 12px;

			&:focus {
				outline: none;
				border-color: #4a9eff;
			}
		}
		button.copied {
			background: rgba(80, 200, 120, 0.18);
			border-color: #4ac888;
			color: #b6f0c9;
		}
	}
	.video-row-1 {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;

		.hint {
			flex: 1 1 16rem;
		}
	}
</style>
