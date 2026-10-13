/**
 * Undo and redo: the states a document went through, as snapshots, and a
 * position among them. `record` adds the state after a change, `undo` and
 * `redo` hand back the state to return to.
 *
 * A state is kept as its JSON, so it has to survive that — and what comes
 * back is always a fresh copy, which nothing done to the document later
 * can reach.
 */
export class History<T> {
	#states: string[] = [];
	#index = $state(-1);
	#length = $state(0);
	readonly #limit: number;

	/** `limit` is how many states are kept; the oldest go first. */
	constructor(limit = 200) {
		this.#limit = Math.max(2, limit);
	}

	get canUndo(): boolean {
		return this.#index > 0;
	}
	get canRedo(): boolean {
		return this.#index < this.#length - 1;
	}

	/**
	 * Add `state` as the newest one. Whatever could still be redone is
	 * dropped. A state equal to the current one is not a step: that is what
	 * the document reports right after an undo or redo.
	 */
	record(state: T): void {
		const json = JSON.stringify(state);
		if (json === this.#states[this.#index]) return;
		this.#states.length = this.#index + 1;
		this.#states.push(json);
		if (this.#states.length > this.#limit) this.#states.shift();
		this.#index = this.#states.length - 1;
		this.#length = this.#states.length;
	}

	/** Step back: the state before the current one, or `null` at the first. */
	undo(): T | null {
		if (!this.canUndo) return null;
		this.#index--;
		return JSON.parse(this.#states[this.#index]) as T;
	}

	/** Step forward again: the state that was undone last, or `null`. */
	redo(): T | null {
		if (!this.canRedo) return null;
		this.#index++;
		return JSON.parse(this.#states[this.#index]) as T;
	}
}
