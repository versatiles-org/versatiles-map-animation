<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import {
		ASPECT_RATIOS,
		DEFAULT_MAP_THEMES,
		MAP_STYLE_IDS,
		MAP_STYLE_LABELS,
		MAP_THEME_LOOKALIKES_START,
		MAP_THEMES,
		mapThemeLabel,
		type MapTheme
	} from '../types';

	let { store }: { store: AnimationStore } = $props();

	const OWN_THEMES = MAP_THEMES.slice(0, MAP_THEME_LOOKALIKES_START);
	const LOOKALIKE_THEMES = MAP_THEMES.slice(MAP_THEME_LOOKALIKES_START);

	// The picker shows the theme the map is drawn in. Picking the style's own
	// default clears `store.theme` again, so an untouched animation stays as
	// short as before and keeps following the style's default.
	const defaultTheme = $derived(DEFAULT_MAP_THEMES[store.style]);
	function onThemeChange(e: Event): void {
		const theme = (e.currentTarget as HTMLSelectElement).value as MapTheme;
		store.theme = theme === defaultTheme ? undefined : theme;
	}
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
		class="row"
		title={store.style === 'satellite'
			? 'Colour theme of the OSM overlay drawn on top of the satellite imagery'
			: 'Colour theme of the OSM map'}
	>
		<span class="lbl">Theme</span>
		<select
			value={store.theme ?? defaultTheme}
			onchange={onThemeChange}
			disabled={store.style === 'satellite' && !store.labels}
		>
			<optgroup label="VersaTiles">
				{#each OWN_THEMES as theme (theme)}
					<option value={theme}>{mapThemeLabel(theme)}</option>
				{/each}
			</optgroup>
			<optgroup label="Lookalikes">
				{#each LOOKALIKE_THEMES as theme (theme)}
					<option value={theme}>{mapThemeLabel(theme)}</option>
				{/each}
			</optgroup>
		</select>
	</label>
	<label
		class="row checkbox"
		title={store.style === 'satellite'
			? 'Show the OSM overlay (roads + place names) on top of the satellite imagery'
			: 'Show place names, road names, and POIs on the OSM map'}
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

		&:hover:not(:disabled) {
			border-color: #4a9eff;
		}
		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}
</style>
