import { FIELD_SPECS } from './url_state/annotation_codec';
import {
	DEFAULT_ANNOTATION_COLOR,
	DEFAULT_ANNOTATION_ICON,
	DEFAULT_ANNOTATION_SCALE,
	DEFAULT_ASPECT_RATIO,
	DEFAULT_LABELS,
	DEFAULT_SKY,
	DEFAULT_STYLE,
	DEFAULT_TERRAIN,
	isAnnotationIcon,
	isAspectRatio,
	isLabelPosition,
	isMapStyleId,
	isPathStyle,
	SCHEMA_VERSION,
	type Animation,
	type Annotation,
	type Keyframe,
	type MapStyleId
} from './types';

/** Read a required finite number from `o[key]`, throwing with a context label. */
function requiredNum(o: Record<string, unknown>, key: string, ctx: string): number {
	const v = o[key];
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		throw new Error(`${ctx}: missing or invalid "${key}".`);
	}
	return v;
}

/** Read an optional finite number from `o[key]`. Throws on type mismatch; undefined when absent. */
function optionalNum(o: Record<string, unknown>, key: string, ctx: string): number | undefined {
	const v = o[key];
	if (v === undefined) return undefined;
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		throw new Error(`${ctx}: invalid "${key}".`);
	}
	return v;
}

export function downloadAnimation(anim: Animation, filename = 'map-animation.json'): void {
	const json = JSON.stringify(anim, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export async function uploadAnimation(file: File): Promise<Animation> {
	const text = await file.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error('Could not parse file as JSON.');
	}
	return validateAnimation(parsed);
}

export function validateAnimation(input: unknown): Animation {
	if (!input || typeof input !== 'object') {
		throw new Error('Invalid file: not an object.');
	}
	const obj = input as Record<string, unknown>;
	const version = obj.version;
	if (typeof version !== 'number') {
		throw new Error('Invalid file: missing or invalid "version".');
	}
	if (version > SCHEMA_VERSION) {
		throw new Error(
			`File was made with a newer version (v${version}); this tool supports v${SCHEMA_VERSION}.`
		);
	}
	const style: MapStyleId = isMapStyleId(obj.style) ? obj.style : DEFAULT_STYLE;
	const labels = typeof obj.labels === 'boolean' ? obj.labels : DEFAULT_LABELS;
	const terrain = typeof obj.terrain === 'boolean' ? obj.terrain : DEFAULT_TERRAIN;
	const sky = typeof obj.sky === 'boolean' ? obj.sky : DEFAULT_SKY;
	if (!Array.isArray(obj.keyframes)) {
		throw new Error('Invalid file: "keyframes" missing or not an array.');
	}
	const keyframes: Keyframe[] = obj.keyframes.map((raw, i) => {
		if (!raw || typeof raw !== 'object') {
			throw new Error(`Keyframe ${i}: not an object.`);
		}
		const o = raw as Record<string, unknown>;
		const ctx = `Keyframe ${i}`;
		const kf: Keyframe = {
			t: requiredNum(o, 't', ctx),
			lng: requiredNum(o, 'lng', ctx),
			lat: requiredNum(o, 'lat', ctx),
			zoom: requiredNum(o, 'zoom', ctx),
			pitch: requiredNum(o, 'pitch', ctx),
			bearing: requiredNum(o, 'bearing', ctx),
			roll: requiredNum(o, 'roll', ctx)
		};
		if (isPathStyle(o.path)) kf.path = o.path;
		return kf;
	});
	const annotations: Annotation[] = Array.isArray(obj.annotations)
		? obj.annotations.map((raw, i) => validateAnnotation(raw, i))
		: [];
	const annotationScale =
		typeof obj.annotationScale === 'number' && Number.isFinite(obj.annotationScale)
			? Math.max(0.01, obj.annotationScale)
			: DEFAULT_ANNOTATION_SCALE;
	const aspectRatio = isAspectRatio(obj.aspectRatio) ? obj.aspectRatio : DEFAULT_ASPECT_RATIO;
	return {
		version: SCHEMA_VERSION,
		style,
		labels,
		terrain,
		sky,
		keyframes,
		annotations,
		annotationScale,
		aspectRatio
	};
}

function validateAnnotation(raw: unknown, i: number): Annotation {
	if (!raw || typeof raw !== 'object') {
		throw new Error(`Annotation ${i}: not an object.`);
	}
	const o = raw as Record<string, unknown>;
	const ctx = `Annotation ${i}`;
	const out: Annotation = {
		lng: requiredNum(o, 'lng', ctx),
		lat: requiredNum(o, 'lat', ctx),
		icon: isAnnotationIcon(o.icon) ? o.icon : DEFAULT_ANNOTATION_ICON,
		iconColor: typeof o.color === 'string' ? o.color : DEFAULT_ANNOTATION_COLOR,
		label: typeof o.label === 'string' ? o.label : ''
	};
	// rotation, visibleUntil, labelPosition aren't in FIELD_SPECS (their wire
	// shape needs special-case handling in the codec), so validate them inline.
	const rotation = optionalNum(o, 'rotation', ctx);
	if (rotation !== undefined) out.rotation = rotation;
	const visibleUntil = optionalNum(o, 'visibleUntil', ctx);
	if (visibleUntil !== undefined) out.visibleUntil = visibleUntil;
	if (isLabelPosition(o.labelPosition)) out.labelPosition = o.labelPosition;
	// Everything else flows through the same field table that drives the
	// wire codec and normalize/denormalize, so adding a future field is one row.
	for (const f of FIELD_SPECS) f.fromJson(o, out, i);
	return out;
}
