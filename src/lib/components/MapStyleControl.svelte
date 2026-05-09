<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { MAP_STYLE_IDS, MAP_STYLE_LABELS } from '../types';

	let { store }: { store: AnimationStore } = $props();
</script>

<div class="map-style-control" role="group" aria-label="Map style">
	<label class="row" title="Base map style">
		<span class="lbl">Map</span>
		<select bind:value={store.style}>
			{#each MAP_STYLE_IDS as id (id)}
				<option value={id}>{MAP_STYLE_LABELS[id]}</option>
			{/each}
		</select>
	</label>
	<label class="row checkbox" title="Toggle 3D terrain">
		<input type="checkbox" bind:checked={store.terrain} />
		<span>Terrain</span>
	</label>
</div>

<style>
	.map-style-control {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.35rem 0.6rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #333;
		border-radius: 6px;
		font-size: 12px;
		color: #ddd;
	}
	.row {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		user-select: none;
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
	}
	select:hover {
		border-color: #4a9eff;
	}
	.row.checkbox input {
		margin: 0;
		accent-color: #4a9eff;
	}
</style>
