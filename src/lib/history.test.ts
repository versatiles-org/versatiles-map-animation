import { describe, expect, it } from 'vitest';
import { History } from './history.svelte';

describe('History', () => {
	it('has nothing to undo or redo at first, nor with a single state', () => {
		const h = new History<number>();
		expect([h.canUndo, h.canRedo, h.undo(), h.redo()]).toEqual([false, false, null, null]);
		h.record(1);
		expect([h.canUndo, h.canRedo, h.undo(), h.redo()]).toEqual([false, false, null, null]);
	});

	it('steps back and forth through the recorded states', () => {
		const h = new History<number>();
		for (const n of [1, 2, 3]) h.record(n);
		expect(h.undo()).toBe(2);
		expect(h.undo()).toBe(1);
		expect(h.canUndo).toBe(false);
		expect(h.undo()).toBeNull();
		expect(h.redo()).toBe(2);
		expect(h.redo()).toBe(3);
		expect(h.canRedo).toBe(false);
		expect(h.redo()).toBeNull();
	});

	it('drops what could be redone when something new happens', () => {
		const h = new History<number>();
		for (const n of [1, 2, 3]) h.record(n);
		h.undo();
		h.undo();
		h.record(9);
		expect(h.canRedo).toBe(false);
		expect(h.undo()).toBe(1);
		expect(h.redo()).toBe(9);
	});

	it('does not count a state equal to the current one as a step', () => {
		const h = new History<{ a: number }>();
		h.record({ a: 1 });
		h.record({ a: 2 });
		// What the document reports after an undo: the state just restored.
		const back = h.undo();
		h.record(back!);
		expect(h.canRedo).toBe(true);
		expect(h.redo()).toEqual({ a: 2 });
		h.record({ a: 2 });
		expect(h.undo()).toEqual({ a: 1 });
		expect(h.canUndo).toBe(false);
	});

	it('hands out copies that later changes cannot reach', () => {
		const h = new History<{ list: number[] }>();
		const first = { list: [1] };
		h.record(first);
		first.list.push(2);
		h.record({ list: [3] });
		const back = h.undo()!;
		expect(back).toEqual({ list: [1] });
		back.list.push(4);
		h.redo();
		expect(h.undo()).toEqual({ list: [1] });
	});

	it('forgets the oldest states beyond its limit', () => {
		const h = new History<number>(3);
		for (const n of [1, 2, 3, 4, 5]) h.record(n);
		expect(h.undo()).toBe(4);
		expect(h.undo()).toBe(3);
		expect(h.undo()).toBeNull();
	});
});
