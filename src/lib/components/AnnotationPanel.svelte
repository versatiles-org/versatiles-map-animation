<script lang="ts">
	/**
	 * Routes between three sub-components based on selection state:
	 *   - When an annotation is selected → `AnnotationEditor` (per-annotation form).
	 *   - When nothing's selected        → `AnnotationList` (clickable list) plus
	 *                                      `DefaultStyleEditor` (template for new pins).
	 * Each sub-component owns its own handlers, lifecycle, and styles. The
	 * visible UI text uses "Markers" / "Pin" because those read better in the
	 * sidebar; the data model and code identifiers stay on `annotation`.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import AnnotationEditor from './AnnotationEditor.svelte';
	import AnnotationList from './AnnotationList.svelte';
	import DefaultStyleEditor from './DefaultStyleEditor.svelte';

	let { store }: { store: AnimationStore } = $props();
</script>

<div class="annotation-panel">
	{#if store.selectedAnnotationIndex !== null}
		<AnnotationEditor {store} />
	{:else}
		<AnnotationList {store} />
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
