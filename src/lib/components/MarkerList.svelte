<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { spritePreviewStyle } from '../sprite_meta';
	import { DEFAULT_ANNOTATION_LABEL_COLOR } from '../types';

	let { store }: { store: AnimationStore } = $props();
</script>

<h3 class="section">Markers</h3>
{#if store.annotations.length === 0}
	<p class="placeholder">
		No annotations yet. Click <strong>📍 Pin</strong> below to add one — new markers inherit the default
		style configured below.
	</p>
{:else}
	<ul class="marker-list">
		{#each store.annotations as a, i (i)}
			<li>
				<button
					type="button"
					class="marker-item"
					onclick={() => store.selectAnnotation(i)}
					title="Edit this marker"
				>
					<span class="icon-prev" style={spritePreviewStyle(a.icon, 18)}></span>
					<span
						class="marker-label"
						class:empty={!a.label}
						style="color: {a.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR};"
					>
						{a.label || '(no label)'}
					</span>
					<span class="marker-num">#{i + 1}</span>
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

	.marker-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 30vh;
		overflow-y: auto;
	}
	.marker-item {
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
	.marker-label {
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
	.marker-num {
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
