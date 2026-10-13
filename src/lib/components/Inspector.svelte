<script lang="ts">
	/**
	 * The part of the row above the timeline (see `Transport`) that edits what
	 * is selected on the timeline: a keyframe or a move. With nothing selected
	 * it says so.
	 *
	 * Markers have their own, larger editor in the sidebar and their own
	 * selection, so a keyframe and a marker can be worked on side by side.
	 */

	import type { AnimationStore } from '../animation.svelte';
	import { easeKindOf } from '../moves';
	import {
		DEFAULT_EASE,
		holdOf,
		PATH_STYLE_LABELS,
		PATH_STYLES,
		TIME_RESOLUTION,
		type EaseSide
	} from '../types';
	import Icon from './Icon.svelte';
	import PathIcon from './PathIcon.svelte';

	let { store }: { store: AnimationStore } = $props();

	const KEYFRAME_TYPES = [
		['stop', 'Stop', 'The camera comes to rest on this view.'],
		[
			'waypoint',
			'Waypoint',
			'The camera flies through this view without stopping. As first or last keyframe: the animation starts or ends in motion.'
		]
	] as const;

	const EASES: readonly (readonly [EaseSide, string, string])[] = [
		['easeIn', 'In', 'How gently the camera arrives at this stop'],
		['easeOut', 'Out', 'How gently the camera leaves this stop']
	];

	const index = $derived(store.selectedIndex);
	const keyframe = $derived(store.selectedKeyframe);
	const isWaypoint = $derived(keyframe?.waypoint === true);
	const move = $derived(store.selectedMove);
</script>

<div class="inspector" role="group" aria-label="Selected keyframe or move">
	{#if move}
		<span class="what">Move {move.start + 1} → {move.end + 1}</span>
		<div
			class="field"
			role="radiogroup"
			aria-label="Travel style of the selected move"
			title={move.kind === 'curve'
				? 'This move runs through waypoints and follows the curve through them. Turn them into stops to choose a travel style.'
				: undefined}
		>
			{#if move.kind === 'curve'}
				<span class="note"><PathIcon icon="waypoint" /> Follows its waypoints</span>
			{:else}
				{#each PATH_STYLES as path (path)}
					{@const active = move.kind === path}
					<button
						type="button"
						role="radio"
						aria-checked={active}
						class:active
						title={PATH_STYLE_LABELS[path][1]}
						onclick={() => store.setKeyframePath(move.start, path)}
					>
						<PathIcon icon={path} />
						{PATH_STYLE_LABELS[path][0]}
					</button>
				{/each}
			{/if}
		</div>
	{:else if keyframe && index !== null}
		<span class="what">Keyframe {index + 1}</span>
		<div class="field" role="radiogroup" aria-label="Keyframe type">
			{#each KEYFRAME_TYPES as [type, label, hint] (type)}
				{@const active = isWaypoint === (type === 'waypoint')}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					class:active
					title={hint}
					onclick={() => store.setKeyframeWaypoint(index, type === 'waypoint')}
				>
					<PathIcon icon={type} />
					<span class="type-label">{label}</span>
				</button>
			{/each}
		</div>
		<label
			class="field"
			title="When the camera arrives at this keyframe, in seconds from the start. Times are set in steps of {TIME_RESOLUTION} s."
		>
			<span class="lbl">Time</span>
			<input
				class="time"
				type="number"
				min="0"
				step={TIME_RESOLUTION}
				value={keyframe.t}
				onchange={(e) => {
					const value = Number(e.currentTarget.value);
					if (Number.isFinite(value)) store.setKeyframeTime(index, value);
					// Like dragging the keyframe, the playhead follows it — and the
					// field shows where it really landed (on the grid, clear of others).
					const kf = store.selectedKeyframe;
					if (kf) {
						store.currentTime = kf.t;
						e.currentTarget.value = String(kf.t);
					}
				}}
			/>
			<span>s</span>
		</label>
		<label
			class="field"
			title={isWaypoint
				? 'A waypoint is flown through and cannot hold'
				: 'Seconds the camera rests on this stop before it moves on. Changing it moves everything after it along.'}
		>
			<span class="lbl">Hold</span>
			<input
				type="number"
				min="0"
				step="0.1"
				value={holdOf(keyframe)}
				disabled={isWaypoint}
				onchange={(e) => store.setKeyframeHold(index, Number(e.currentTarget.value))}
			/>
			<span>s</span>
		</label>
		<span class="lbl">Ease</span>
		{#each EASES as [side, label, hint] (side)}
			{@const kind = easeKindOf(store.keyframes, index, side)}
			{@const own = keyframe[side]}
			{@const percent = Math.round((own ?? (kind ? DEFAULT_EASE[kind] : 0)) * 100)}
			<div
				class="field"
				title={kind
					? `${hint}: 0 % is abrupt, at full speed; 100 % is very gradual. A stronger easing makes the middle of the move faster.`
					: isWaypoint
						? 'A waypoint is flown through and does not ease'
						: side === 'easeIn'
							? 'Nothing arrives at the first keyframe'
							: 'Nothing leaves the last keyframe'}
			>
				<span class="lbl">{label}</span>
				<input
					type="range"
					min="0"
					max="100"
					step="5"
					value={percent}
					disabled={!kind}
					aria-label="Ease {label.toLowerCase()} of keyframe {index + 1}, in percent"
					oninput={(e) => store.setKeyframeEase(index, side, Number(e.currentTarget.value) / 100)}
				/>
				<button
					type="button"
					class="percent"
					disabled={own === undefined}
					title={own === undefined ? 'The default of this move' : 'Back to the default'}
					aria-label="Reset ease {label.toLowerCase()} to the default"
					onclick={() => store.setKeyframeEase(index, side, null)}
				>
					{kind ? `${percent}%` : '–'}
				</button>
			</div>
		{/each}
		<div class="field">
			<button
				type="button"
				onclick={() => store.updateSelectedFromCamera(store.liveCamera)}
				title="Replace this keyframe's view with what the map shows now"
			>
				<Icon name="view" /> <span class="label">Set to current view</span>
			</button>
			<button type="button" onclick={() => store.deleteAt(index)} title="Delete this keyframe">
				<Icon name="trash" /> <span class="label">Delete</span>
			</button>
		</div>
	{:else}
		<span class="empty">
			{store.keyframes.length === 0
				? 'Add a keyframe to begin.'
				: 'Click a keyframe or a move on the timeline to edit it.'}
		</span>
	{/if}
</div>

<style>
	.inspector {
		display: flex;
		align-items: center;
		/* In a window too narrow for all of it, the last controls go to a second line. */
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
		min-width: 0;
		font-size: 12px;
		color: #aaa;
	}
	.what {
		/* Room for "Keyframe 12", so the controls don't shift from one to the next. */
		min-width: 5.5rem;
		font-size: 13px;
		font-weight: 600;
		color: #ddd;
		white-space: nowrap;
	}
	.empty {
		color: #777;
	}
	.field {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.lbl {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
		white-space: nowrap;
	}
	.note {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 13px;
		color: #ddd;
	}
	input[type='number'] {
		width: 3.6em;
		padding: 0.35rem 0.3rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font: inherit;
		font-size: 13px;
		font-variant-numeric: tabular-nums;

		&:hover:not(:disabled),
		&:focus {
			border-color: #4a9eff;
			outline: none;
		}
		&:disabled {
			opacity: 0.4;
		}
		/* Room for "123.45". */
		&.time {
			width: 4.8em;
		}
	}
	input[type='range'] {
		width: 3rem;
		accent-color: #4a9eff;

		&:disabled {
			opacity: 0.4;
		}
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.6rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;

		&:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.12);
			border-color: #4a9eff;
		}
		&.active {
			background: rgba(74, 158, 255, 0.2);
			border-color: #4a9eff;
			color: #fff;
		}
		/* The strength of an easing, and the way back to the default: dimmed
		   while it is the default. Room for "100%". */
		&.percent {
			justify-content: flex-end;
			min-width: 2.5rem;
			padding: 0.2rem 0.3rem;
			font-size: 12px;
			font-variant-numeric: tabular-nums;

			&:disabled {
				background: none;
				border-color: transparent;
				color: #777;
				cursor: default;
			}
		}
	}

	/* The row shares the window's width with the playback controls. Where a
	   selected keyframe's controls would not fit, the two actions keep only
	   their icons, and in a still narrower window so do the two keyframe
	   types; their tooltips still say what they do. */
	@media (max-width: 1560px) {
		.label {
			display: none;
		}
	}
	@media (max-width: 1400px) {
		.inspector {
			column-gap: 0.5rem;
		}
		.type-label {
			display: none;
		}
	}
</style>
