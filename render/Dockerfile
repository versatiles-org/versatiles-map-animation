# Multi-stage build:
#   1. app-builder — builds the static SvelteKit site (just /index.html and /view.html).
#   2. final       — node:24-slim with Chromium's headless shell + ffmpeg + the renderer
#                    + the built site. The headless shell is smaller than the full
#                    Chromium browser and works fine with --use-gl=swiftshader.

FROM node:24-bookworm-slim AS app-builder
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app/render
COPY render/package.json render/package-lock.json* ./
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund \
	&& npx playwright install --with-deps chromium-headless-shell \
	&& npm cache clean --force \
	&& rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache /root/.npm

COPY --from=app-builder /src/build /app/site
COPY render/render.mjs ./

VOLUME ["/out"]
ENTRYPOINT ["node", "render.mjs"]
CMD ["--help"]
