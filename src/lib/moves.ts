import {
	DEFAULT_PATH,
	type DEFAULT_EASE,
	type EaseSide,
	type Keyframe,
	type PathStyle
} from './types';

/**
 * A move is the stretch of the animation from one stop to the next,
 * including the waypoints in between. The first and the last keyframe
 * always bound a move, also when they are waypoints themselves.
 */
export interface Move {
	/** Index of the keyframe the move starts from. */
	start: number;
	/** Index of the keyframe it ends on. */
	end: number;
	/**
	 * How the camera travels: a travel style for a move that goes straight
	 * from stop to stop, or `'curve'` for one that touches a waypoint and so
	 * follows the curve through its keyframes.
	 */
	kind: PathStyle | 'curve';
}

export function movesOf(keyframes: readonly Keyframe[]): Move[] {
	const moves: Move[] = [];
	let start = 0;
	for (let i = 1; i < keyframes.length; i++) {
		const isLast = i === keyframes.length - 1;
		if (keyframes[i].waypoint && !isLast) continue;
		const curved = keyframes.slice(start, i + 1).some((kf) => kf.waypoint);
		moves.push({ start, end: i, kind: curved ? 'curve' : (keyframes[start].path ?? DEFAULT_PATH) });
		start = i;
	}
	return moves;
}

export const MOVE_KIND_LABELS: Record<Move['kind'], string> = {
	arc: 'Fly over',
	linear: 'Stay low',
	curve: 'Through waypoints'
};

/**
 * What a side of the keyframe at `index` eases: a move straight to or from
 * the neighbouring stop (`'direct'`), or the curve to or from a waypoint.
 * `null` where there is nothing to ease — on a waypoint, before the first
 * keyframe and after the last. The kind picks the default in `DEFAULT_EASE`.
 */
export function easeKindOf(
	keyframes: readonly Keyframe[],
	index: number,
	side: EaseSide
): keyof typeof DEFAULT_EASE | null {
	const kf = keyframes[index];
	const neighbour = keyframes[side === 'easeIn' ? index - 1 : index + 1];
	if (!kf || kf.waypoint || !neighbour) return null;
	return neighbour.waypoint ? 'curve' : 'direct';
}
