// @ts-check
/**
 * How the renderer's browser draws WebGL: on the CPU by default, or on a
 * GPU with `--gpu`. Kept free of anything that needs a browser, so it can
 * be unit-tested.
 */

/** Flags the browser gets either way. */
const COMMON_ARGS = ['--disable-gpu-vsync', '--disable-dev-shm-usage', '--no-sandbox'];

/**
 * Command-line arguments for Chromium.
 *
 * Without `gpu`, WebGL runs on SwiftShader, Chromium's software renderer:
 * slow, but the same on every machine and with nothing to set up.
 *
 * With `gpu`, WebGL runs on ANGLE with a hardware backend:
 *
 *  - Linux: Vulkan — the route Chrome's own guidance gives for headless
 *    rendering on a GPU. It needs no display server, and inside a container
 *    it works with whatever Vulkan driver is visible there: NVIDIA's (handed
 *    in by the NVIDIA Container Toolkit) or Mesa's for Intel and AMD (through
 *    `/dev/dri`). `--disable-vulkan-surface` is what makes it work headless:
 *    there is no window to present to. `--ignore-gpu-blocklist` keeps
 *    Chromium from falling back to software for GPUs it is cautious about.
 *  - macOS: Metal. Only reachable when the renderer runs natively — Docker
 *    on a Mac has no access to the GPU.
 *
 * @param {{ gpu?: boolean, platform?: string }} [options]
 * @returns {string[]}
 */
export function chromiumArgs({ gpu = false, platform = process.platform } = {}) {
	if (!gpu) return ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', ...COMMON_ARGS];
	if (platform === 'darwin') return ['--use-angle=metal', ...COMMON_ARGS];
	if (platform === 'linux') {
		return [
			'--use-angle=vulkan',
			'--enable-features=Vulkan',
			'--disable-vulkan-surface',
			'--ignore-gpu-blocklist',
			...COMMON_ARGS
		];
	}
	throw new Error(`--gpu is supported on Linux and macOS, not on ${platform}`);
}

/**
 * Is this the variant of the Docker image that leaves out the GPU drivers?
 * The image says which one it is in `RENDERER_GPU_DRIVERS` (see the
 * Dockerfile); anywhere else the variable is unset and nothing is assumed.
 * @param {Record<string, string | undefined>} [env]
 */
export function lacksGpuDrivers(env = process.env) {
	return env.RENDERER_GPU_DRIVERS === 'false';
}

/** What to tell someone who gave `--gpu` to the image without GPU drivers. */
export function noGpuDriversMessage() {
	return [
		'--gpu was given, but this image has no GPU drivers.',
		'Use the image whose tag ends in "-gpu", for example',
		'  ghcr.io/versatiles-org/versatiles-map-animator:latest-gpu',
		'or build it yourself with `--build-arg GPU=true`.',
		'Leave out --gpu to render in software.'
	].join('\n');
}

/**
 * Is this WebGL renderer (the `UNMASKED_RENDERER_WEBGL` string) one that
 * draws on the CPU? SwiftShader is Chromium's own; llvmpipe and lavapipe are
 * Mesa's, which a Linux system offers when it finds no GPU.
 * @param {string | null | undefined} renderer
 */
export function isSoftwareRenderer(renderer) {
	return !renderer || /swiftshader|llvmpipe|lavapipe|software/i.test(renderer);
}

/**
 * What to tell someone who asked for a GPU and did not get one.
 * @param {string | null | undefined} renderer
 * @param {{ platform?: string, inContainer?: boolean }} [where]
 */
export function noGpuMessage(renderer, { platform = process.platform, inContainer = false } = {}) {
	const lines = [
		renderer
			? `--gpu was given, but WebGL is drawn in software (${renderer}).`
			: '--gpu was given, but the browser could not start WebGL on a GPU.'
	];
	if (platform === 'linux' && inContainer) {
		lines.push(
			'The container has to be started with access to the GPU:',
			'  NVIDIA:        docker run --gpus all …           (needs the NVIDIA Container Toolkit on the host)',
			'  Intel or AMD:  docker run --device /dev/dri …',
			'Docker Desktop on macOS cannot pass a GPU into a container.'
		);
	} else if (platform === 'linux') {
		lines.push('Check that a Vulkan driver for your GPU is installed (`vulkaninfo --summary`).');
	}
	lines.push('Leave out --gpu to render in software.');
	return lines.join('\n');
}
