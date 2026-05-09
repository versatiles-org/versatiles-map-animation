<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import AnnotationPanel from './AnnotationPanel.svelte';
	import MapStyleControl from './MapStyleControl.svelte';

	let { store }: { store: AnimationStore } = $props();
</script>

<aside class="sidebar" aria-label="Editor sidebar">
	<header class="sidebar-header">
		<h1>Map Animation</h1>
		<p class="lede">Drop keyframes on a map, hit play.</p>
	</header>

	<details class="sub-panel" open>
		<summary>Map style</summary>
		<div class="sub-body">
			<MapStyleControl {store} />
		</div>
	</details>

	<details class="sub-panel" open>
		<summary>Annotation</summary>
		<div class="sub-body">
			<AnnotationPanel {store} />
		</div>
	</details>
</aside>

<style>
	.sidebar {
		flex: 0 0 auto;
		width: 300px;
		max-width: 300px;
		background: #0d1117;
		border: 1px solid #222;
		border-radius: 4px;
		padding: 0.75rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		box-sizing: border-box;
	}
	.sidebar-header h1 {
		margin: 0;
		font-size: 1.15rem;
	}
	.sidebar-header .lede {
		margin: 0.15rem 0 0;
		color: #888;
		font-size: 12px;
	}

	.sub-panel {
		border: 1px solid #222;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.02);
	}
	.sub-panel > summary {
		list-style: none;
		cursor: pointer;
		padding: 0.45rem 0.6rem;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #aaa;
		user-select: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.sub-panel > summary::-webkit-details-marker {
		display: none;
	}
	.sub-panel > summary::before {
		content: '▸';
		display: inline-block;
		width: 0.8em;
		color: #666;
		transition: transform 120ms ease;
	}
	.sub-panel[open] > summary::before {
		transform: rotate(90deg);
	}
	.sub-panel > summary:hover {
		background: rgba(255, 255, 255, 0.04);
		color: #ddd;
	}
	.sub-body {
		padding: 0.55rem 0.6rem 0.65rem;
		border-top: 1px solid #1f1f1f;
	}
</style>
