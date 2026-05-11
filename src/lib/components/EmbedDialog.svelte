<script lang="ts">
	import { base } from '$app/paths';
	import type { AnimationStore } from '../animation.svelte';
	import { encodeAnimation } from '../url_state';

	let {
		store,
		onClose
	}: {
		store: AnimationStore;
		onClose: () => void;
	} = $props();

	let inputEl = $state<HTMLInputElement | undefined>(undefined);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	function buildSnippet(): string {
		const encoded = encodeAnimation(store.toAnimation());
		const url = `${window.location.origin}${base}/view#kf=${encoded}`;
		// `aspect-ratio` mirrors the composition aspect so the iframe stays
		// the right shape in any container width (the viewer letterboxes
		// internally too, but matching here avoids visible bars).
		const aspect = store.aspectRatio.replace(':', '/');
		return `<iframe src="${url}" style="width:100%;aspect-ratio:${aspect};border:0" loading="lazy" allowfullscreen></iframe>`;
	}
	const snippet = $derived(buildSnippet());

	async function copy() {
		if (!inputEl) return;
		try {
			await navigator.clipboard.writeText(inputEl.value);
		} catch {
			inputEl.select();
			document.execCommand?.('copy');
		}
		copied = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1800);
	}

	$effect(() => {
		// Auto-select on open so the user can hit ⌘C immediately if clipboard
		// permissions are unavailable.
		queueMicrotask(() => inputEl?.select());
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
		};
	});
</script>

<div class="embed-panel" role="region" aria-label="Embed snippet">
	<label for="embed-input">Paste this into your page:</label>
	<div class="embed-row">
		<input
			id="embed-input"
			bind:this={inputEl}
			type="text"
			readonly
			value={snippet}
			onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
		/>
		<button type="button" onclick={copy} class:copied title="Copy snippet">
			{copied ? '✓ Copied' : '⧉ Copy'}
		</button>
		<button type="button" onclick={onClose} aria-label="Close" title="Close">✕</button>
	</div>
	<p class="hint">The iframe scales to its container at the chosen composition aspect ratio.</p>
</div>

<style>
	.embed-panel {
		margin-top: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #333;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;

		label {
			font-size: 12px;
			color: #aaa;
		}
		.hint {
			margin: 0;
			font-size: 11px;
			color: #888;
		}
	}
	.embed-row {
		display: flex;
		gap: 0.4rem;
		align-items: stretch;

		input {
			flex: 1 1 auto;
			min-width: 0;
			padding: 0.4rem 0.6rem;
			background: #0d1117;
			border: 1px solid #333;
			border-radius: 4px;
			color: #ddd;
			font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
			font-size: 12px;

			&:focus {
				outline: none;
				border-color: #4a9eff;
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
			&.copied {
				background: rgba(80, 200, 120, 0.18);
				border-color: #4ac888;
				color: #b6f0c9;
			}
		}
	}
</style>
