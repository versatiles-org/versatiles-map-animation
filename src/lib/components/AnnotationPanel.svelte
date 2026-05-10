<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { spritePreviewStyle } from '../sprite_meta';
	import {
		ANNOTATION_ICONS,
		ANNOTATION_LABEL_FONTS,
		DEFAULT_ANNOTATION_COLOR,
		DEFAULT_ANNOTATION_ICON,
		DEFAULT_ANNOTATION_LABEL_COLOR,
		DEFAULT_ANNOTATION_LABEL_FONT,
		DEFAULT_ICON_HALO_COLOR,
		DEFAULT_ICON_HALO_WIDTH,
		DEFAULT_LABEL_DISTANCE,
		DEFAULT_LABEL_HALO_WIDTH,
		DEFAULT_LABEL_POSITION,
		fontFamilyOf,
		fontVariantLabel,
		type Annotation,
		type AnnotationIcon,
		type AnnotationLabelFont,
		type LabelPosition
	} from '../types';

	let { store }: { store: AnimationStore } = $props();

	let iconMenuOpen = $state(false);
	let iconMenuEl: HTMLDivElement | undefined = $state();

	const ann = $derived(store.selectedAnnotation);
	const idx = $derived(store.selectedAnnotationIndex);

	function patch(p: Partial<Annotation>): void {
		if (idx !== null) store.updateAnnotation(idx, p);
	}

	function shortName(icon: string): string {
		return icon.replace(/^symbol-/, '').replace(/^icon-/, '');
	}
	// Mirror MapStage's auto-flip so the picker shows the same color the map
	// would render when the user hasn't customised the halo.
	function haloAuto(hex: string): string {
		const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
		if (!m) return '#ffffff';
		const n = parseInt(m[1], 16);
		const r = (n >> 16) & 0xff;
		const g = (n >> 8) & 0xff;
		const b = n & 0xff;
		const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return lum > 0.5 ? '#000000' : '#ffffff';
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

	// Generic field binders parameterised by the target (annotation vs default
	// style) so the same input markup can edit either. The `styleFields`
	// snippet at the bottom of the template uses these factories with the
	// per-call `doPatch`, so handlers always update the right target.
	function makeOnText(doPatch: (p: Partial<Annotation>) => void) {
		return <K extends keyof Annotation>(key: K) =>
			(e: Event) =>
				doPatch({ [key]: (e.currentTarget as HTMLInputElement).value } as Partial<Annotation>);
	}
	function makeOnNum(doPatch: (p: Partial<Annotation>) => void) {
		return <K extends keyof Annotation>(key: K) =>
			(e: Event) =>
				doPatch({
					[key]: Number((e.currentTarget as HTMLInputElement).value)
				} as Partial<Annotation>);
	}

	// Per-annotation handlers (the `selected` markup uses these directly).
	const onText = makeOnText(patch);
	const onNum = makeOnNum(patch);

	/**
	 * Hardcoded fallbacks for fields that need a real value at render time.
	 * Used by per-annotation reset to guarantee required fields (icon,
	 * iconColor) end up with a usable value when neither the annotation nor
	 * `defaultAnnotation` has one. Optional fields not listed here resolve
	 * to `undefined` on reset, which `updateAnnotation` then deletes.
	 */
	const HARDCODED_DEFAULTS: Partial<Annotation> = {
		icon: DEFAULT_ANNOTATION_ICON,
		iconColor: DEFAULT_ANNOTATION_COLOR
	};

	/**
	 * Reset the listed fields on the currently-selected annotation.
	 * Resolves each field through user defaults → hardcoded baseline; sets
	 * the result on the annotation. `undefined` (no defaults at any layer)
	 * is treated by `updateAnnotation` as "remove the override" so the field
	 * disappears from the JSON/URL.
	 */
	function resetAnnFields(...keys: (keyof Annotation)[]): void {
		if (idx === null) return;
		const p: Record<string, unknown> = {};
		for (const k of keys) {
			const fromDefault = (store.defaultAnnotation as Record<string, unknown>)[k];
			const hardcoded = (HARDCODED_DEFAULTS as Record<string, unknown>)[k];
			p[k] = fromDefault ?? hardcoded;
		}
		store.updateAnnotation(idx, p as Partial<Annotation>);
	}
	function isAnnSet(...keys: (keyof Annotation)[]): boolean {
		return ann !== null && keys.some((k) => k in ann);
	}

	// Default-style mode: the AnnotationPanel shows the same Icon/Label fields
	// when no marker is selected, but they edit `store.defaultAnnotation`
	// instead of any specific annotation.
	function patchDefault(p: Partial<Annotation>): void {
		store.defaultAnnotation = { ...store.defaultAnnotation, ...p };
	}
	/**
	 * Remove the given fields from `store.defaultAnnotation` — the input then
	 * shows the hardcoded baseline (DEFAULT_X) and new markers no longer
	 * inherit a value for that field. Called by per-row reset buttons.
	 */
	function unsetDefaults(...keys: (keyof Annotation)[]): void {
		const next = { ...store.defaultAnnotation };
		for (const k of keys) delete next[k];
		store.defaultAnnotation = next;
	}
	function isDefaultSet(...keys: (keyof Annotation)[]): boolean {
		return keys.some((k) => k in store.defaultAnnotation);
	}
	const defaults = $derived(store.defaultAnnotation);
	const onTextDefault = makeOnText(patchDefault);
	const onNumDefault = makeOnNum(patchDefault);

	function onIcon(icon: AnnotationIcon) {
		patch({ icon });
		iconMenuOpen = false;
	}
	function onIconDefault(icon: AnnotationIcon) {
		patchDefault({ icon });
		iconMenuDefaultOpen = false;
	}

	// Icon menu open state per surface (selected vs default), so opening the
	// picker in one mode doesn't leak into the other.
	let iconMenuDefaultOpen = $state(false);
	let iconMenuDefaultEl: HTMLDivElement | undefined = $state();

	function handleDocClick(e: MouseEvent) {
		if (iconMenuOpen && iconMenuEl && !iconMenuEl.contains(e.target as Node)) iconMenuOpen = false;
		if (iconMenuDefaultOpen && iconMenuDefaultEl && !iconMenuDefaultEl.contains(e.target as Node))
			iconMenuDefaultOpen = false;
	}

	$effect(() => {
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});

	// Group all 187 fonts by family so the `<select>` can render them under
	// `<optgroup>`s — the flat list is overwhelming, but most users want
	// "pick a family, pick a weight" and `<optgroup>` matches that mental
	// model. The upstream font list interleaves families lexicographically
	// (e.g. `fira_sans_bold` < `fira_sans_condensed_*` < `fira_sans_extrabold`),
	// so we collect by family into a plain object and preserve first-encounter
	// family order — which keeps the grouping stable without depending on
	// adjacent ordering in the source.
	const FONT_GROUPS: { family: string; fonts: AnnotationLabelFont[] }[] = (() => {
		const order: string[] = [];
		const byFamily: Record<string, AnnotationLabelFont[]> = {};
		for (const f of ANNOTATION_LABEL_FONTS) {
			const fam = fontFamilyOf(f);
			if (!(fam in byFamily)) {
				byFamily[fam] = [];
				order.push(fam);
			}
			byFamily[fam].push(f);
		}
		return order.map((family) => ({ family, fonts: byFamily[family] }));
	})();
	function familyLabel(family: string): string {
		return family
			.split('_')
			.map((s) => s[0].toUpperCase() + s.slice(1))
			.join(' ');
	}
	function onLabelFont(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value as AnnotationLabelFont;
		patch({ labelFont: v });
	}
	function onLabelFontDefault(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value as AnnotationLabelFont;
		patchDefault({ labelFont: v });
	}

	// 3×3 grid of label-position options. The dot in the center represents
	// the icon; each surrounding slot is one cardinal/diagonal placement.
	const POSITION_GRID: { label: string; value: LabelPosition }[] = [
		{ label: '↖', value: 'top-left' },
		{ label: '↑', value: 'top' },
		{ label: '↗', value: 'top-right' },
		{ label: '←', value: 'left' },
		{ label: '·', value: 'center' },
		{ label: '→', value: 'right' },
		{ label: '↙', value: 'bottom-left' },
		{ label: '↓', value: 'bottom' },
		{ label: '↘', value: 'bottom-right' }
	];
	// Visibility/fade are time values displayed as numbers in the panel and
	// also driven by the timeline drag handles. Two invariants we enforce
	// uniformly here:
	//   1. visibleFrom + ANN_MIN_GAP ≤ visibleUntil (matches the timeline)
	//   2. fadeIn / fadeOut ≥ 0 and stay ≤ their reference bound
	// Plus we round all four to centi-second precision so dragged values
	// don't stick floating-point dust into the input fields.
	const ANN_MIN_GAP = 0.01;
	const round2 = (v: number) => Math.round(v * 100) / 100;

	function readNonNegativeOrUndefined(e: Event): number | undefined {
		const raw = (e.currentTarget as HTMLInputElement).value;
		if (raw === '') return undefined;
		const v = Number(raw);
		return Number.isFinite(v) ? Math.max(0, v) : undefined;
	}

	// Svelte 5 short-circuits `<input value={x}>` updates when `x` is unchanged
	// from the previous render — but the user's intermediate typing may have
	// changed the DOM in between, so the clamped value never makes it back to
	// the field. Force the DOM to mirror the clamped value after every patch.
	function syncInput(input: HTMLInputElement, v: number | undefined): void {
		const want = v === undefined ? '' : String(v);
		if (input.value !== want) input.value = want;
	}

	function onVisibleFrom(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = readNonNegativeOrUndefined(e);
		if (raw === undefined) {
			// Clearing the bound also resets its fade — a dangling fadeIn would
			// be silently invisible (the opacity helper ignores it when there's
			// no anchor) but would still persist via the codec, and re-enabling
			// the bound would surprise the user with a fade they didn't ask for.
			patch({ visibleFrom: undefined, fadeIn: 0 });
			return;
		}
		const until = ann?.visibleUntil;
		const max = until !== undefined ? until - ANN_MIN_GAP : Number.POSITIVE_INFINITY;
		const clamped = round2(Math.min(max, raw));
		patch({ visibleFrom: clamped });
		syncInput(input, clamped);
	}
	function onVisibleUntil(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const raw = readNonNegativeOrUndefined(e);
		if (raw === undefined) {
			patch({ visibleUntil: undefined, fadeOut: 0 });
			return;
		}
		const from = ann?.visibleFrom;
		const min = from !== undefined ? from + ANN_MIN_GAP : 0;
		const clamped = round2(Math.max(min, raw));
		patch({ visibleUntil: clamped });
		syncInput(input, clamped);
	}
	function onFadeIn(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v)) {
			patch({ fadeIn: 0 });
			syncInput(input, 0);
			return;
		}
		// Fade-in can't extend past the visible-from time (would push the
		// fade-in tip into negative time). With no visibleFrom set, fade-in
		// has no anchor — clamp to a sane upper bound to keep the input tidy.
		const from = ann?.visibleFrom;
		const max = from !== undefined ? from : Number.POSITIVE_INFINITY;
		const clamped = round2(Math.max(0, Math.min(max, v)));
		patch({ fadeIn: clamped });
		syncInput(input, clamped);
	}
	function onFadeOut(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (!Number.isFinite(v)) {
			patch({ fadeOut: 0 });
			syncInput(input, 0);
			return;
		}
		const clamped = round2(Math.max(0, v));
		patch({ fadeOut: clamped });
		syncInput(input, clamped);
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

<div class="annotation-panel">
	{#if ann && idx !== null}
		<div class="title-row">
			<span class="title">Annotation #{idx + 1}</span>
			<button
				type="button"
				class="close"
				onclick={onClose}
				aria-label="Deselect annotation"
				title="Deselect"
			>
				✕
			</button>
		</div>

		<!-- Icon section: shape + appearance + orientation -->
		<h3 class="section">Icon</h3>

		<div class="row">
			<span class="lbl">Shape</span>
			<div class="icon-dropdown" bind:this={iconMenuEl}>
				<button
					type="button"
					class="icon-trigger"
					onclick={() => (iconMenuOpen = !iconMenuOpen)}
					aria-haspopup="listbox"
					aria-expanded={iconMenuOpen}
					title={ann.icon}
				>
					<span class="icon-prev" style={spritePreviewStyle(ann.icon, 22)}></span>
					<span class="icon-name">{shortName(ann.icon)}</span>
					<span class="caret" aria-hidden="true">▾</span>
				</button>
				{#if iconMenuOpen}
					<ul class="icon-menu" role="listbox" aria-label="Icon">
						{#each ANNOTATION_ICONS as icon (icon)}
							<li>
								<button
									type="button"
									class="icon-option"
									class:selected={ann.icon === icon}
									onclick={() => onIcon(icon)}
									role="option"
									aria-selected={ann.icon === icon}
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
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('icon')}
				title="Reset shape to the current default"
				aria-label="Reset shape">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Color</span>
			<input
				type="color"
				value={normalizeHex(ann.iconColor)}
				oninput={onText('iconColor')}
				aria-label="Icon color"
			/>
			<span class="hex">{ann.iconColor}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('iconColor')}
				title="Reset color to the current default"
				aria-label="Reset icon color">⟲</button
			>
		</label>

		<div class="row">
			<span class="lbl">Halo</span>
			<input
				type="color"
				value={normalizeHex(ann.iconHaloColor ?? DEFAULT_ICON_HALO_COLOR)}
				oninput={onText('iconHaloColor')}
				aria-label="Icon halo color"
				title="Halo (icon outline) color. Default white; only visible when width > 0."
			/>
			<input
				class="halo-width"
				type="range"
				min="0"
				max="4"
				step="0.1"
				value={ann.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH}
				oninput={onNum('iconHaloWidth')}
				aria-label="Icon halo width"
				title="Halo width in px. 0 turns the halo off (default)."
			/>
			<span class="num">{(ann.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH).toFixed(1)}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('iconHaloColor', 'iconHaloWidth')}
				disabled={!isAnnSet('iconHaloColor', 'iconHaloWidth')}
				title="Reset icon halo to the current default"
				aria-label="Reset icon halo">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={ann.iconSize ?? 1}
				oninput={onNum('iconSize')}
			/>
			<span class="num">{(ann.iconSize ?? 1).toFixed(2)}×</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('iconSize')}
				disabled={!isAnnSet('iconSize')}
				title="Reset size to the current default"
				aria-label="Reset icon size">⟲</button
			>
		</label>

		<label class="row">
			<span class="lbl">Rotation</span>
			<input
				type="range"
				min="0"
				max="359"
				step="1"
				value={ann.rotation ?? 0}
				oninput={onNum('rotation')}
			/>
			<span class="num">{Math.round(ann.rotation ?? 0)}°</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('rotation')}
				disabled={!isAnnSet('rotation')}
				title="Reset rotation to 0"
				aria-label="Reset rotation">⟲</button
			>
		</label>

		<!-- Label section: text + appearance + placement -->
		<h3 class="section">Label</h3>

		<label class="row text-row">
			<span class="lbl">Text</span>
			<textarea
				class="label-text"
				value={ann.label}
				oninput={onText('label')}
				placeholder="(no label)"
				rows="2"
				title="Press Enter for a line break — MapLibre renders \\n as a hard wrap in the label."
			></textarea>
		</label>

		<label class="row">
			<span class="lbl">Font</span>
			<select
				class="font-select"
				value={ann.labelFont ?? DEFAULT_ANNOTATION_LABEL_FONT}
				onchange={onLabelFont}
				title="Glyph font for this label. Drawn from the VersaTiles tileserver's bundled fonts."
			>
				{#each FONT_GROUPS as g (g.family)}
					<optgroup label={familyLabel(g.family)}>
						{#each g.fonts as f (f)}
							<option value={f}>{fontVariantLabel(f)}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('labelFont')}
				disabled={!isAnnSet('labelFont')}
				title="Reset font to the current default"
				aria-label="Reset font">⟲</button
			>
		</label>

		<label class="row">
			<span class="lbl">Color</span>
			<input
				type="color"
				value={normalizeHex(ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)}
				oninput={onText('labelColor')}
				aria-label="Label color"
				title="Label text color. The halo defaults to a contrasting brightness; override below."
			/>
			<span class="hex">{ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('labelColor')}
				disabled={!isAnnSet('labelColor')}
				title="Reset label color to the current default"
				aria-label="Reset label color">⟲</button
			>
		</label>

		<div class="row">
			<span class="lbl">Halo</span>
			<input
				type="color"
				value={normalizeHex(
					ann.labelHaloColor ?? haloAuto(ann.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)
				)}
				oninput={onText('labelHaloColor')}
				aria-label="Label halo color"
				title="Halo (text outline) color. Defaults to a contrasting brightness; pick to override."
			/>
			<input
				class="halo-width"
				type="range"
				min="0"
				max="4"
				step="0.1"
				value={ann.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH}
				oninput={onNum('labelHaloWidth')}
				aria-label="Label halo width"
				title="Halo width in px. 0 turns the halo off."
			/>
			<span class="num">{(ann.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH).toFixed(1)}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('labelHaloColor', 'labelHaloWidth')}
				disabled={!isAnnSet('labelHaloColor', 'labelHaloWidth')}
				title="Reset label halo to the current default"
				aria-label="Reset label halo">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={ann.labelSize ?? 1}
				oninput={onNum('labelSize')}
			/>
			<span class="num">{(ann.labelSize ?? 1).toFixed(2)}×</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('labelSize')}
				disabled={!isAnnSet('labelSize')}
				title="Reset label size to the current default"
				aria-label="Reset label size">⟲</button
			>
		</label>

		<div class="row">
			<span class="lbl">Side</span>
			<div class="pos-grid">
				{#each POSITION_GRID as p (p.value)}
					<button
						type="button"
						class:active={(ann.labelPosition ?? DEFAULT_LABEL_POSITION) === p.value}
						onclick={() => patch({ labelPosition: p.value })}
						title={p.value}
						aria-label={`Place label ${p.value}`}
					>
						{p.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('labelPosition')}
				disabled={!isAnnSet('labelPosition')}
				title="Reset label position to the current default"
				aria-label="Reset label position">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Gap</span>
			<input
				type="range"
				min="0"
				max="5"
				step="0.1"
				value={ann.labelDistance ?? DEFAULT_LABEL_DISTANCE}
				oninput={onNum('labelDistance')}
			/>
			<span class="num">{(ann.labelDistance ?? DEFAULT_LABEL_DISTANCE).toFixed(1)}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => resetAnnFields('labelDistance')}
				disabled={!isAnnSet('labelDistance')}
				title="Reset gap to the current default"
				aria-label="Reset gap">⟲</button
			>
		</label>

		<!-- Visibility section: time window + fade tails -->
		<h3 class="section">Visibility</h3>

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
					onclick={() => patch({ visibleFrom: undefined, fadeIn: 0 })}
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
					onclick={() => patch({ visibleUntil: undefined, fadeOut: 0 })}
					disabled={ann.visibleUntil === undefined}
					title="Show until the end of the animation"
				>
					⟲
				</button>
			</div>
		</div>

		<div class="row visibility">
			<span class="lbl">Fade</span>
			<div class="visibility-grid">
				<span class="sublbl">in</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.fadeIn ?? 0}
					oninput={onFadeIn}
					disabled={ann.visibleFrom === undefined}
					title={ann.visibleFrom === undefined
						? 'Fade-in needs a "Visible from" time'
						: 'Seconds the marker takes to fade in before its visible-from time'}
					placeholder="0"
				/>
				<span class="sublbl">s</span>
				<span class="sublbl">out</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={ann.fadeOut ?? 0}
					oninput={onFadeOut}
					disabled={ann.visibleUntil === undefined}
					title={ann.visibleUntil === undefined
						? 'Fade-out needs a "Visible until" time'
						: 'Seconds the marker takes to fade out after its visible-until time'}
					placeholder="0"
				/>
				<span class="sublbl">s</span>
			</div>
		</div>

		<!-- Position section: lat/lng + helper -->
		<h3 class="section">Position</h3>

		<div class="row position">
			<span class="lbl">Coords</span>
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
	{:else}
		<!-- Empty state: list of all markers + a default-style editor.
		     Both let the user work without first selecting a single marker. -->
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

		<div class="default-style-header">
			<h3 class="section">Default style</h3>
			<button
				type="button"
				class="mini"
				onclick={() => (store.defaultAnnotation = {})}
				disabled={Object.keys(store.defaultAnnotation).length === 0}
				title="Clear every default — new markers fall back to the hardcoded baseline"
			>
				Reset all
			</button>
		</div>
		<p class="hint">
			Style applied to <strong>new</strong> markers (Pin button). Doesn't change existing ones. The
			<strong>⟲</strong> next to each row clears just that field.
		</p>

		<!-- Icon -->
		<div class="row">
			<span class="lbl">Shape</span>
			<div class="icon-dropdown" bind:this={iconMenuDefaultEl}>
				<button
					type="button"
					class="icon-trigger"
					onclick={() => (iconMenuDefaultOpen = !iconMenuDefaultOpen)}
					aria-haspopup="listbox"
					aria-expanded={iconMenuDefaultOpen}
					title={defaults.icon ?? DEFAULT_ANNOTATION_ICON}
				>
					<span
						class="icon-prev"
						style={spritePreviewStyle(defaults.icon ?? DEFAULT_ANNOTATION_ICON, 22)}
					></span>
					<span class="icon-name">{shortName(defaults.icon ?? DEFAULT_ANNOTATION_ICON)}</span>
					<span class="caret" aria-hidden="true">▾</span>
				</button>
				{#if iconMenuDefaultOpen}
					<ul class="icon-menu" role="listbox" aria-label="Default icon">
						{#each ANNOTATION_ICONS as icon (icon)}
							<li>
								<button
									type="button"
									class="icon-option"
									class:selected={(defaults.icon ?? DEFAULT_ANNOTATION_ICON) === icon}
									onclick={() => onIconDefault(icon)}
									role="option"
									aria-selected={(defaults.icon ?? DEFAULT_ANNOTATION_ICON) === icon}
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
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('icon')}
				disabled={!isDefaultSet('icon')}
				title="Reset shape to the hardcoded default"
				aria-label="Reset default shape">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Color</span>
			<input
				type="color"
				value={normalizeHex(defaults.iconColor ?? DEFAULT_ANNOTATION_COLOR)}
				oninput={onTextDefault('iconColor')}
				aria-label="Default icon color"
			/>
			<span class="hex">{defaults.iconColor ?? DEFAULT_ANNOTATION_COLOR}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('iconColor')}
				disabled={!isDefaultSet('iconColor')}
				title="Reset icon color to the hardcoded default"
				aria-label="Reset default icon color">⟲</button
			>
		</label>

		<div class="row">
			<span class="lbl">Halo</span>
			<input
				type="color"
				value={normalizeHex(defaults.iconHaloColor ?? DEFAULT_ICON_HALO_COLOR)}
				oninput={onTextDefault('iconHaloColor')}
				aria-label="Default icon halo color"
			/>
			<input
				class="halo-width"
				type="range"
				min="0"
				max="4"
				step="0.1"
				value={defaults.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH}
				oninput={onNumDefault('iconHaloWidth')}
				aria-label="Default icon halo width"
			/>
			<span class="num">{(defaults.iconHaloWidth ?? DEFAULT_ICON_HALO_WIDTH).toFixed(1)}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('iconHaloColor', 'iconHaloWidth')}
				disabled={!isDefaultSet('iconHaloColor', 'iconHaloWidth')}
				title="Reset icon halo to the hardcoded default"
				aria-label="Reset default icon halo">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={defaults.iconSize ?? 1}
				oninput={onNumDefault('iconSize')}
			/>
			<span class="num">{(defaults.iconSize ?? 1).toFixed(2)}×</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('iconSize')}
				disabled={!isDefaultSet('iconSize')}
				title="Reset icon size to the hardcoded default"
				aria-label="Reset default icon size">⟲</button
			>
		</label>

		<!-- Label -->
		<h3 class="section">Default label</h3>

		<label class="row">
			<span class="lbl">Font</span>
			<select
				class="font-select"
				value={defaults.labelFont ?? DEFAULT_ANNOTATION_LABEL_FONT}
				onchange={onLabelFontDefault}
			>
				{#each FONT_GROUPS as g (g.family)}
					<optgroup label={familyLabel(g.family)}>
						{#each g.fonts as f (f)}
							<option value={f}>{fontVariantLabel(f)}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('labelFont')}
				disabled={!isDefaultSet('labelFont')}
				title="Reset font to the hardcoded default"
				aria-label="Reset default font">⟲</button
			>
		</label>

		<label class="row">
			<span class="lbl">Color</span>
			<input
				type="color"
				value={normalizeHex(defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)}
				oninput={onTextDefault('labelColor')}
				aria-label="Default label color"
			/>
			<span class="hex">{defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('labelColor')}
				disabled={!isDefaultSet('labelColor')}
				title="Reset label color to the hardcoded default"
				aria-label="Reset default label color">⟲</button
			>
		</label>

		<div class="row">
			<span class="lbl">Halo</span>
			<input
				type="color"
				value={normalizeHex(
					defaults.labelHaloColor ?? haloAuto(defaults.labelColor ?? DEFAULT_ANNOTATION_LABEL_COLOR)
				)}
				oninput={onTextDefault('labelHaloColor')}
				aria-label="Default label halo color"
			/>
			<input
				class="halo-width"
				type="range"
				min="0"
				max="4"
				step="0.1"
				value={defaults.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH}
				oninput={onNumDefault('labelHaloWidth')}
				aria-label="Default label halo width"
			/>
			<span class="num">{(defaults.labelHaloWidth ?? DEFAULT_LABEL_HALO_WIDTH).toFixed(1)}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('labelHaloColor', 'labelHaloWidth')}
				disabled={!isDefaultSet('labelHaloColor', 'labelHaloWidth')}
				title="Reset label halo to the hardcoded default"
				aria-label="Reset default label halo">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={defaults.labelSize ?? 1}
				oninput={onNumDefault('labelSize')}
			/>
			<span class="num">{(defaults.labelSize ?? 1).toFixed(2)}×</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('labelSize')}
				disabled={!isDefaultSet('labelSize')}
				title="Reset label size to the hardcoded default"
				aria-label="Reset default label size">⟲</button
			>
		</label>

		<div class="row">
			<span class="lbl">Side</span>
			<div class="pos-grid">
				{#each POSITION_GRID as p (p.value)}
					<button
						type="button"
						class:active={(defaults.labelPosition ?? DEFAULT_LABEL_POSITION) === p.value}
						onclick={() => patchDefault({ labelPosition: p.value })}
						title={p.value}
						aria-label={`Default label position ${p.value}`}
					>
						{p.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('labelPosition')}
				disabled={!isDefaultSet('labelPosition')}
				title="Reset label position to the hardcoded default"
				aria-label="Reset default label position">⟲</button
			>
		</div>

		<label class="row">
			<span class="lbl">Gap</span>
			<input
				type="range"
				min="0"
				max="5"
				step="0.1"
				value={defaults.labelDistance ?? DEFAULT_LABEL_DISTANCE}
				oninput={onNumDefault('labelDistance')}
			/>
			<span class="num">{(defaults.labelDistance ?? DEFAULT_LABEL_DISTANCE).toFixed(1)}</span>
			<button
				type="button"
				class="mini reset"
				onclick={() => unsetDefaults('labelDistance')}
				disabled={!isDefaultSet('labelDistance')}
				title="Reset gap to the hardcoded default"
				aria-label="Reset default gap">⟲</button
			>
		</label>
	{/if}
</div>

<style>
	.annotation-panel {
		color: #ddd;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.placeholder,
	.hint {
		margin: 0.2rem 0;
		font-size: 12px;
		color: #888;
		line-height: 1.45;
	}
	.hint {
		font-size: 11px;
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
		/* The first non-empty line of a multi-line label is enough to
		   identify the marker; collapse newlines so the row stays one line. */
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
	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.15rem;
	}
	.section {
		margin: 0.4rem 0 0.1rem;
		padding: 0.2rem 0 0.15rem;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: #888;
		border-top: 1px solid #2a2f37;

		/* The first section heading sits right after the title-row, so the top
		   border would double up with the title-row's bottom-margin gap. Drop it. */
		&:first-of-type {
			border-top: none;
			margin-top: 0.1rem;
		}
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

		&:hover {
			color: #fff;
		}
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;

		&.visibility,
		&.position {
			align-items: flex-start;
		}
		.lbl {
			flex: 0 0 auto;
			width: 60px;
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #888;
		}
	}

	input[type='text'],
	input[type='number'],
	.label-text {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0.3rem 0.45rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;

		&:focus {
			outline: none;
			border-color: #4a9eff;
		}
	}
	.label-text {
		/* Two-line minimum, vertical resize so longer labels fit. */
		resize: vertical;
		min-height: 2.4rem;
		line-height: 1.3;
		font-family: inherit;
	}
	/* Top-align the "Text" label with the multi-line textarea so the lbl
	   doesn't visually float above an empty box. */
	.text-row {
		align-items: flex-start;

		.lbl {
			padding-top: 0.4rem;
		}
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

		&:hover {
			border-color: #4a9eff;
		}
		&:focus {
			outline: none;
			border-color: #4a9eff;
		}
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
		/* The atlas ships as black-on-transparent in the PNG. We render the
		   sprite via a ::after pseudo-element with `invert(1)` so the icon
		   pixels flip to white while the parent's black chip background stays
		   intact. Inline styles set `--sprite-bg / --sprite-pos / --sprite-size`. */
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
			/* Mirrors the per-icon rotation offset MapStage applies, so the
			   preview points the same way the map will at rotation = 0. */
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

		&:hover:not(:disabled) {
			border-color: #4a9eff;
			color: #ddd;
		}
		&:disabled {
			opacity: 0.35;
			cursor: not-allowed;
		}
	}
	/* Per-row reset button in the default-style editor — narrower so it
	   doesn't squeeze the input next to it. */
	.mini.reset {
		flex: 0 0 auto;
		padding: 0.2rem 0.35rem;
		font-size: 12px;
		line-height: 1;
	}
	/* Section heading + Reset-all button side by side. */
	.default-style-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;

		.section {
			margin: 0;
			border-top: none;
			padding: 0;
			flex: 1 1 auto;
		}
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

		&:hover {
			background: rgba(255, 80, 80, 0.22);
			color: #fff;
		}
	}
</style>
