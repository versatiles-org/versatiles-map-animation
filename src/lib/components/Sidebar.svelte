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

	<footer class="sidebar-footer">
		<a
			href="https://github.com/versatiles-org/versatiles-map-animation"
			target="_blank"
			rel="noopener noreferrer"
			title="Source code on GitHub"
		>
			<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
				<path
					fill="currentColor"
					d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.7.08-.69.08-.69 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.94 10.94 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.07.78 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"
				/>
			</svg>
			<span>Source on GitHub</span>
		</a>
	</footer>
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

	.sidebar-footer {
		/* Push to the bottom of the sidebar's flex column. */
		margin-top: auto;
		padding-top: 0.5rem;
	}
	.sidebar-footer a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: #888;
		text-decoration: none;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.sidebar-footer a:hover {
		color: #ddd;
	}
</style>
