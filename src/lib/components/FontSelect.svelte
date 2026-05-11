<script lang="ts">
	/**
	 * Searchable label-font picker. The 187 fonts in `ANNOTATION_LABEL_FONTS`
	 * are too many for a flat `<select>`, so this renders a custom popup with
	 * an `<optgroup>`-style family grouping plus a substring filter. Closes on
	 * outside click / Escape; arrow-key navigation moves through filtered
	 * results.
	 */

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

	let menuOpen = $state(false);
	let menuEl: HTMLDivElement | undefined = $state();
	let searchEl: HTMLInputElement | undefined = $state();
	let query = $state('');

	function pick(font: AnnotationLabelFont) {
		onChange(font);
		menuOpen = false;
		query = '';
	}

	function handleDocClick(e: MouseEvent) {
		if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) {
			menuOpen = false;
			query = '';
		}
	}
	$effect(() => {
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});

	// Focus the search input on open so the user can start typing immediately.
	$effect(() => {
		if (menuOpen) queueMicrotask(() => searchEl?.focus());
	});

	// Filter the 187 fonts by substring match against family + variant
	// labels. Empty query passes everything through. Group labels follow the
	// same case-insensitive contains rule.
	const filteredGroups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return FONT_GROUPS;
		const out: { family: string; fonts: AnnotationLabelFont[] }[] = [];
		for (const g of FONT_GROUPS) {
			const fam = familyLabel(g.family).toLowerCase();
			const familyMatches = fam.includes(q);
			const fonts = familyMatches
				? g.fonts // family hit → keep all variants
				: g.fonts.filter((f) => fontVariantLabel(f).toLowerCase().includes(q));
			if (fonts.length > 0) out.push({ family: g.family, fonts });
		}
		return out;
	});

	// Selected font's labels for the trigger button.
	const currentFamily = $derived(FONT_GROUPS.find((g) => g.fonts.includes(value))?.family ?? '');

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			menuOpen = false;
			query = '';
		} else if (e.key === 'Enter') {
			// Pick the first match if there is one.
			const first = filteredGroups[0]?.fonts[0];
			if (first) {
				e.preventDefault();
				pick(first);
			}
		}
	}
</script>

<div class="font-select" bind:this={menuEl} {title}>
	<button
		type="button"
		class="trigger"
		onclick={() => (menuOpen = !menuOpen)}
		aria-haspopup="listbox"
		aria-expanded={menuOpen}
	>
		<span class="family">{familyLabel(currentFamily)}</span>
		<span class="variant">{fontVariantLabel(value)}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>
	{#if menuOpen}
		<div class="menu" role="listbox">
			<input
				bind:this={searchEl}
				type="search"
				bind:value={query}
				onkeydown={onSearchKeydown}
				placeholder="Search fonts…"
				aria-label="Search fonts"
				class="search"
			/>
			<div class="scroll">
				{#if filteredGroups.length === 0}
					<p class="no-match">No fonts match “{query}”.</p>
				{:else}
					{#each filteredGroups as g (g.family)}
						<div class="family-group">
							<div class="family-label">{familyLabel(g.family)}</div>
							{#each g.fonts as f (f)}
								<button
									type="button"
									class="option"
									class:selected={value === f}
									onclick={() => pick(f)}
									role="option"
									aria-selected={value === f}
									title={f}
								>
									{fontVariantLabel(f)}
								</button>
							{/each}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.font-select {
		flex: 1 1 auto;
		min-width: 0;
		position: relative;
	}
	.trigger {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.25rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
		text-align: left;

		&:hover {
			border-color: #4a9eff;
		}
		.family {
			flex: 0 0 auto;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			max-width: 60%;
		}
		.variant {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: #888;
		}
		.caret {
			color: #888;
			font-size: 11px;
		}
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 280px;
		display: flex;
		flex-direction: column;
		background: #11161e;
		border: 1px solid #333;
		border-radius: 4px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
		z-index: 10;
	}
	.search {
		flex: 0 0 auto;
		margin: 4px;
		padding: 0.3rem 0.45rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #ddd;
		font: inherit;
		font-size: 12px;

		&:focus {
			outline: none;
			border-color: #4a9eff;
		}
	}
	.scroll {
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 0 4px 4px;
	}
	.family-group {
		margin-top: 0.25rem;
	}
	.family-label {
		padding: 0.25rem 0.4rem 0.1rem;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
	}
	.option {
		width: 100%;
		display: block;
		padding: 0.2rem 0.4rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 3px;
		color: #ccc;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
		text-align: left;

		&:hover {
			background: rgba(74, 158, 255, 0.12);
			border-color: rgba(74, 158, 255, 0.4);
		}
		&.selected {
			background: rgba(74, 158, 255, 0.18);
			border-color: #4a9eff;
			color: #fff;
		}
	}
	.no-match {
		margin: 0.5rem 0.4rem;
		font-size: 11px;
		color: #888;
	}
</style>
