<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';

	let { store }: { store: AnimationStore } = $props();

	function fmt(n: number, digits: number): string {
		return n.toFixed(digits);
	}
</script>

<dl class="readout" aria-label="Live camera state">
	<div>
		<dt>lng</dt>
		<dd>{fmt(store.liveCamera.lng, 4)}</dd>
	</div>
	<div>
		<dt>lat</dt>
		<dd>{fmt(store.liveCamera.lat, 4)}</dd>
	</div>
	<div>
		<dt>zoom</dt>
		<dd>{fmt(store.liveCamera.zoom, 2)}</dd>
	</div>
	<div>
		<dt>pitch</dt>
		<dd>{fmt(store.liveCamera.pitch, 1)}°</dd>
	</div>
	<div>
		<dt>bearing</dt>
		<dd>{fmt(store.liveCamera.bearing, 1)}°</dd>
	</div>
	<div>
		<dt>roll</dt>
		<dd>{fmt(store.liveCamera.roll, 1)}°</dd>
	</div>
</dl>

<style>
	.readout {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		margin: 0;
		padding: 0.4rem 0.6rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #ccc;
	}
	.readout div {
		display: flex;
		gap: 0.25rem;
	}
	.readout dt {
		color: #888;
		font-weight: normal;
	}
	.readout dd {
		margin: 0;
		min-width: 4ch;
		text-align: right;
	}
</style>
