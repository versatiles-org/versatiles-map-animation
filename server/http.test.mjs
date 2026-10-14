// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseCookies, parseRange } from './http.mjs';

describe('parseCookies', () => {
	it('reads the cookies of a header', () => {
		expect(parseCookies('session=abc; theme=dark%20blue;broken; =x')).toEqual({
			session: 'abc',
			theme: 'dark blue'
		});
		expect(parseCookies(undefined)).toEqual({});
	});
});

describe('parseRange', () => {
	it('reads the byte ranges a video player asks for', () => {
		expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
		expect(parseRange('bytes=0-1', 1000)).toEqual({ start: 0, end: 1 });
		expect(parseRange('bytes=500-2000', 1000)).toEqual({ start: 500, end: 999 });
		expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
	});

	it('sends the whole file for none or one it does not take, and refuses impossible ones', () => {
		expect(parseRange(undefined, 1000)).toBeNull();
		expect(parseRange('bytes=-', 1000)).toBeNull();
		expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
		expect(parseRange('items=0-1', 1000)).toBeNull();
		expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
		expect(parseRange('bytes=5-2', 1000)).toBe('unsatisfiable');
	});
});
