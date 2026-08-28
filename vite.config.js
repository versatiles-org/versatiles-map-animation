import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
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
