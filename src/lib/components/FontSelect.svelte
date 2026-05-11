<script lang="ts">
	import { familyLabel, FONT_GROUPS, fontVariantLabel } from '../annotation_panel_helpers';
	import type { AnnotationLabelFont } from '../types';

	let {
		value,
		onChange,
		title
	}: {
		value: AnnotationLabelFont;
		onChange: (font: AnnotationLabelFont) => void;
		title?: string;
	} = $props();

	function handleChange(e: Event) {
		onChange((e.currentTarget as HTMLSelectElement).value as AnnotationLabelFont);
	}
</script>

<select class="font-select" {value} onchange={handleChange} {title}>
	{#each FONT_GROUPS as g (g.family)}
		<optgroup label={familyLabel(g.family)}>
			{#each g.fonts as f (f)}
				<option value={f}>{fontVariantLabel(f)}</option>
			{/each}
		</optgroup>
	{/each}
</select>

<style>
	.font-select {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.25rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		font-size: 12px;
		cursor: pointer;

		&:hover,
		&:focus {
			border-color: #4a9eff;
			outline: none;
		}
	}
</style>
