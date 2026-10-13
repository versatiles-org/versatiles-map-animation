import { DEFAULT_PATH, type Keyframe, type PathStyle } from './types';

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
