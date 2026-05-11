<script lang="ts">
	/**
	 * 3×3 picker for `labelPosition`. The dot in the middle represents the
	 * icon; each surrounding slot is one of the 8 cardinal/diagonal label
	 * placements (`top-left`, `top`, `top-right`, ...). The center slot itself
	 * means "label centered on the icon". Each cell is a radio button under
	 * the hood for keyboard navigation.
	 */

	import { POSITION_GRID } from '../annotation_panel_helpers';
	import type { LabelPosition } from '../types';

	let {
		label = 'Side',
		value,
		onChange,
		onReset,
		canReset = true,
		ariaPrefix = 'Place label',
		resetTitle,
		resetAriaLabel
	}: {
		label?: string;
		value: LabelPosition;
		onChange: (p: LabelPosition) => void;
		onReset: () => void;
		canReset?: boolean;
		/** Prefix for each cell's `aria-label` — e.g. "Default label position". */
		ariaPrefix?: string;
		resetTitle?: string;
		resetAriaLabel?: string;
	} = $props();
</script>

<div class="row">
	<span class="lbl">{label}</span>
	<div class="pos-grid">
		{#each POSITION_GRID as p (p.value)}
			<button
				type="button"
				class:active={value === p.value}
				onclick={() => onChange(p.value)}
				title={p.value}
				aria-label={`${ariaPrefix} ${p.value}`}
			>
				{p.label}
			</button>
		{/each}
	</div>
	<button
		type="button"
		class="mini reset"
		onclick={onReset}
		disabled={!canReset}
		title={resetTitle}
		aria-label={resetAriaLabel}>⟲</button
	>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;

		.lbl {
			flex: 0 0 auto;
			width: 60px;
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #888;
		}
	}
	.pos-grid {
		display: grid;
		grid-template-columns: repeat(3, 22px);
		grid-template-rows: repeat(3, 22px);
		gap: 2px;

		button {
			padding: 0;
			background: rgba(255, 255, 255, 0.04);
			border: 1px solid #2a2f37;
			border-radius: 3px;
			color: #888;
			font:
				14px/1 ui-monospace,
				monospace;
			cursor: pointer;

			&:hover {
				border-color: #4a9eff;
				color: #ddd;
			}
			&.active {
				background: rgba(74, 158, 255, 0.18);
				border-color: #4a9eff;
				color: #fff;
			}
		}
	}
	.mini {
		flex: 0 0 auto;
		padding: 0.2rem 0.35rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #aaa;
		font: inherit;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;

		&:hover:not(:disabled) {
			border-color: #4a9eff;
			color: #ddd;
		}
		&:disabled {
			opacity: 0.35;
			cursor: not-allowed;
		}
	}
</style>
