# Multi-stage build:
#   1. app-builder — builds the static SvelteKit site (just /index.html and /view.html).
#   2. ffmpeg      — only the source of a statically linked ffmpeg binary.
#   3. renderer-deps — fetches what the renderer runs on: Playwright and
#                    Chromium's headless shell. The headless shell is smaller than
#                    the full Chromium browser and works fine with --use-gl=swiftshader.
#   4. final       — plain Debian with the Node.js binary, ffmpeg, the headless
#                    shell, the renderer and the built site. npm and yarn are
#                    only needed to build, so they stay behind in the stages above.

FROM node:24-bookworm-slim AS app-builder
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# One self-contained binary (about 100 MB) in place of Debian's `ffmpeg`
# package, which brings some 200 packages and 400 MB of codecs, OpenGL and
# desktop libraries the renderer never touches. It has what `formats.mjs`
# asks for: libx264, prores_ks, ffv1, qtrle and the zscale filter (libzimg).
# Pinned by digest, so a moved tag cannot change what gets built.
FROM mwader/static-ffmpeg:7.1.1@sha256:11a44711684c0b9f754c047dcd64235b8b52deab251bd0e0a86f22faa160749c AS ffmpeg

FROM node:24-bookworm-slim AS renderer-deps
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app/render
COPY render/package.json render/package-lock.json ./
# `npm ci` installs exactly the Playwright version of the lock file, and
# with it one exact Chromium: a new browser can draw the map differently, so
# it should only change when the lock file does.
#
# Playwright downloads an ffmpeg of its own next to the browser; it is for
# recording videos of a page, which the renderer does not do.
RUN npm ci --omit=dev --no-audit --no-fund \
	&& npx playwright install chromium-headless-shell \
	&& rm -r /ms-playwright/ffmpeg-*

FROM debian:bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# fonts-dejavu-core: the font Chromium ends up drawing the map's attribution
# ("VersaTiles", bottom right) in. Debian's ffmpeg used to bring it along;
# without it the attribution falls back to another typeface.
#
# `--build-arg GPU=true` builds the variant for `--gpu`, published with a
# `-gpu` suffix on its tags. It adds libvulkan1 + mesa-vulkan-drivers: the
# Vulkan loader, and Mesa's drivers for Intel and AMD GPUs (reached through
# `--device /dev/dri`) — some 260 MB that a render in software never touches,
# which is why the default image goes without. NVIDIA's driver is in neither;
# the NVIDIA Container Toolkit hands it in at `docker run --gpus all`, and
# NVIDIA_DRIVER_CAPABILITIES tells it to include the graphics part (Vulkan),
# not just CUDA. RENDERER_GPU_DRIVERS lets the renderer tell the two variants
# apart, so `--gpu` in the default image can name the image to use instead.
ARG GPU=false
ENV RENDERER_GPU_DRIVERS=${GPU}
ENV NVIDIA_DRIVER_CAPABILITIES=graphics,utility

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core \
		$([ "$GPU" = true ] && echo libvulkan1 mesa-vulkan-drivers) \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
# The same Debian release as this image, so the binary finds its libraries.
COPY --from=renderer-deps /usr/local/bin/node /usr/local/bin/node

WORKDIR /app/render
COPY --from=renderer-deps /app/render/node_modules ./node_modules
# The system libraries and fonts Chromium needs. Playwright's command line
# runs without npm.
RUN node node_modules/playwright/cli.js install-deps chromium-headless-shell \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=renderer-deps /ms-playwright /ms-playwright
COPY render/package.json ./

COPY --from=app-builder /src/build /app/site
COPY render/render.mjs render/formats.mjs render/gpu.mjs ./

# Final WORKDIR is the volume mount point so `--output` accepts plain
# filenames (`--output animation.mp4`) — they resolve relative to the
# caller's mounted host directory instead of leaking into the image layer.
# The entry-point uses an absolute path because `render.mjs` lives in
# `/app/render`, not in the runtime WORKDIR.
WORKDIR /out
VOLUME ["/out"]
ENTRYPOINT ["node", "/app/render/render.mjs"]
CMD ["--help"]
