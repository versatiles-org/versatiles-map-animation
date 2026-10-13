<script lang="ts">
	import type { PathStyle } from '../types';

	/**
	 * Pictogram of a trajectory type: how the camera gets from one keyframe
	 * (dot) to the next. Drawn in `currentColor`, sized by the `size` prop.
	 */
	let { path, size = 16 }: { path: PathStyle; size?: number } = $props();
</script>

<svg
	class="path-icon"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if path === 'arc'}
		<!-- Up and over: the zoom-out-and-back of the smooth zoom-and-pan. -->
		<path d="M2.5 12.5 C2.5 1.5 13.5 1.5 13.5 12.5" />
		<circle class="dot" cx="2.5" cy="12.5" r="1.6" />
		<circle class="dot" cx="13.5" cy="12.5" r="1.6" />
	{:else if path === 'linear'}
		<path d="M2.5 12.5 L13.5 3.5" />
		<circle class="dot" cx="2.5" cy="12.5" r="1.6" />
		<circle class="dot" cx="13.5" cy="3.5" r="1.6" />
	{:else}
		<!-- One curve flowing through a keyframe in the middle. -->
		<path d="M2 11.5 C4 3 6.5 3 8 8 S12 13 14 4.5" />
		<circle class="dot" cx="8" cy="8" r="1.6" />
	{/if}
</svg>

<style>
	.path-icon {
		display: block;
		flex: none;
	}
	.dot {
		fill: currentColor;
		stroke: none;
	}
</style>
