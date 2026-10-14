# Multi-stage build:
#   1. app-builder — builds the static SvelteKit site (just /index.html and /view.html).
#   2. ffmpeg      — only the source of a statically linked ffmpeg binary.
#   3. renderer-deps — fetches what the renderer runs on: Playwright and
#                    Chromium's headless shell. The headless shell is smaller than
#                    the full Chromium browser and works fine with --use-gl=swiftshader.
#   4. renderer    — plain Debian with the Node.js binary, ffmpeg, the headless
#                    shell, the renderer and the built site. npm and yarn are
#                    only needed to build, so they stay behind in the stages above.
#   5. server      — the renderer plus the render server (`server/`), which runs
#                    it for the jobs users add in a browser. Built with
#                    `--target server`; see server/README.md.
#   6. (last)      — the renderer again, so a build without `--target` stays
#                    the renderer image it always was.

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
FROM mwader/static-ffmpeg:9.0.2-1@sha256:f5d100184884eb3e82b0eb14bb5ebf98da99826ac824989720297fb9ef21c822 AS ffmpeg

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

FROM debian:bookworm-slim AS renderer
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# The system libraries Chromium's headless shell links against (`ldd` on its
# binaries, on amd64 and arm64 — they differ), named one by one. Playwright's
# own `install-deps` would also bring xvfb, and with it Mesa's OpenGL drivers and LLVM, plus fonts for
# every script — some 250 MB that drawing a map in software never uses.
# When a new Playwright brings a browser that needs another library, the
# renderer fails at start with the name of the missing file.
#
# fonts-dejavu-core is the one font in the image: Chromium draws the map's
# attribution ("VersaTiles", bottom right) in it. Map and marker labels come
# as glyphs from the tile server and need no font here — except Chinese,
# Japanese and Korean characters, which MapLibre draws with a system font
# and which therefore come out as empty boxes in a video from this image.
# libfontconfig1 brings the configuration that lets Chromium find the font.
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
	&& apt-get install -y --no-install-recommends ca-certificates \
		fonts-dejavu-core libfontconfig1 \
		libasound2 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libdbus-1-3 libdrm2 libexpat1 libgbm1 \
		libglib2.0-0 libnspr4 libnss3 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
		libxext6 libxfixes3 libxi6 libxkbcommon0 libxrandr2 libxrender1 \
		$([ "$GPU" = true ] && echo libvulkan1 mesa-vulkan-drivers) \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
# The same Debian release as this image, so the binary finds its libraries.
COPY --from=renderer-deps /usr/local/bin/node /usr/local/bin/node

WORKDIR /app/render
COPY --from=renderer-deps /app/render/node_modules ./node_modules
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

# The render server: the same image, with the server and a place for its
# data (users file, jobs, videos). Its jobs run `render.mjs` from above.
FROM renderer AS server
WORKDIR /app/server
COPY server/package.json server/*.mjs ./
COPY server/page ./page
ENV DATA_DIR=/data PORT=8080
WORKDIR /data
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["node", "/app/server/server.mjs"]
CMD []

FROM renderer
