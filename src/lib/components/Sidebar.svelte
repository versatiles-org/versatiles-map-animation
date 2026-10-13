<script lang="ts">
	/**
	 * Editor sidebar. Five collapsible panels, each driven by an independent
	 * `open` state — except for "Marker style", which is forced open when
	 * an annotation is selected and forced closed (disabled) otherwise, since
	 * it has nothing to style without a selection.
	 *
	 *   1. Frame                  — closed by default; shows the aspect ratio
	 *   2. Map                    — open by default; shows the base map
	 *   3. 3D & light             — open by default
	 *   4. Marker style           — open when a marker is selected, disabled otherwise
	 *   5. Markers                — open by default: the list, and the default
	 *                               style folded away below it
	 *
	 * The previous `AnnotationPanel` router (which switched between
	 * editor/list/defaults based on selection) is replaced by these
	 * always-present panels — the user controls visibility, not the
	 * application.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import { MAP_STYLE_LABELS } from '../types';
	import AnnotationEditor from './AnnotationEditor.svelte';
	import AnnotationList from './AnnotationList.svelte';
	import DefaultStyleEditor from './DefaultStyleEditor.svelte';
	import SceneSettings from './SceneSettings.svelte';

	let { store }: { store: AnimationStore } = $props();

	const hasSelection = $derived(store.selectedAnnotationIndex !== null);

	// User-toggleable panel state. Initial values match the requested
	// open-by-default set; the user can override by clicking the summary.
	let frameOpen = $state(false);
	let mapOpen = $state(true);
	let reliefOpen = $state(true);
	let defaultStyleOpen = $state(false);
	let listOpen = $state(true);
</script>

<aside class="sidebar" aria-label="Editor sidebar">
	<!-- 1–3. The animation as a whole — always available -->
	<details class="sub-panel" bind:open={frameOpen}>
		<summary>Frame <span class="value">{store.aspectRatio}</span></summary>
		<div class="sub-body">
			<SceneSettings {store} section="frame" />
		</div>
	</details>
	<details class="sub-panel" bind:open={mapOpen}>
		<summary>Map <span class="value">{MAP_STYLE_LABELS[store.style]}</span></summary>
		<div class="sub-body">
			<SceneSettings {store} section="map" />
		</div>
	</details>
	<details class="sub-panel" bind:open={reliefOpen}>
		<summary>3D &amp; light</summary>
		<div class="sub-body">
			<SceneSettings {store} section="relief" />
		</div>
	</details>

	<!-- 4. Marker style — derived from selection. Force-open when a
	     marker is selected, force-closed (and visually disabled) when none.
	     Using `open={hasSelection}` rather than `bind:open` means clicks on
	     a disabled summary can't open it. -->
	<details class="sub-panel" class:is-disabled={!hasSelection} open={hasSelection}>
		<summary
			aria-disabled={!hasSelection}
			title={hasSelection ? '' : 'Select a marker in the list below to edit its style'}
			onclick={(e) => {
				// Prevent the disabled summary from toggling the details element.
				if (!hasSelection) e.preventDefault();
			}}
		>
			Marker style
		</summary>
		<div class="sub-body">
			<AnnotationEditor {store} />
		</div>
	</details>

	<!-- 5. Markers — the list, and below it the style a marker has until it
	     is given its own. Open by default, the default style folded away. -->
	<details class="sub-panel" bind:open={listOpen}>
		<summary>
			Markers
			{#if store.annotations.length > 0}
				<span class="value">{store.annotations.length}</span>
			{/if}
		</summary>
		<div class="sub-body">
			<AnnotationList {store} />
			<details class="nested" bind:open={defaultStyleOpen}>
				<summary title="The style of every marker that has not been given its own">
					Default style
				</summary>
				<div class="nested-body">
					<DefaultStyleEditor {store} />
				</div>
			</details>
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
		content: '';
		display: inline-block;
		width: 10px;
		height: 10px;
		background: #666;
		/* A chevron pointing right, drawn like the icons of Icon.svelte. */
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M6 4.5 9.5 8 6 11.5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center / contain no-repeat;
		transition: transform 120ms ease;
	}
	.sub-panel[open] > summary::before {
		transform: rotate(90deg);
	}
	/* What the panel is set to, readable while it is closed. */
	.sub-panel > summary .value {
		margin-left: auto;
		color: #666;
		text-transform: none;
		letter-spacing: 0;
	}
	.sub-panel > summary:hover {
		background: rgba(255, 255, 255, 0.04);
		color: #ddd;
	}

	/* Disabled state (no selection for the per-annotation editor): muted
	   text, no hover affordance, summary is not clickable. The panel is
	   always rendered closed in this state, so `.sub-body` is never visible. */
	.sub-panel.is-disabled {
		opacity: 0.45;
	}
	.sub-panel.is-disabled > summary {
		cursor: not-allowed;
		color: #666;
	}
	.sub-panel.is-disabled > summary:hover {
		background: transparent;
		color: #666;
	}
	.sub-panel.is-disabled > summary::before {
		background: #444;
	}

	/* A foldable part inside a panel. */
	.nested {
		margin-top: 0.6rem;
		padding-top: 0.5rem;
		border-top: 1px solid #1f1f1f;
		font-size: 12px;

		& > summary {
			cursor: pointer;
			user-select: none;
			color: #888;

			&:hover {
				color: #ddd;
			}
		}
	}
	.nested-body {
		margin-top: 0.5rem;
	}

	.sub-body {
		padding: 0.55rem 0.6rem 0.65rem;
		border-top: 1px solid #1f1f1f;
	}

	.sidebar-footer {
		/* Push to the bottom of the sidebar's flex column. */
		margin-top: auto;
		padding-top: 0.5rem;

		a {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			color: #888;
			text-decoration: none;
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.06em;

			&:hover {
				color: #ddd;
			}
		}
	}
</style>
