<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import {
		ANNOTATION_ICONS,
		DEFAULT_ANNOTATION_COLOR,
		type Annotation,
		type AnnotationIcon
	} from '../types';

	let { store }: { store: AnimationStore } = $props();

	const ann = $derived(store.selectedAnnotation);
	const idx = $derived(store.selectedAnnotationIndex);

	function patch(p: Partial<Annotation>): void {
		if (idx !== null) store.updateAnnotation(idx, p);
	}

	function shortName(icon: string): string {
		return icon.replace(/^symbol-/, '').replace(/^icon-/, '');
	}
	function normalizeHex(c: string): string {
		// <input type=color> requires #rrggbb (no shorthand, no alpha). Falling
		// back to white prevents the picker from snapping to black on garbage.
		const six = /^#([0-9a-fA-F]{6})$/.exec(c.trim());
		if (six) return '#' + six[1].toLowerCase();
		const three = /^#([0-9a-fA-F]{3})$/.exec(c.trim());
		if (three) {
			const [r, g, b] = three[1];
			return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
		}
		return DEFAULT_ANNOTATION_COLOR;
	}

	function onLabel(e: Event) {
		patch({ label: (e.currentTarget as HTMLInputElement).value });
	}
	function onColor(e: Event) {
		patch({ color: (e.currentTarget as HTMLInputElement).value });
	}
	function onIcon(icon: AnnotationIcon) {
		patch({ icon });
	}
	function onRotation(e: Event) {
		patch({ rotation: Number((e.currentTarget as HTMLInputElement).value) });
	}
	function onIconSize(e: Event) {
		patch({ iconSize: Number((e.currentTarget as HTMLInputElement).value) });
	}
	function onLabelSize(e: Event) {
		patch({ labelSize: Number((e.currentTarget as HTMLInputElement).value) });
	}
	function onVisibleFrom(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value;
		patch({ visibleFrom: raw === '' ? undefined : Math.max(0, Number(raw)) });
	}
	function onVisibleUntil(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value;
		patch({ visibleUntil: raw === '' ? undefined : Math.max(0, Number(raw)) });
	}
	function onClearFrom() {
		patch({ visibleFrom: undefined });
	}
	function onClearUntil() {
		patch({ visibleUntil: undefined });
	}
	function onMoveHere() {
		const cam = store.liveCamera;
		patch({ lng: cam.lng, lat: cam.lat });
	}
	function onDelete() {
		if (idx !== null) store.deleteAnnotation(idx);
	}
	function onClose() {
		store.clearAnnotationSelection();
	}
</script>

{#if ann && idx !== null}
	<aside class="annotation-panel" role="region" aria-label="Annotation editor">
		<header>
			<span class="title">Annotation #{idx + 1}</span>
			<button type="button" class="close" onclick={onClose} aria-label="Close" title="Close">
				✕
			</button>
		</header>

		<label class="row">
			<span class="lbl">Label</span>
			<input type="text" value={ann.label} oninput={onLabel} placeholder="(no label)" />
		</label>

		<div class="row">
			<span class="lbl">Icon</span>
			<div class="icon-grid">
				{#each ANNOTATION_ICONS as icon (icon)}
					<button
						type="button"
						class:selected={ann.icon === icon}
						onclick={() => onIcon(icon)}
						title={icon}
						aria-label={icon}
					>
						<!-- Use the same sprite the map uses, fetched separately. The
							 sprite sheet ships SVG-style atlases; rendering here would
							 require slicing. As a placeholder, show the short name. -->
						<span class="icon-name">{shortName(icon)}</span>
					</button>
				{/each}
			</div>
		</div>

		<label class="row">
			<span class="lbl">Color</span>
			<input
				type="color"
				value={normalizeHex(ann.color)}
				oninput={onColor}
				aria-label="Annotation color"
			/>
			<span class="hex">{ann.color}</span>
		</label>

		<label class="row">
			<span class="lbl">Rotation</span>
			<input
				type="range"
				min="0"
				max="359"
				step="1"
				value={ann.rotation ?? 0}
				oninput={onRotation}
			/>
			<span class="num">{Math.round(ann.rotation ?? 0)}°</span>
		</label>

		<label class="row">
			<span class="lbl">Icon size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={ann.iconSize ?? 1}
				oninput={onIconSize}
			/>
			<span class="num">{(ann.iconSize ?? 1).toFixed(2)}×</span>
		</label>

		<label class="row">
			<span class="lbl">Label size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={ann.labelSize ?? 1}
				oninput={onLabelSize}
			/>
			<span class="num">{(ann.labelSize ?? 1).toFixed(2)}×</span>
		</label>

		<div class="row visibility">
			<span class="lbl">Visible</span>
			<div class="visibility-grid">
				<span class="sublbl">from</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.visibleFrom ?? ''}
					oninput={onVisibleFrom}
					placeholder="start"
				/>
				<button
					type="button"
					class="mini"
					onclick={onClearFrom}
					disabled={ann.visibleFrom === undefined}
					title="Show from the start of the animation"
				>
					⟲
				</button>
				<span class="sublbl">until</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.visibleUntil ?? ''}
					oninput={onVisibleUntil}
					placeholder="end"
				/>
				<button
					type="button"
					class="mini"
					onclick={onClearUntil}
					disabled={ann.visibleUntil === undefined}
					title="Show until the end of the animation"
				>
					⟲
				</button>
			</div>
		</div>

		<div class="row position">
			<span class="lbl">Position</span>
			<span class="coord">
				{ann.lat.toFixed(4)}, {ann.lng.toFixed(4)}
			</span>
			<button
				type="button"
				class="mini"
				onclick={onMoveHere}
				title="Move this annotation to the current map center"
			>
				⤴ Move here
			</button>
		</div>

		<footer>
			<button type="button" class="danger" onclick={onDelete}>✕ Delete</button>
		</footer>
	</aside>
{/if}

<style>
	.annotation-panel {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		z-index: 5;
		min-width: 250px;
		max-width: 280px;
		padding: 0.65rem 0.75rem 0.55rem;
		background: rgba(13, 17, 23, 0.92);
		border: 1px solid #2a2f37;
		border-radius: 6px;
		color: #ddd;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		backdrop-filter: blur(8px);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.15rem;
	}
	.title {
		font-size: 12px;
		font-weight: 600;
		color: #ccc;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.close {
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		padding: 0 0.2rem;
		font-size: 14px;
		line-height: 1;
	}
	.close:hover {
		color: #fff;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.row.visibility,
	.row.position {
		align-items: flex-start;
	}
	.row .lbl {
		flex: 0 0 auto;
		width: 60px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}

	input[type='text'],
	input[type='number'] {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.3rem 0.45rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
	}
	input[type='text']:focus,
	input[type='number']:focus {
		outline: none;
		border-color: #4a9eff;
	}
	input[type='color'] {
		width: 36px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: 1px solid #333;
		border-radius: 4px;
		cursor: pointer;
	}
	input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
	}
	.num,
	.hex,
	.coord {
		font-variant-numeric: tabular-nums;
		color: #aaa;
		font-size: 11px;
	}
	.coord {
		flex: 1 1 auto;
	}

	.icon-grid {
		flex: 1 1 auto;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
	}
	.icon-grid button {
		padding: 0.25rem 0.1rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #2a2f37;
		border-radius: 3px;
		color: #aaa;
		font-size: 10px;
		font-family: inherit;
		cursor: pointer;
		min-height: 26px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.icon-grid button:hover {
		border-color: #4a9eff;
		color: #ddd;
	}
	.icon-grid button.selected {
		border-color: #4a9eff;
		background: rgba(74, 158, 255, 0.18);
		color: #fff;
	}
	.icon-name {
		display: block;
		text-align: center;
		line-height: 1.1;
		word-break: break-all;
	}

	.visibility-grid {
		flex: 1 1 auto;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.25rem 0.4rem;
		align-items: center;
	}
	.sublbl {
		color: #888;
		font-size: 11px;
	}

	.mini {
		padding: 0.2rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 3px;
		color: #aaa;
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.mini:hover:not(:disabled) {
		border-color: #4a9eff;
		color: #ddd;
	}
	.mini:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.2rem;
	}
	.danger {
		padding: 0.3rem 0.6rem;
		background: rgba(255, 80, 80, 0.12);
		border: 1px solid rgba(255, 80, 80, 0.35);
		border-radius: 4px;
		color: #ffaaaa;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.danger:hover {
		background: rgba(255, 80, 80, 0.22);
		color: #fff;
	}
</style>
