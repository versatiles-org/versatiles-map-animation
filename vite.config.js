import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: undefined,
				precompress: false,
				strict: true
			}),
			paths: {
				base: /** @type {'' | `/${string}`} */ (process.env.BASE_PATH ?? '')
			}
		})
	],
	build: {
		target: 'esnext',
		chunkSizeWarningLimit: 1024
	},
	// MapLibre spawns its worker with `{ type: 'module' }`, so the worker bundle
	// Vite emits for it must be ESM rather than the default IIFE.
	worker: {
		format: 'es'
	}
});
