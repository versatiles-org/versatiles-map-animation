<script lang="ts">
	/**
	 * Dropdown picker for the per-annotation icon. Renders a trigger button
	 * showing the currently-selected sprite, and a click-to-open menu of all
	 * `ANNOTATION_ICONS`. Closes on outside click or Escape. Used by both the
	 * per-annotation editor and the default-style block, so styling and
	 * accessibility (ariaLabel) are driven by props.
	 */

	import { shortName } from '../annotation_panel_helpers';
	import { spritePreviewStyle } from '../sprite_meta';
	import { ANNOTATION_ICONS, type AnnotationIcon } from '../types';

	let {
		value,
		onChange,
		ariaLabel = 'Icon'
	}: {
		value: AnnotationIcon;
		onChange: (icon: AnnotationIcon) => void;
		ariaLabel?: string;
	} = $props();

	let menuOpen = $state(false);
	let menuEl: HTMLDivElement | undefined = $state();

	function pick(icon: AnnotationIcon) {
		onChange(icon);
		menuOpen = false;
	}

	function handleDocClick(e: MouseEvent) {
		if (menuOpen && menuEl && !menuEl.contains(e.target as Node)) menuOpen = false;
	}
	$effect(() => {
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});
</script>

<div class="icon-dropdown" bind:this={menuEl}>
	<button
		type="button"
		class="icon-trigger"
		onclick={() => (menuOpen = !menuOpen)}
		aria-haspopup="listbox"
		aria-expanded={menuOpen}
		title={value}
	>
		<span class="icon-prev" style={spritePreviewStyle(value, 22)}></span>
		<span class="icon-name">{shortName(value)}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>
	{#if menuOpen}
		<ul class="icon-menu" role="listbox" aria-label={ariaLabel}>
			{#each ANNOTATION_ICONS as icon (icon)}
				<li>
					<button
						type="button"
						class="icon-option"
						class:selected={value === icon}
						onclick={() => pick(icon)}
						role="option"
						aria-selected={value === icon}
						title={icon}
					>
						<span class="icon-prev" style={spritePreviewStyle(icon, 22)}></span>
						<span class="icon-name">{shortName(icon)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.icon-dropdown {
		flex: 1 1 auto;
		position: relative;
		min-width: 0;
	}
	.icon-trigger {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		cursor: pointer;
		text-align: left;

		&:hover {
			border-color: #4a9eff;
		}
		.icon-name {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.caret {
			color: #888;
			font-size: 11px;
		}
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
	.icon-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 240px;
		overflow-y: auto;
		margin: 0;
		padding: 3px;
		list-style: none;
		background: #11161e;
		border: 1px solid #333;
		border-radius: 4px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
		z-index: 10;

		li {
			margin: 0;
		}
	}
	.icon-option {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.25rem 0.4rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 3px;
		color: #ccc;
		font: inherit;
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
		.icon-name {
			flex: 1 1 auto;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
