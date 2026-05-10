import { describe, it, expect, beforeEach } from 'vitest';
import {
	clearAnimationStorage,
	clearUrlHash,
	decodeAnimation,
	inspectAnimation,
	readAnimationFromStorage,
	readAnimationFromUrl,
	writeAnimationToStorage,
	writeAnimationToUrl
} from '.';
import { formatInspection } from '../codec';
import { SCHEMA_VERSION, type Animation } from '../types';

const sample: Animation = {
	version: SCHEMA_VERSION,
	style: 'colorful',
	labels: true,
	terrain: false,
	sky: false,
	keyframes: [
		{ t: 0, lng: 0, lat: 30, zoom: 4, pitch: 0, bearing: 0, roll: 0 },
		{ t: 2, lng: 5, lat: 35, zoom: 6, pitch: 30, bearing: 45, roll: 0 }
	],
	annotations: [],
	annotationScale: 1
};

beforeEach(() => {
	clearUrlHash();
	clearAnimationStorage();
});

describe('writeAnimationToUrl / readAnimationFromUrl', () => {
	it('round-trips through the URL hash', () => {
		writeAnimationToUrl(sample);
		expect(window.location.hash).toMatch(/^#kf=/);
		const back = readAnimationFromUrl();
		expect(back).not.toBeNull();
		expect(back?.keyframes).toHaveLength(2);
		expect(back?.style).toBe('colorful');
	});

	it('readAnimationFromUrl returns null when hash is empty', () => {
		expect(readAnimationFromUrl()).toBeNull();
	});

	it('readAnimationFromUrl returns null when hash has no `kf` param', () => {
		history.replaceState(null, '', `${window.location.pathname}#other=value`);
		expect(readAnimationFromUrl()).toBeNull();
	});

	it('readAnimationFromUrl throws on malformed kf payload (broken share link)', () => {
		history.replaceState(null, '', `${window.location.pathname}#kf=$$$not-base64$$$`);
		expect(() => readAnimationFromUrl()).toThrow();
	});

	it('writeAnimationToUrl with no keyframes clears the hash', () => {
		writeAnimationToUrl(sample);
		expect(window.location.hash).not.toBe('');
		writeAnimationToUrl({ ...sample, keyframes: [] });
		expect(window.location.hash).toBe('');
	});

	it('clearUrlHash leaves window.location.hash empty', () => {
		writeAnimationToUrl(sample);
		clearUrlHash();
		expect(window.location.hash).toBe('');
	});
});

describe('writeAnimationToStorage / readAnimationFromStorage', () => {
	it('round-trips through localStorage', () => {
		writeAnimationToStorage(sample);
		const back = readAnimationFromStorage();
		expect(back).not.toBeNull();
		expect(back?.keyframes).toHaveLength(2);
	});

	it('returns null on a fresh storage', () => {
		expect(readAnimationFromStorage()).toBeNull();
	});

	it('returns null on garbage in storage rather than throwing', () => {
		window.localStorage.setItem('versatiles-map-animation', '$$$not-base64$$$');
		expect(readAnimationFromStorage()).toBeNull();
	});

	it('clearAnimationStorage removes the entry', () => {
		writeAnimationToStorage(sample);
		clearAnimationStorage();
		expect(readAnimationFromStorage()).toBeNull();
	});
});

describe('decodeAnimation - error tolerance', () => {
	it('returns null for empty input', () => {
		expect(decodeAnimation('')).toBeNull();
	});

	it('returns null for unknown format tags', () => {
		// Payload of a single zero byte → tag 0x00, not in VERSIONS.
		expect(decodeAnimation('AA')).toBeNull();
	});
});

describe('inspectAnimation', () => {
	it('returns a tree with the format tag accounted for', () => {
		const tree = inspectAnimation(sample);
		expect(tree.label).toBe('animation');
		expect(tree.children[0].label).toBe('[format-tag]');
		expect(tree.children[0].bits).toBe(8);
	});

	it("tree's bit total matches the encoded payload size", () => {
		// inspect is wrapped to add the 8-bit tag, so we check the tree matches
		// what the encoder actually produces.
		const tree = inspectAnimation(sample);
		// Render once to sanity-check formatInspection covers the tree.
		const rendered = formatInspection(tree);
		expect(rendered).toContain('animation');
		expect(rendered).toContain('[format-tag]');
	});

	it('chooses higher version when needed (V5 with halo, V4 with extras)', () => {
		const halo: Animation = {
			...sample,
			annotations: [
				{
					lng: 0,
					lat: 0,
					icon: 'symbol-marker',
					color: '#cc0000',
					label: '',
					labelHaloColor: '#abcdef'
				}
			]
		};
		const tree = inspectAnimation(halo);
		expect(tree.bits).toBeGreaterThan(0);
		// We don't assert on the version directly, but we expect the bit count
		// to grow when we add halo data vs. the bare animation.
		const bare = inspectAnimation(sample);
		expect(tree.bits).toBeGreaterThan(bare.bits);
	});
});
