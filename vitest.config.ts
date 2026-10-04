import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

// Reuse the Vite config (SvelteKit + svelte plugin) so `.svelte.ts` files
// (with $state runes) work in tests too, not just at build time.
export default mergeConfig(
	viteConfig,
	defineConfig({
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
	})
);
