<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { ASPECT_RATIOS, MAP_STYLE_IDS, MAP_STYLE_LABELS } from '../types';

	let { store }: { store: AnimationStore } = $props();
</script>

<div class="map-style-control" role="group" aria-label="Map style">
	<label class="row" title="Composition aspect ratio (letterboxed in editor and viewer alike)">
		<span class="lbl">Aspect</span>
		<select bind:value={store.aspectRatio}>
			{#each ASPECT_RATIOS as ar (ar)}
				<option value={ar}>{ar}</option>
			{/each}
		</select>
	</label>
	<label class="row" title="Base map style">
		<span class="lbl">Map</span>
		<select bind:value={store.style}>
			{#each MAP_STYLE_IDS as id (id)}
				<option value={id}>{MAP_STYLE_LABELS[id]}</option>
			{/each}
		</select>
	</label>
	<label
		class="row checkbox"
		title={store.style === 'satellite'
			? 'Show the colorful overlay (roads + place names) on top of the satellite imagery'
			: 'Show place names, road names, and POIs on the colorful basemap'}
	>
		<input type="checkbox" bind:checked={store.labels} />
		<span>Labels</span>
	</label>
	<label class="row checkbox" title="Toggle 3D terrain">
		<input type="checkbox" bind:checked={store.terrain} />
		<span>Terrain</span>
	</label>
	<label
		class="row checkbox"
		title="Render an atmospheric sky behind the horizon. Only visible when the camera is pitched."
	>
		<input type="checkbox" bind:checked={store.sky} />
		<span>Sky</span>
	</label>
</div>

<style>
	.map-style-control {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.4rem;
		font-size: 12px;
		color: #ddd;
	}
	.row {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		user-select: none;

		&.checkbox input {
			margin: 0;
			accent-color: #4a9eff;
		}
	}
	.lbl {
		color: #888;
	}
	select {
		padding: 0.2rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;

		&:hover {
			border-color: #4a9eff;
		}
	}
</style>
