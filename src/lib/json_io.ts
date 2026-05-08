import {
	DEFAULT_STYLE,
	DEFAULT_TERRAIN,
	isMapStyleId,
	isPathStyle,
	SCHEMA_VERSION,
	type Animation,
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
	return { version: SCHEMA_VERSION, style, terrain, keyframes };
}
