<script lang="ts">
	/**
	 * Modal that builds a `docker run` command line for rendering the current
	 * animation to a video file via the standalone `versatiles-map-animation`
	 * container image. The user picks format, quality, width and FPS; height
	 * is derived from the animation's aspect ratio. The encoded animation is
	 * passed on the URL fragment, so it ships with the command line. The
	 * command itself is put together in `render_command.ts`.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import {
		buildRenderCommand,
		DEFAULT_FORMAT,
		DEFAULT_QUALITY,
		DEFAULT_SHUTTER_ANGLE,
		hasQualityLevels,
		renderOutputName,
		VIDEO_FORMATS,
		VIDEO_QUALITIES
	} from '../render_command';
	import { aspectRatioValue } from '../types';
	import { encodeAnimation } from '../url_state';
	import Icon from './Icon.svelte';

	const VIDEO_WIDTHS = [640, 1280, 1920, 3840] as const;
	type VideoWidth = (typeof VIDEO_WIDTHS)[number];
	const VIDEO_FPS = [24, 25, 30, 50, 60] as const;
	type VideoFps = (typeof VIDEO_FPS)[number];
	// Motion blur: number of sub-frames rendered and averaged per output
	// frame. 1 = off (crisp), 4–8 = typical cinematic strengths. Render time
	// scales linearly with the sample count. The shutter angle sets how much
	// of a frame's duration those sub-frames span (180° = half, 360° = all).
	// Ranges and defaults mirror `--motion-blur` / `--shutter-angle` in
	// render/render.mjs.
	const MOTION_BLUR_MIN = 1;
	const MOTION_BLUR_MAX = 32;
	const SHUTTER_ANGLE_MIN = 1;
	const SHUTTER_ANGLE_MAX = 360;

	/** Round and clamp a number-input value; an empty or invalid field falls back. */
	function clampInt(value: unknown, min: number, max: number, fallback: number): number {
		if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
		return Math.max(min, Math.min(max, Math.round(value)));
	}

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

	let videoFormat = $state(DEFAULT_FORMAT);
	let videoQuality = $state(DEFAULT_QUALITY);
	const formatChoice = $derived(
		VIDEO_FORMATS.find((f) => f.id === videoFormat) ?? VIDEO_FORMATS[0]
	);
	const qualityChoice = $derived(VIDEO_QUALITIES.find((q) => q.id === videoQuality));
	const outputName = $derived(renderOutputName(videoFormat));
	let videoWidth = $state<VideoWidth>(1920);
	let videoFps = $state<VideoFps>(30);
	// Bound to number inputs, so they are `null` while a field is empty.
	let motionBlurInput = $state<number | null>(MOTION_BLUR_MIN);
	let shutterAngleInput = $state<number | null>(DEFAULT_SHUTTER_ANGLE);
	const motionBlur = $derived(
		clampInt(motionBlurInput, MOTION_BLUR_MIN, MOTION_BLUR_MAX, MOTION_BLUR_MIN)
	);
	const shutterAngle = $derived(
		clampInt(shutterAngleInput, SHUTTER_ANGLE_MIN, SHUTTER_ANGLE_MAX, DEFAULT_SHUTTER_ANGLE)
	);
	const videoHeight = $derived(Math.round(videoWidth / aspectRatioValue(store.aspectRatio)));

	const command = $derived(
		buildRenderCommand({
			hash: encodeAnimation(store.toAnimation()),
			width: videoWidth,
			height: videoHeight,
			fps: videoFps,
			motionBlur,
			shutterAngle,
			format: videoFormat,
			quality: videoQuality
		})
	);

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
		<label for="video-format" class="control-label" title="What kind of video file to write">
			<span class="lbl">Format</span>
			<select id="video-format" bind:value={videoFormat}>
				{#each VIDEO_FORMATS as format (format.id)}
					<option value={format.id}>{format.label}</option>
				{/each}
			</select>
		</label>
		{#if hasQualityLevels(videoFormat)}
			<label
				for="video-quality"
				class="control-label"
				title="How strongly the video is compressed: higher quality means a larger file"
			>
				<span class="lbl">Quality</span>
				<select id="video-quality" bind:value={videoQuality}>
					{#each VIDEO_QUALITIES as quality (quality.id)}
						<option value={quality.id}>{quality.label}</option>
					{/each}
				</select>
			</label>
		{/if}
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
		<label
			for="video-blur"
			class="control-label"
			title="Sub-frames averaged per output frame. 1 = off (crisp), 4–8 typical. Render time grows by the same factor."
		>
			<span class="lbl">Motion blur</span>
			<input
				id="video-blur"
				type="number"
				min={MOTION_BLUR_MIN}
				max={MOTION_BLUR_MAX}
				step="1"
				bind:value={motionBlurInput}
			/>
			<span class="unit">×</span>
		</label>
		{#if motionBlur > 1}
			<label
				for="video-shutter"
				class="control-label"
				title="Share of each frame's duration the simulated shutter is open. 180° = cinematic, 360° = strongest blur."
			>
				<span class="lbl">Shutter</span>
				<input
					id="video-shutter"
					type="number"
					min={SHUTTER_ANGLE_MIN}
					max={SHUTTER_ANGLE_MAX}
					step="1"
					bind:value={shutterAngleInput}
				/>
				<span class="unit">°</span>
			</label>
		{/if}
		<span class="hint">
			<strong>{formatChoice.label}:</strong>
			{formatChoice.description}
			{#if hasQualityLevels(videoFormat) && qualityChoice?.description}
				{qualityChoice.label} quality: {qualityChoice.description}
			{/if}
			Requires <strong>Docker</strong>; the file lands in the directory you run the command from as
			<code>{outputName}</code>.
			{#if motionBlur > 1}
				Motion blur makes the render take {motionBlur}× as long.
			{/if}
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
			<Icon name={copied ? 'check' : 'copy'} />
			{copied ? 'Copied' : 'Copy'}
		</button>
		<button type="button" onclick={onClose} aria-label="Close" title="Close"
			><Icon name="close" /></button
		>
	</div>
</div>

<style>
	.embed-panel {
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
		select,
		input {
			padding: 0.3rem 0.45rem;
			background: rgba(255, 255, 255, 0.06);
			border: 1px solid #333;
			border-radius: 4px;
			color: #ddd;
			font-size: 13px;
			font-family: inherit;

			&:hover {
				border-color: #4a9eff;
			}
		}
		select {
			cursor: pointer;
		}
		input {
			width: 3.5rem;
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
