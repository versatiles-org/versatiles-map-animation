<script lang="ts">
	/**
	 * Modal that builds a `docker run` command line for rendering the current
	 * animation to a video file via the standalone `versatiles-map-animation`
	 * container image. The user picks width and FPS; height is derived from
	 * the animation's aspect ratio. The encoded animation is passed on the
	 * URL fragment, so it ships with the command line.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import { aspectRatioValue } from '../types';
	import { encodeAnimation } from '../url_state';

	const RENDER_IMAGE = 'ghcr.io/versatiles-org/versatiles-map-animation:latest';
	const VIDEO_WIDTHS = [640, 1280, 1920, 3840] as const;
	type VideoWidth = (typeof VIDEO_WIDTHS)[number];
	const VIDEO_FPS = [24, 25, 30, 50, 60] as const;
	type VideoFps = (typeof VIDEO_FPS)[number];

	let {
		store,
		onClose
	}: {
		store: AnimationStore;
		onClose: () => void;
	} = $props();

	let inputEl = $state<HTMLInputElement | undefined>(undefined);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	let videoWidth = $state<VideoWidth>(1920);
	let videoFps = $state<VideoFps>(30);
	const videoHeight = $derived(Math.round(videoWidth / aspectRatioValue(store.aspectRatio)));

	function buildCommand(): string {
		const hash = encodeAnimation(store.toAnimation());
		// Single-line so users can paste-and-run; --pull always keeps the image
		// fresh; the working directory is mounted at /out so the MP4 lands next
		// to where the user invoked the command. `--height` is derived from
		// `--width` and the composition aspect ratio chosen in the editor.
		return `docker run --rm --pull always -v "$PWD:/out" ${RENDER_IMAGE} --hash '${hash}' --width ${videoWidth} --height ${videoHeight} --fps ${videoFps} --output animation.mp4`;
	}
	const command = $derived(buildCommand());

	async function copy() {
		if (!inputEl) return;
		try {
			await navigator.clipboard.writeText(inputEl.value);
		} catch {
			inputEl.select();
			document.execCommand?.('copy');
		}
		copied = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1800);
	}

	$effect(() => {
		queueMicrotask(() => inputEl?.select());
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
		};
	});
</script>

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
			bind:this={inputEl}
			type="text"
			readonly
			value={command}
			onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
		/>
		<button type="button" onclick={copy} class:copied title="Copy command">
			{copied ? '✓ Copied' : '⧉ Copy'}
		</button>
		<button type="button" onclick={onClose} aria-label="Close" title="Close">✕</button>
	</div>
</div>

<style>
	.embed-panel {
		margin-top: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #333;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;

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
	.video-row-1 {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;

		.hint {
			flex: 1 1 16rem;
		}
	}
	.control-label {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: #aaa;
		font-size: 12px;

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

			&:hover {
				border-color: #4a9eff;
			}
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
			&.copied {
				background: rgba(80, 200, 120, 0.18);
				border-color: #4ac888;
				color: #b6f0c9;
			}
		}
	}
</style>
