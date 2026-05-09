import {
	DEFAULT_ANNOTATION_COLOR,
	DEFAULT_ANNOTATION_ICON,
	DEFAULT_ANNOTATION_SCALE,
	DEFAULT_STYLE,
	DEFAULT_TERRAIN,
	isAnnotationIcon,
	isLabelPosition,
	isMapStyleId,
	isPathStyle,
	SCHEMA_VERSION,
	type Animation,
	type Annotation,
	type Keyframe,
	type MapStyleId
} from './types';

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
	const terrain = typeof obj.terrain === 'boolean' ? obj.terrain : DEFAULT_TERRAIN;
	if (!Array.isArray(obj.keyframes)) {
		throw new Error('Invalid file: "keyframes" missing or not an array.');
	}
	const keyframes: Keyframe[] = obj.keyframes.map((raw, i) => {
		if (!raw || typeof raw !== 'object') {
			throw new Error(`Keyframe ${i}: not an object.`);
		}
		const o = raw as Record<string, unknown>;
		const num = (key: string): number => {
			const v = o[key];
			if (typeof v !== 'number' || !Number.isFinite(v)) {
				throw new Error(`Keyframe ${i}: missing or invalid "${key}".`);
			}
			return v;
		};
		const kf: Keyframe = {
			t: num('t'),
			lng: num('lng'),
			lat: num('lat'),
			zoom: num('zoom'),
			pitch: num('pitch'),
			bearing: num('bearing'),
			roll: num('roll')
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
	return { version: SCHEMA_VERSION, style, terrain, keyframes, annotations, annotationScale };
}

function validateAnnotation(raw: unknown, i: number): Annotation {
	if (!raw || typeof raw !== 'object') {
		throw new Error(`Annotation ${i}: not an object.`);
	}
	const o = raw as Record<string, unknown>;
	const num = (key: string): number => {
		const v = o[key];
		if (typeof v !== 'number' || !Number.isFinite(v)) {
			throw new Error(`Annotation ${i}: missing or invalid "${key}".`);
		}
		return v;
	};
	const optionalNum = (key: string): number | undefined => {
		const v = o[key];
		if (v === undefined) return undefined;
		if (typeof v !== 'number' || !Number.isFinite(v)) {
			throw new Error(`Annotation ${i}: invalid "${key}".`);
		}
		return v;
	};
	const out: Annotation = {
		lng: num('lng'),
		lat: num('lat'),
		icon: isAnnotationIcon(o.icon) ? o.icon : DEFAULT_ANNOTATION_ICON,
		color: typeof o.color === 'string' ? o.color : DEFAULT_ANNOTATION_COLOR,
		label: typeof o.label === 'string' ? o.label : ''
	};
	const rotation = optionalNum('rotation');
	if (rotation !== undefined) out.rotation = rotation;
	const visibleFrom = optionalNum('visibleFrom');
	if (visibleFrom !== undefined) out.visibleFrom = visibleFrom;
	const visibleUntil = optionalNum('visibleUntil');
	if (visibleUntil !== undefined) out.visibleUntil = visibleUntil;
	const iconSize = optionalNum('iconSize');
	if (iconSize !== undefined) out.iconSize = iconSize;
	const labelSize = optionalNum('labelSize');
	if (labelSize !== undefined) out.labelSize = labelSize;
	if (isLabelPosition(o.labelPosition)) out.labelPosition = o.labelPosition;
	const labelDistance = optionalNum('labelDistance');
	if (labelDistance !== undefined) out.labelDistance = labelDistance;
	return out;
}
