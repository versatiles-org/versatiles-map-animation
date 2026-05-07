import { defineConfig } from 'vitest/config';

export default defineConfig({
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
