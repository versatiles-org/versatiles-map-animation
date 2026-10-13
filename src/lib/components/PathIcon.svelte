<script lang="ts">
	import type { PathStyle } from '../types';

	/**
	 * Pictograms of the camera-path vocabulary: the two travel styles of a
	 * move, the curve of a move through waypoints, and the two kinds of
	 * keyframe. Drawn in `currentColor`, sized by
	 * the `size` prop.
	 */
	let { icon, size = 16 }: { icon: PathStyle | 'curve' | 'stop' | 'waypoint'; size?: number } =
		$props();
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
	{#if icon === 'arc'}
		<!-- Up and over: the rise and descent of a long move. -->
		<path d="M2.5 12.5 C2.5 1.5 13.5 1.5 13.5 12.5" />
		<circle class="solid" cx="2.5" cy="12.5" r="1.6" />
		<circle class="solid" cx="13.5" cy="12.5" r="1.6" />
	{:else if icon === 'linear'}
		<path d="M2.5 8 H13.5" />
		<circle class="solid" cx="2.5" cy="8" r="1.6" />
		<circle class="solid" cx="13.5" cy="8" r="1.6" />
	{:else if icon === 'curve'}
		<!-- A stretch of a move through waypoints: the curve from one keyframe to the next. -->
		<path d="M2 11.5 C4 3 6.5 3 8 8 S12 13 14 4.5" />
	{:else if icon === 'stop'}
		<!-- The path arrives at the keyframe and leaves it again: a rest. -->
		<path d="M1 8 H3.5 M12.5 8 H15" />
		<path class="solid" d="M8 4 L12 8 L8 12 L4 8 Z" />
	{:else}
		<!-- One curve flowing through the keyframe. -->
		<path d="M2 11.5 C4 3 6.5 3 8 8 S12 13 14 4.5" />
		<circle class="solid" cx="8" cy="8" r="1.8" />
	{/if}
</svg>

<style>
	.path-icon {
		display: block;
		flex: none;
	}
	.solid {
		fill: currentColor;
		stroke: none;
	}
</style>
