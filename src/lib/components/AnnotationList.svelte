<script lang="ts">
	/**
	 * List of all annotations on the animation. Each row shows a sprite
	 * preview + label, can be clicked to select (which routes the panel into
	 * `AnnotationEditor`), and can be drag-reordered. When the list is empty,
	 * an explanatory hint stands in for the rows. Lives next to
	 * `DefaultStyleEditor` in the no-selection panel.
	 */

	import { resolveAnnotation, type AnimationStore } from '../animation.svelte';
	import { spritePreviewStyle } from '../sprite_meta';
	import { DEFAULT_ANNOTATION_LABEL_COLOR } from '../types';

	let { store }: { store: AnimationStore } = $props();

	// Drag-and-drop reorder state. `dragFrom` is the index being dragged;
	// `dropAt` is the slot the user is hovering over (0..length, where length
	// means "after the last item"). The slot is rendered as an insertion line
	// between rows so the user can see exactly where the marker will land.
	let dragFrom = $state<number | null>(null);
	let dropAt = $state<number | null>(null);

	function onDragStart(e: DragEvent, index: number) {
		dragFrom = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Required by Firefox to actually start the drag.
			e.dataTransfer.setData('text/plain', String(index));
		}
	}
	function onDragEnd() {
		dragFrom = null;
		dropAt = null;
	}
	function onDragOver(e: DragEvent, index: number) {
		if (dragFrom === null) return;
		e.preventDefault();
		// Drop above or below the hovered row, depending on which half of it
		// the cursor is over.
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const above = e.clientY < rect.top + rect.height / 2;
		dropAt = above ? index : index + 1;
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (dragFrom !== null && dropAt !== null) {
			store.reorderAnnotation(dragFrom, dropAt);
		}
		dragFrom = null;
		dropAt = null;
	}
</script>

<h3 class="section">Markers</h3>
{#if store.annotations.length === 0}
	<p class="placeholder">
		No annotations yet. Click <strong>📍 Pin</strong> below to add one — new markers inherit the default
		style configured below.
	</p>
{:else}
	<ul class="annotation-list" role="list">
		{#each store.annotations as a, i (i)}
			{@const r = resolveAnnotation(a, store.defaultAnnotation)}
			<li
				class:dragging={dragFrom === i}
				class:drop-above={dropAt === i && dragFrom !== i && dragFrom !== i - 1}
				class:drop-below={dropAt === i + 1 &&
					dragFrom !== i &&
					dragFrom !== i + 1 &&
					i === store.annotations.length - 1}
				ondragover={(e) => onDragOver(e, i)}
				ondrop={onDrop}
			>
				<button
					type="button"
					class="annotation-item"
					draggable="true"
					ondragstart={(e) => onDragStart(e, i)}
					ondragend={onDragEnd}
					onclick={() => store.selectAnnotation(i)}
					title="Click to edit, drag to reorder"
				>
					<span class="grip" aria-hidden="true">⋮⋮</span>
					<span class="icon-prev" style={spritePreviewStyle(r.icon, 18)}></span>
					<span
						class="annotation-label"
						class:empty={!a.label}
						style="color: {r.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR};"
					>
						{a.label || '(no label)'}
					</span>
					<span class="annotation-num">#{i + 1}</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.section {
		margin: 0.4rem 0 0.1rem;
		padding: 0.2rem 0 0.15rem;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #888;

		&:first-of-type {
			margin-top: 0.1rem;
		}
	}
	.placeholder {
		margin: 0.2rem 0;
		font-size: 12px;
		color: #888;
		line-height: 1.45;
	}

	.annotation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 30vh;
		overflow-y: auto;

		li {
			position: relative;

			&.dragging {
				opacity: 0.4;
			}
			/* Insertion-line indicator while a row is being dragged over. The
			   border is on the LI so it sits between rows without affecting
			   the button's own border. */
			&.drop-above::before,
			&.drop-below::after {
				content: '';
				position: absolute;
				left: 0;
				right: 0;
				height: 2px;
				background: #4a9eff;
				border-radius: 1px;
				pointer-events: none;
			}
			&.drop-above::before {
				top: -2px;
			}
			&.drop-below::after {
				bottom: -2px;
			}
		}
	}
	.annotation-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.4rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #2a2f37;
		border-radius: 3px;
		color: #ddd;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
		text-align: left;

		&:hover {
			background: rgba(74, 158, 255, 0.12);
			border-color: rgba(74, 158, 255, 0.4);
		}
	}
	.grip {
		flex: 0 0 auto;
		color: #555;
		font-size: 11px;
		cursor: grab;
		user-select: none;

		.annotation-item:active & {
			cursor: grabbing;
		}
	}
	.annotation-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		&::first-line {
			line-height: 1;
		}

		&.empty {
			color: #666;
			font-style: italic;
		}
	}
	.annotation-num {
		flex: 0 0 auto;
		color: #777;
		font-variant-numeric: tabular-nums;
		font-size: 10px;
	}

	.icon-prev {
		position: relative;
		display: inline-block;
		flex: 0 0 auto;
		border-radius: 2px;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			background-image: var(--sprite-bg);
			background-position: var(--sprite-pos);
			background-size: var(--sprite-size);
			background-repeat: no-repeat;
			filter: invert(1);
			transform: rotate(var(--sprite-rotate, 0deg));
		}
	}
</style>
