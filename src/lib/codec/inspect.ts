/**
 * "Where do the bits go?" — encode a value and produce a tree of how many
 * bits each sub-codec contributed. Pair with `formatInspection()` to print
 * a debug-friendly tree.
 */

import { BitWriter, type Codec } from './core';

/** A node in the bit-cost tree returned by `inspect()`. */
export interface InspectionNode {
	label: string;
	bits: number;
	children: InspectionNode[];
}

/**
 * Encode `value` with `codec` and return a tree describing how many bits each
 * sub-codec contributed. Useful for debugging URL-hash size: drop the result
 * into `formatInspection()` to see a tree of "lat: 28 bits, zoom: 20 bits…".
 *
 * Combinators (struct/array/deltaArray) emit one tree node per field or
 * element. Primitive codecs are leaves attributed to their parent.
 */
export function inspect<T>(codec: Codec<T>, value: T): InspectionNode {
	type Pending = InspectionNode & { _start: number };
	const root: Pending = { label: 'root', bits: 0, children: [], _start: 0 };
	const stack: Pending[] = [root];
	const w = new BitWriter();
	w.inspector = {
		enter(label, bit) {
			const node: Pending = { label, bits: 0, children: [], _start: bit };
			stack[stack.length - 1].children.push(node);
			stack.push(node);
		},
		exit(_label, bit) {
			const node = stack.pop();
			if (node) node.bits = bit - node._start;
		}
	};
	codec.encode(value, w);
	root.bits = w.totalBits();
	const strip = (n: Pending): InspectionNode => ({
		label: n.label,
		bits: n.bits,
		children: n.children.map((c) => strip(c as Pending))
	});
	return strip(root);
}

/** Pretty-print an inspection tree as an indented, branched layout. */
export function formatInspection(node: InspectionNode): string {
	const lines: string[] = [];
	const fmt = (b: number) => `${b} bit${b === 1 ? '' : 's'} (${(b / 8).toFixed(1)} B)`;
	const recurse = (n: InspectionNode, prefix: string, isLast: boolean, isRoot: boolean) => {
		if (isRoot) {
			lines.push(`${n.label}: ${fmt(n.bits)}`);
		} else {
			lines.push(`${prefix}${isLast ? '└── ' : '├── '}${n.label}: ${fmt(n.bits)}`);
		}
		const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
		for (let i = 0; i < n.children.length; i++) {
			recurse(n.children[i], childPrefix, i === n.children.length - 1, false);
		}
	};
	recurse(node, '', true, true);
	return lines.join('\n');
}
