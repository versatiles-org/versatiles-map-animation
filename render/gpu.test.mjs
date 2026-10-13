import { describe, expect, it } from 'vitest';
import { chromiumArgs, isSoftwareRenderer, noGpuMessage } from './gpu.mjs';

describe('chromiumArgs', () => {
	it('draws in software by default, on any platform, exactly as before', () => {
		const expected = [
			'--use-gl=swiftshader',
			'--enable-unsafe-swiftshader',
			'--disable-gpu-vsync',
			'--disable-dev-shm-usage',
			'--no-sandbox'
		];
		expect(chromiumArgs()).toEqual(expected);
		for (const platform of ['linux', 'darwin', 'win32']) {
			expect(chromiumArgs({ gpu: false, platform })).toEqual(expected);
		}
	});

	it('uses Vulkan without a window surface on Linux', () => {
		const args = chromiumArgs({ gpu: true, platform: 'linux' });
		expect(args).toEqual(
			expect.arrayContaining([
				'--use-angle=vulkan',
				'--enable-features=Vulkan',
				'--disable-vulkan-surface',
				'--ignore-gpu-blocklist'
			])
		);
		expect(args.join(' ')).not.toMatch(/swiftshader/);
		expect(args).toContain('--no-sandbox');
	});

	it('uses Metal on macOS', () => {
		const args = chromiumArgs({ gpu: true, platform: 'darwin' });
		expect(args).toContain('--use-angle=metal');
		expect(args.join(' ')).not.toMatch(/swiftshader|vulkan/i);
	});

	it('says so where it has no GPU route', () => {
		expect(() => chromiumArgs({ gpu: true, platform: 'win32' })).toThrow(/not on win32/);
	});
});

describe('isSoftwareRenderer', () => {
	it('recognises the CPU renderers a GPU request can silently end up on', () => {
		for (const name of [
			'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
			'ANGLE (Mesa, llvmpipe (LLVM 15.0.6, 128 bits), OpenGL 4.5)',
			'ANGLE (Mesa, Vulkan 1.3.246 (llvmpipe (LLVM 15.0.6, 128 bits) (0x0000)), llvmpipe)',
			'lavapipe',
			'',
			null,
			undefined
		]) {
			expect(isSoftwareRenderer(name)).toBe(true);
		}
	});

	it('lets real GPUs through', () => {
		for (const name of [
			'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)',
			'ANGLE (NVIDIA, Vulkan 1.3.277 (NVIDIA Tesla T4 (0x00001EB8)), NVIDIA-550.90.7.0)',
			'ANGLE (Intel, Vulkan 1.3.246 (Intel(R) UHD Graphics 770 (ADL-S GT1) (0x00004680)), Intel open-source Mesa driver)',
			'ANGLE (AMD, Vulkan 1.3.246 (AMD Radeon RX 6600 (RADV NAVI23) (0x000073FF)), radv)'
		]) {
			expect(isSoftwareRenderer(name)).toBe(false);
		}
	});
});

describe('noGpuMessage', () => {
	it('names what it got and how to render without a GPU', () => {
		const message = noGpuMessage('SwiftShader', { platform: 'darwin' });
		expect(message).toContain('SwiftShader');
		expect(message).toContain('Leave out --gpu');
		expect(message).not.toContain('docker run');
	});

	it('explains how to hand a GPU into the container', () => {
		const message = noGpuMessage('llvmpipe', { platform: 'linux', inContainer: true });
		expect(message).toContain('--gpus all');
		expect(message).toContain('--device /dev/dri');
		expect(message).toContain('macOS');
	});

	it('points at the driver on a plain Linux machine', () => {
		const message = noGpuMessage(null, { platform: 'linux' });
		expect(message).toContain('could not start WebGL on a GPU');
		expect(message).toContain('vulkaninfo');
	});
});
