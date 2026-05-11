<script lang="ts">
	let {
		label,
		value,
		min,
		max,
		step,
		onChange,
		formatValue = (v: number) => v.toFixed(2),
		onReset,
		canReset = true,
		ariaLabel,
		title,
		resetTitle,
		resetAriaLabel
	}: {
		label: string;
		value: number;
		min: number;
		max: number;
		step: number;
		onChange: (e: Event) => void;
		/** How to render the numeric readout next to the slider. */
		formatValue?: (v: number) => string;
		onReset: () => void;
		canReset?: boolean;
		ariaLabel?: string;
		title?: string;
		resetTitle?: string;
		resetAriaLabel?: string;
	} = $props();
</script>

<label class="row">
	<span class="lbl">{label}</span>
	<input
		type="range"
		{min}
		{max}
		{step}
		{value}
		oninput={onChange}
		aria-label={ariaLabel ?? label}
		{title}
	/>
	<span class="num">{formatValue(value)}</span>
	<button
		type="button"
		class="mini reset"
		onclick={onReset}
		disabled={!canReset}
		title={resetTitle}
		aria-label={resetAriaLabel}>⟲</button
	>
</label>

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
	input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
	}
	.num {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
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
