<script lang="ts">
	// Throwaway page for tuning per-icon rotation pivots in pixel coordinates.
	// Each row is one icon at the rotations a user might apply. Per cell: a 3px
	// red dot at the geo point, and the sprite positioned + rotated so that its
	// chosen pivot pixel sits on the dot. If the dot stays glued to the icon's
	// intended pivot through every column, the pivot is right.
	//
	// MapLibre has no pixel-precise anchor, but you can fake one with
	// `icon-anchor: 'center'` + `icon-offset: [16-px, 16-py]` (for a 32×32
	// icon). The Snapshot button prints exactly that table.

	import { ANNOTATION_ICONS, ANNOTATION_ICON_OFFSETS, type AnnotationIcon } from '$lib/types';

	const SPRITE_URL = 'https://tiles.versatiles.org/assets/sprites/markers/sprites.png';
	const SHEET_W = 224;
	const SHEET_H = 192;

	const SPRITE_POS: Record<AnnotationIcon, [number, number]> = {
		'symbol-marker': [160, 96],
		'symbol-marker_outline': [160, 128],
		'symbol-circle': [0, 128],
		'symbol-circle_outline': [32, 128],
		'symbol-star': [64, 160],
		'symbol-star_outline': [96, 160],
		'symbol-arrow': [128, 32],
		'symbol-arrow1': [128, 64],
		'symbol-arrow2': [128, 96],
		'icon-home': [0, 64],
		'icon-mountain': [96, 0],
		'icon-information': [32, 64]
	};

	const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315];
	const SCALE = 3;
	const ICON_PX = 32;
	const SPRITE_PX = ICON_PX * SCALE;
	const CELL_PX = SPRITE_PX * 2;

	// Seed from the production offsets so the page boots showing the current
	// state. offset = (icon_center - pivot)  ⇒  pivot = (icon_center - offset).
	function offsetToPivot(off: [number, number]): [number, number] {
		return [ICON_PX / 2 - off[0], ICON_PX / 2 - off[1]];
	}

	const pivots = $state<Record<AnnotationIcon, [number, number]>>(
		Object.fromEntries(
			ANNOTATION_ICONS.map((i) => [i, offsetToPivot(ANNOTATION_ICON_OFFSETS[i])])
		) as Record<AnnotationIcon, [number, number]>
	);

	// 9-cell preset grid: the corners + edges + center as quick-set buttons.
	const PRESETS: { label: string; value: [number, number] }[] = [
		{ label: '↖', value: [0, 0] },
		{ label: '↑', value: [16, 0] },
		{ label: '↗', value: [32, 0] },
		{ label: '←', value: [0, 16] },
		{ label: '·', value: [16, 16] },
		{ label: '→', value: [32, 16] },
		{ label: '↙', value: [0, 32] },
		{ label: '↓', value: [16, 32] },
		{ label: '↘', value: [32, 32] }
	];

	function clamp(v: number): number {
		if (!Number.isFinite(v)) return 16;
		return Math.max(0, Math.min(ICON_PX, Math.round(v)));
	}

	function spriteStyle(icon: AnnotationIcon, pivot: [number, number], rotDeg: number): string {
		const [px, py] = pivot;
		const ax = px * SCALE; // pivot in scaled display pixels
		const ay = py * SCALE;
		const [sx, sy] = SPRITE_POS[icon];
		return [
			`width: ${SPRITE_PX}px`,
			`height: ${SPRITE_PX}px`,
			`background-image: url(${SPRITE_URL})`,
			`background-position: -${sx * SCALE}px -${sy * SCALE}px`,
			`background-size: ${SHEET_W * SCALE}px ${SHEET_H * SCALE}px`,
			`background-repeat: no-repeat`,
			`position: absolute`,
			// Position the sprite so its pivot pixel sits on the dot (cell center).
			`left: calc(50% - ${ax}px)`,
			`top: calc(50% - ${ay}px)`,
			`transform-origin: ${ax}px ${ay}px`,
			`transform: rotate(${rotDeg}deg)`,
			`pointer-events: none`
		].join('; ');
	}

	function snapshotCode(): string {
		// Emit icon-offset values, ready to drop into MapStage with
		// `icon-anchor: 'center'`. Offset = (icon_center - pivot).
		const lines = ANNOTATION_ICONS.map((i) => {
			const [px, py] = pivots[i];
			const dx = ICON_PX / 2 - px;
			const dy = ICON_PX / 2 - py;
			return `\t'${i}': [${dx}, ${dy}]`;
		});
		return (
			`// Use with icon-anchor: 'center' on the symbol layer.\n` +
			`export const ANNOTATION_ICON_OFFSETS: Record<AnnotationIcon, [number, number]> = {\n` +
			lines.join(',\n') +
			`\n};`
		);
	}

	let snapshot = $state('');
	function onSnapshot() {
		snapshot = snapshotCode();
	}
</script>

<svelte:head>
	<title>Anchor tuning – throwaway</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="page">
	<header>
		<h1>Annotation pivot tuning (pixel coordinates)</h1>
		<p class="lede">
			Per icon, type the pivot pixel (0–32, 0–32) inside the 32×32 sprite or click a preset. The red
			dot is the geo point; if it stays glued to the icon's intended pivot through every rotation,
			you're done. <strong>Snapshot</strong> emits an
			<code>icon-offset</code> table to paste into <code>MapStage</code> alongside
			<code>icon-anchor: 'center'</code>.
		</p>
		<button type="button" onclick={onSnapshot}>Snapshot offsets</button>
	</header>

	{#if snapshot}
		<pre class="snapshot">{snapshot}</pre>
	{/if}

	<div class="grid" style:--cell={`${CELL_PX}px`}>
		<div class="hdr">icon</div>
		<div class="hdr">pivot (x, y)</div>
		<div class="hdr">presets</div>
		{#each ROTATIONS as r (r)}
			<div class="hdr">{r}°</div>
		{/each}

		{#each ANNOTATION_ICONS as icon (icon)}
			<div class="row-label">{icon}</div>
			<div class="pivot-cell">
				<input
					type="number"
					min="0"
					max={ICON_PX}
					step="1"
					value={pivots[icon][0]}
					oninput={(e) => {
						pivots[icon] = [clamp(+(e.currentTarget as HTMLInputElement).value), pivots[icon][1]];
					}}
				/>
				<input
					type="number"
					min="0"
					max={ICON_PX}
					step="1"
					value={pivots[icon][1]}
					oninput={(e) => {
						pivots[icon] = [pivots[icon][0], clamp(+(e.currentTarget as HTMLInputElement).value)];
					}}
				/>
			</div>
			<div class="presets">
				{#each PRESETS as p (p.label)}
					<button
						type="button"
						class:active={pivots[icon][0] === p.value[0] && pivots[icon][1] === p.value[1]}
						onclick={() => (pivots[icon] = [p.value[0], p.value[1]])}
						title={`(${p.value[0]}, ${p.value[1]})`}
						aria-label={`Set pivot to (${p.value[0]}, ${p.value[1]})`}
					>
						{p.label}
					</button>
				{/each}
			</div>
			{#each ROTATIONS as r (r)}
				<div class="cell">
					<div class="bg"></div>
					<div class="dot"></div>
					<div style={spriteStyle(icon, pivots[icon], r)}></div>
				</div>
			{/each}
		{/each}
	</div>
</main>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		background: #0d1117;
		color: #e6edf3;
		font-family: system-ui, sans-serif;
	}
	.page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 100vw;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 720px;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
	}
	.lede {
		margin: 0;
		font-size: 13px;
		color: #aaa;
		line-height: 1.5;
	}
	code {
		background: rgba(255, 255, 255, 0.08);
		padding: 1px 4px;
		border-radius: 3px;
	}
	button {
		align-self: flex-start;
		padding: 0.4rem 0.8rem;
		background: #4a9eff;
		border: none;
		border-radius: 4px;
		color: #fff;
		cursor: pointer;
		font-weight: 600;
	}
	.snapshot {
		max-width: 720px;
		padding: 0.6rem 0.8rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid #333;
		border-radius: 4px;
		font:
			12px/1.4 ui-monospace,
			monospace;
		color: #ddd;
		white-space: pre;
		overflow-x: auto;
		user-select: all;
	}
	.grid {
		display: grid;
		grid-template-columns: 200px 110px 96px repeat(8, var(--cell));
		gap: 8px;
		align-items: center;
	}
	.hdr {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		text-align: center;
		padding-bottom: 4px;
		border-bottom: 1px solid #2a2f37;
	}
	.row-label {
		font:
			12px ui-monospace,
			monospace;
		color: #ccc;
		padding-right: 0.5rem;
		text-align: right;
	}
	.pivot-cell {
		display: flex;
		gap: 4px;
	}
	.pivot-cell input {
		width: 48px;
		padding: 0.25rem 0.3rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #ddd;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 2px;
	}
	.presets button {
		padding: 0;
		width: 28px;
		height: 24px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #2a2f37;
		color: #888;
		font:
			14px/1 ui-monospace,
			monospace;
		font-weight: normal;
		cursor: pointer;
		align-self: center;
	}
	.presets button:hover {
		border-color: #4a9eff;
		color: #ddd;
	}
	.presets button.active {
		background: rgba(74, 158, 255, 0.18);
		border-color: #4a9eff;
		color: #fff;
	}
	.cell {
		position: relative;
		width: var(--cell);
		height: var(--cell);
		background: #1a1f27;
		border: 1px solid #222;
		overflow: hidden;
	}
	.bg {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
			linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
		background-size: 8px 8px;
		background-position: center center;
	}
	.dot {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 5px;
		height: 5px;
		margin: -2.5px 0 0 -2.5px;
		background: #ff3030;
		border-radius: 50%;
		z-index: 2;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
	}
</style>
