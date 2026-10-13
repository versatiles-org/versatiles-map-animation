# Multi-stage build:
#   1. app-builder — builds the static SvelteKit site (just /index.html and /view.html).
#   2. ffmpeg      — only the source of a statically linked ffmpeg binary.
#   3. final       — node:24-slim with Chromium's headless shell + ffmpeg + the renderer
#                    + the built site. The headless shell is smaller than the full
#                    Chromium browser and works fine with --use-gl=swiftshader.

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

FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# fonts-dejavu-core: the font Chromium ends up drawing the map's attribution
# ("VersaTiles", bottom right) in. Debian's ffmpeg used to bring it along;
# without it the attribution falls back to another typeface.
#
# libvulkan1 + mesa-vulkan-drivers are for `--gpu`: the Vulkan loader, and
# Mesa's drivers for Intel and AMD GPUs (reached through `--device /dev/dri`).
# NVIDIA's driver is not in the image; the NVIDIA Container Toolkit hands it
# in at `docker run --gpus all`, and NVIDIA_DRIVER_CAPABILITIES tells it to
# include the graphics part (Vulkan), not just CUDA. Without `--gpu` none of
# this is used.
ENV NVIDIA_DRIVER_CAPABILITIES=graphics,utility

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core libvulkan1 mesa-vulkan-drivers \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg

WORKDIR /app/render
COPY render/package.json render/package-lock.json* ./
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund \
	&& npx playwright install --with-deps chromium-headless-shell \
	&& npm cache clean --force \
	&& rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache /root/.npm

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
