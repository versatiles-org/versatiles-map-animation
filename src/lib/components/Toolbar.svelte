<script lang="ts">
	import type { AnimationStore } from '../animation.svelte';
	import { holdOf, PATH_STYLE_LABELS, PATH_STYLES, TIME_RESOLUTION } from '../types';
	import PathIcon from './PathIcon.svelte';

	let { store }: { store: AnimationStore } = $props();

	function onAdd() {
		store.addKeyframeFromCamera(store.liveCamera);
	}
	function onPinAnnotation() {
		const cam = store.liveCamera;
		// Thin annotation: only position + (empty) label. Icon, colour, and
		// every other style field stay undefined so the renderer pulls them
		// from `defaultAnnotation` — change a default later and the marker
		// follows. The hardcoded baselines live in `ANNOTATION_FIELD_DEFAULTS`.
		store.addAnnotation({ lng: cam.lng, lat: cam.lat, label: '' });
	}
	function onUpdate() {
		store.updateSelectedFromCamera(store.liveCamera);
	}
	function onDelete() {
		if (store.selectedIndex !== null) store.deleteAt(store.selectedIndex);
	}
	function onTogglePlay() {
		store.togglePlay();
	}
	function onRestart() {
		store.restart();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.code !== 'Space') return;
		const target = e.target as HTMLElement;
		if (target.matches('input, textarea, [contenteditable="true"]')) return;
		e.preventDefault();
		store.togglePlay();
	}

	$effect(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	const hasSelection = $derived(store.selectedIndex !== null);
	const hasKeyframes = $derived(store.keyframes.length > 0);
	const KEYFRAME_TYPES = [
		['stop', 'Stop', 'The camera comes to rest on this view.'],
		[
			'waypoint',
			'Waypoint',
			'The camera flies through this view without stopping. As first or last keyframe: the animation starts or ends in motion.'
		]
	] as const;
	const isWaypoint = $derived(store.selectedKeyframe?.waypoint === true);
	const selectedMove = $derived(store.selectedMove);
	const canPlay = $derived(store.keyframes.length >= 2);
</script>

<div class="toolbar">
	<div class="group" role="group" aria-label="Keyframe">
		<span class="group-label">Keyframe</span>
		<button type="button" onclick={onAdd} title="Add a keyframe at the current playhead time">
			+ Add
		</button>
		{#if selectedMove}
			<!-- A move is selected on the timeline: its controls take the place
			     of the keyframe's, so the toolbar keeps its width. -->
			<div
				class="choice"
				role="radiogroup"
				aria-label="Travel style of the selected move"
				title={selectedMove.kind === 'curve'
					? 'This move runs through waypoints and follows the curve through them. Turn them into stops to choose a travel style.'
					: undefined}
			>
				<span class="lbl">Move</span>
				{#if selectedMove.kind === 'curve'}
					<span class="note"><PathIcon icon="waypoint" /> Follows its waypoints</span>
				{:else}
					{#each PATH_STYLES as path (path)}
						{@const active = selectedMove.kind === path}
						<button
							type="button"
							role="radio"
							aria-checked={active}
							class:active
							title={PATH_STYLE_LABELS[path][1]}
							onclick={() => store.setKeyframePath(selectedMove.start, path)}
						>
							<PathIcon icon={path} />
							{PATH_STYLE_LABELS[path][0]}
						</button>
					{/each}
				{/if}
			</div>
		{:else}
			<button
				type="button"
				onclick={onUpdate}
				disabled={!hasSelection}
				title="Update the selected keyframe to the current camera"
			>
				↻ Update
			</button>
			<button
				type="button"
				onclick={onDelete}
				disabled={!hasSelection}
				title="Delete the selected keyframe"
			>
				✕ Delete
			</button>
			<div
				class="choice"
				role="radiogroup"
				aria-label="Keyframe type"
				title={hasSelection ? undefined : 'Select a keyframe to set its type'}
			>
				{#each KEYFRAME_TYPES as [type, label, hint] (type)}
					{@const active = hasSelection && isWaypoint === (type === 'waypoint')}
					<button
						type="button"
						role="radio"
						aria-checked={active}
						class:active
						disabled={!hasSelection}
						title={hint}
						onclick={() => {
							if (store.selectedIndex !== null) {
								store.setKeyframeWaypoint(store.selectedIndex, type === 'waypoint');
							}
						}}
					>
						<PathIcon icon={type} />
						{label}
					</button>
				{/each}
			</div>
			<label
				class="choice hold-input"
				title="When the camera arrives at the selected keyframe, in seconds from the start. Times are set in steps of {TIME_RESOLUTION} s."
			>
				<span class="lbl">Time</span>
				<input
					class="time"
					type="number"
					min="0"
					step={TIME_RESOLUTION}
					value={store.selectedKeyframe?.t ?? 0}
					disabled={!hasSelection}
					onchange={(e) => {
						if (store.selectedIndex === null) return;
						const value = Number(e.currentTarget.value);
						if (Number.isFinite(value)) store.setKeyframeTime(store.selectedIndex, value);
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
				class="choice hold-input"
				title={isWaypoint
					? 'A waypoint is flown through and cannot hold'
					: 'Seconds the camera rests on the selected stop before it moves on. Changing it moves everything after it along.'}
			>
				<span class="lbl">Hold</span>
				<input
					type="number"
					min="0"
					step="0.1"
					value={store.selectedKeyframe ? holdOf(store.selectedKeyframe) : 0}
					disabled={!hasSelection || isWaypoint}
					onchange={(e) => {
						if (store.selectedIndex !== null) {
							store.setKeyframeHold(store.selectedIndex, Number(e.currentTarget.value));
						}
					}}
				/>
				<span>s</span>
			</label>
		{/if}
	</div>

	<div class="group" role="group" aria-label="Annotation">
		<span class="group-label">Annotation</span>
		<button type="button" onclick={onPinAnnotation} title="Pin a marker at the current map center">
			📍 Pin
		</button>
		<label
			class="control-label scale-control"
			title="Scale all annotations (markers and labels). Stacks on top of automatic container-size scaling."
		>
			<span class="lbl">Size</span>
			<input
				type="range"
				min="0.4"
				max="2.5"
				step="0.05"
				value={store.annotationScale}
				oninput={(e) => {
					store.annotationScale = Number((e.currentTarget as HTMLInputElement).value);
				}}
			/>
			<span class="num">{store.annotationScale.toFixed(2)}×</span>
		</label>
	</div>

	<div class="group playback">
		<button
			type="button"
			class="primary"
			onclick={onTogglePlay}
			disabled={!canPlay}
			title="Spacebar"
		>
			{store.isPlaying ? '⏸ Pause' : '▶ Play'}
		</button>
		<button type="button" onclick={onRestart} disabled={!hasKeyframes}>⏮ Restart</button>
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}
	.group {
		display: flex;
		gap: 0.25rem;
		align-items: center;

		&.playback {
			margin-left: 1.5rem;
		}
	}
	.group-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
		margin-right: 0.15rem;
	}
	.choice {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: 0.4rem;
		font-size: 12px;
		color: #aaa;

		.lbl {
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #777;
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
		.note {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			padding: 0.4rem 0.2rem;
			font-size: 13px;
			color: #ddd;
		}
		button {
			display: inline-flex;
			align-items: center;
			gap: 0.3rem;
			padding: 0.4rem 0.55rem;

			&.active {
				background: rgba(74, 158, 255, 0.2);
				border-color: #4a9eff;
				color: #fff;
			}
		}
	}
	.scale-control {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: 0.4rem;
		font-size: 12px;
		color: #aaa;

		.lbl {
			font-size: 10px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #777;
		}
		input[type='range'] {
			width: 90px;
		}
		.num {
			font-variant-numeric: tabular-nums;
			min-width: 2.6em;
			text-align: right;
		}
	}
	button {
		padding: 0.4rem 0.7rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #333;
		border-radius: 4px;
		color: #ddd;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;

		&:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.12);
			border-color: #4a9eff;
		}
		&:disabled {
			opacity: 0.4;
			cursor: not-allowed;
		}
		&.primary {
			background: #4a9eff;
			border-color: #4a9eff;
			color: #fff;
			font-weight: 600;

			&:hover:not(:disabled) {
				background: #5fa9ff;
			}
		}
	}
</style>
