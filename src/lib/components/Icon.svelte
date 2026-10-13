<script lang="ts" module>
	/**
	 * The editor's pictograms, drawn like the ones of `PathIcon`: on a 16 × 16
	 * grid, as 1.5-wide rounded strokes in `currentColor`. `stroke` holds the
	 * outlined part of an icon, `fill` the solid part.
	 */
	const ICONS = {
		link: {
			stroke:
				'M6.6 9.4a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-.8.8 M9.4 6.6a3 3 0 0 0-4.2 0L3.1 8.7a3 3 0 0 0 4.2 4.2l.8-.8'
		},
		embed: { stroke: 'M5.5 4.5 2 8l3.5 3.5 M10.5 4.5 14 8l-3.5 3.5' },
		video: { stroke: 'M2 4.5h8.5v7H2z M10.5 7.2 14 5v6l-3.5-2.2' },
		star: { stroke: 'M8 2l1.8 3.7 4 .6-2.9 2.9.7 4L8 11.3l-3.6 1.9.7-4L2.2 6.3l4-.6z' },
		import: { stroke: 'M8 10.5v-8 M5 5.5l3-3 3 3 M2.5 10.5v3h11v-3' },
		export: { stroke: 'M8 2.5v8 M5 7.5l3 3 3-3 M2.5 10.5v3h11v-3' },
		trash: { stroke: 'M2.5 4.5h11 M6 4.5v-2h4v2 M4 4.5l.7 9h6.6l.7-9 M6.7 7v4 M9.3 7v4' },
		close: { stroke: 'M4 4l8 8 M12 4l-8 8' },
		check: { stroke: 'M3 8.5l3.2 3.2L13 4.8' },
		copy: { stroke: 'M6 6h7.5v7.5H6z M10 6V2.5H2.5V10H6' },
		// Back to where it was: an arrow turning counter-clockwise.
		undo: { stroke: 'M5.5 3.5 2.5 6.5l3 3 M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6' },
		redo: { stroke: 'M10.5 3.5l3 3-3 3 M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H10' },
		reset: { stroke: 'M3.6 5.6A5 5 0 1 1 3 8 M3.2 2.4v3.3h3.3' },
		// The corners of a viewfinder around its centre: "what the map shows now".
		view: {
			stroke: 'M2.5 5.5v-3h3 M10.5 2.5h3v3 M13.5 10.5v3h-3 M5.5 13.5h-3v-3',
			fill: 'M6.4 8a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0z'
		},
		pin: {
			stroke:
				'M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z M6.5 6.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z'
		},
		restart: { stroke: 'M4 3.5v9', fill: 'M12.5 3.2v9.6L5.8 8z' },
		play: { fill: 'M4.5 2.8 13 8l-8.5 5.2z' },
		pause: { fill: 'M4 3h3v10H4z M9 3h3v10H9z' },
		plus: { stroke: 'M8 3.5v9 M3.5 8h9' },
		caret: { stroke: 'M4.5 6.5 8 10l3.5-3.5' },
		grip: {
			fill: 'M4.9 4a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0z M8.9 4a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0z M4.9 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0z M8.9 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0z M4.9 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0z M8.9 12a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0z'
		}
	} satisfies Record<string, { stroke?: string; fill?: string }>;

	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, size = 14 }: { name: IconName; size?: number } = $props();

	const icon = $derived<{ stroke?: string; fill?: string }>(ICONS[name]);
</script>

<svg class="icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
	{#if icon.stroke}
		<path
			d={icon.stroke}
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{/if}
	{#if icon.fill}
		<path d={icon.fill} fill="currentColor" />
	{/if}
</svg>

<style>
	.icon {
		display: inline-block;
		flex: none;
		/* Sits on the text line like a letter, wherever it is placed. */
		vertical-align: -0.16em;
	}
</style>
