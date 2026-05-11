# Offline renderer

Headless renderer that takes a sharing code (the `kf=...` URL hash payload) and
produces an MP4 of the animation. Runs in a Docker container with software
WebGL — no GPU required.

## Pull a prebuilt image

Every push to `main` builds and publishes a fresh image to GitHub Container
Registry (see `.github/workflows/docker.yml`):

```sh
docker pull ghcr.io/versatiles-org/versatiles-map-animation:latest
```

Tags published: `latest` (default branch), `main` (branch name), `sha-<short>`
(every push), `v<x.y.z>` (release tags).

## Or build it yourself

```sh
docker build -f render/Dockerfile -t map-anim-render .
```

(Run from the repository root — the Dockerfile expects to see both `package.json`
and `render/` in the build context.)

## Render an animation

```sh
docker run --rm -v "$PWD/out:/out" \
  ghcr.io/versatiles-org/versatiles-map-animation:latest \
  --hash 'AVYwwcnDgAOpi_xtYMyLSDIWRAFfkF3...' \
  --width 1920 \
  --fps 30 \
  --output /out/animation.mp4
```

You can also pass a full URL with `--url` and the renderer will extract the hash:

```sh
docker run --rm -v "$PWD/out:/out" \
  ghcr.io/versatiles-org/versatiles-map-animation:latest \
  --url 'https://example.org/#kf=AVYw...' \
  --output /out/animation.mp4
```

## Options

| flag                   | default           | notes                                                 |
| ---------------------- | ----------------- | ----------------------------------------------------- |
| `--hash <code>`        | (required)        | URL-hash payload from the editor's Share button       |
| `--url <full-url>`     |                   | alternative to `--hash`; renderer extracts the hash   |
| `--width <n>`          | `1280`            | one of `640`, `1280`, `1920`, `3840` (height = ×9/16) |
| `--fps <n>`            | `30`              | frame rate                                            |
| `--crf <n>`            | `18`              | x264 CRF — lower = higher quality, larger file        |
| `--preset <name>`      | `slow`            | x264 preset (`ultrafast`…`veryslow`)                  |
| `--frame-timeout <ms>` | `10000`           | per-frame settle deadline                             |
| `--no-prewarm`         | (prewarm enabled) | skip the initial pass that fills the tile cache       |
| `--end-time <s>`       | full duration     | cap render duration (useful for previews)             |
| `--output <path>`      | (required)        | output MP4 path (mount as a volume — see examples)    |

## How it works

The container bundles a prerendered version of the `/view` route. A small
Node CLI (`render.mjs`) launches headless Chromium with `--use-gl=swiftshader`
so WebGL runs on the CPU, then drives the page frame-by-frame:

1. Navigate to `view.html?render=1#kf=<hash>`. The page's render-mode hook
   exposes `window.__renderer.{seekTo, duration}` and `window.__map`.
2. Optional pre-warm pass: walk the trajectory once at 2 fps to populate the
   browser's HTTP tile cache. Skips with `--no-prewarm`.
3. Capture pass: install a virtual clock (`page.clock`) so MapLibre's internal
   animations (label fades, transitions) evaluate at _animation_ time rather
   than wall-clock time. For each frame, pause the virtual clock at the
   animation time (firing any queued rAF / setTimeout callbacks up to that
   point, so MapLibre's repaint actually runs), drive the playhead, wait
   for `map.idle`, screenshot.
4. Frames stream into ffmpeg over stdin → H.264 / yuv420p MP4 with `+faststart`.

Per-frame render time scales with viewport size and animation complexity.
Plan for ~2–5 s/frame at 1920×1080 with satellite + terrain at high zoom,
and 4–6× that at 4K.
