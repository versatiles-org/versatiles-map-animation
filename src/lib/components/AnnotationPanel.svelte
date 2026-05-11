<script lang="ts">
	/**
	 * Routes between three sub-components based on selection state:
	 *   - When a marker is selected → `MarkerEditor` for the per-annotation editor.
	 *   - When nothing's selected   → `MarkerList` (clickable list) plus
	 *                                 `DefaultStyleEditor` (template style for new pins).
	 * Each sub-component owns its own handlers, lifecycle, and styles.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import DefaultStyleEditor from './DefaultStyleEditor.svelte';
	import MarkerEditor from './MarkerEditor.svelte';
	import MarkerList from './MarkerList.svelte';

	let { store }: { store: AnimationStore } = $props();
</script>

<div class="annotation-panel">
	{#if store.selectedAnnotationIndex !== null}
		<MarkerEditor {store} />
	{:else}
		<MarkerList {store} />
		<DefaultStyleEditor {store} />
	{/if}
</div>

<style>
	.annotation-panel {
		color: #ddd;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
</style>
