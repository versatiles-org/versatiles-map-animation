import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// SvelteKit + svelte plugin so `.svelte.ts` files (with $state runes) work
	// in tests too, not just at build time.
	plugins: [sveltekit()],
	test: {
		environment: 'happy-dom',
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['lcov', 'text'],
			include: ['src/**/*.{ts,js}'],
			exclude: ['src/**/*.d.ts']
		},
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
