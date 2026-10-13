<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import {
		ASPECT_RATIOS,
		DEFAULT_MAP_THEMES,
		LABEL_SWITCH_LAYER_GROUPS,
		MAP_LAYER_GROUP_LABELS,
		MAP_LAYER_GROUPS,
		MAP_STYLE_IDS,
		MAP_STYLE_LABELS,
		MAP_THEME_LOOKALIKES_START,
		MAP_THEMES,
		mapThemeLabel,
		SATELLITE_OVERLAY_LAYER_GROUPS,
		type MapLayerGroup,
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

	const onSatellite = $derived(store.style === 'satellite');

	/**
	 * Why a layer group's checkbox has no effect right now, or `null` when it
	 * does. Such a group keeps its stored state and only greys out, so
	 * switching the map or the master switch back restores what was set.
	 */
	function layerGroupBlocked(group: MapLayerGroup): string | null {
		if (onSatellite) {
			if (!store.labels) return 'The overlay is switched off';
			if (!SATELLITE_OVERLAY_LAYER_GROUPS.includes(group)) {
				return 'Not part of the satellite overlay';
			}
		} else if (!store.labels && LABEL_SWITCH_LAYER_GROUPS.includes(group)) {
			return 'Hidden by “Labels & icons”';
		}
		return null;
	}

	// Same idea for the 3D switch: it needs the building layer to act on.
	const buildings3dBlocked = $derived(
		onSatellite
			? 'The satellite map has no buildings layer'
			: store.hiddenLayers.includes('buildings')
				? 'The Buildings layer is hidden'
				: null
	);
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
		title={onSatellite
			? 'Colour theme of the OSM overlay drawn on top of the satellite imagery'
			: 'Colour theme of the OSM map'}
	>
		<span class="lbl">Theme</span>
		<select
			value={store.theme ?? defaultTheme}
			onchange={onThemeChange}
			disabled={onSatellite && !store.labels}
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
		title={onSatellite
			? 'Show the OSM overlay (roads + place names) on top of the satellite imagery'
			: 'Show all names and symbols (places, roads, POIs, stops, one-way arrows) on the OSM map'}
	>
		<input type="checkbox" bind:checked={store.labels} />
		<span>{onSatellite ? 'Overlay' : 'Labels & icons'}</span>
	</label>
	<details class="layers">
		<summary title="Show or hide individual groups of map layers">
			Layers
			{#if store.hiddenLayers.length > 0}
				<span class="count">{store.hiddenLayers.length} hidden</span>
			{/if}
		</summary>
		<div class="layer-grid">
			{#each MAP_LAYER_GROUPS as group (group)}
				{@const blocked = layerGroupBlocked(group)}
				<label
					class="row checkbox"
					class:blocked={blocked !== null}
					title={blocked ?? MAP_LAYER_GROUP_LABELS[group][1]}
				>
					<input
						type="checkbox"
						checked={!store.hiddenLayers.includes(group)}
						disabled={blocked !== null}
						onchange={(e) => store.setLayerGroupVisible(group, e.currentTarget.checked)}
					/>
					<span>{MAP_LAYER_GROUP_LABELS[group][0]}</span>
				</label>
			{/each}
		</div>
	</details>
	<label
		class="row checkbox"
		class:blocked={buildings3dBlocked !== null}
		title={buildings3dBlocked ??
			'Draw buildings as 3D blocks with their real heights. Visible from zoom 14, best with a pitched camera.'}
	>
		<input
			type="checkbox"
			bind:checked={store.buildings3d}
			disabled={buildings3dBlocked !== null}
		/>
		<span>3D buildings</span>
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
	.layers {
		summary {
			cursor: pointer;
			user-select: none;
			color: #888;

			&:hover {
				color: #ddd;
			}
		}
		.count {
			margin-left: 0.3rem;
			color: #4a9eff;
		}
	}
	.layer-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem 0.6rem;
		margin-top: 0.4rem;
		padding-left: 0.2rem;
	}
	.blocked {
		opacity: 0.45;
		cursor: default;
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
