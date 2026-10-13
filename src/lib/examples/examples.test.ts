import { describe, expect, it } from 'vitest';
import { decodeAnimation, encodeAnimation } from '../url_state';
import { EXAMPLES } from './index';

describe('examples', () => {
	it('finds every file of the folder, sorted by title', () => {
		expect(EXAMPLES.map((e) => e.id)).toEqual(['alps', 'berlin', 'corsica']);
		const titles = EXAMPLES.map((e) => e.title);
		expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
	});

	it.each(EXAMPLES)('$id has a title, a description and something to play', (example) => {
		expect(example.title).not.toBe(example.id);
		expect(example.description).toBeTruthy();
		expect(example.animation.keyframes.length).toBeGreaterThanOrEqual(2);
		// The presentation keys are not part of the animation.
		expect(example.animation).not.toHaveProperty('title');
		expect(example.animation).not.toHaveProperty('description');
	});

	it.each(EXAMPLES)('$id survives a share link', (example) => {
		const again = decodeAnimation(encodeAnimation(example.animation));
		if (!again) throw new Error('the share link did not decode');
		expect(again.keyframes).toHaveLength(example.animation.keyframes.length);
		expect(again.annotations).toHaveLength(example.animation.annotations.length);
		expect(again.style).toBe(example.animation.style);
	});
});
