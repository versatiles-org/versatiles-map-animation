# Offline renderer

Headless renderer that takes a sharing code (the `kf=...` URL hash payload) and
produces a video of the animation — an MP4 by default, or one of the
[formats](#formats) for editing and lossless output. Runs in a Docker container with software
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
npm run docker:build
```

This runs `docker build -f render/Dockerfile -t versatiles-map-animation .`
from the repository root (the Dockerfile expects to see both `package.json`
and `render/` in the build context) and leaves you with a local image named
`versatiles-map-animation`. Use that name in place of
`ghcr.io/versatiles-org/versatiles-map-animation:latest` in the commands
below, and drop `--pull always` if you copied a command from the editor:
with it Docker looks for an image of that name online and fails.

## Render an animation

```sh
docker run --rm -it -v "$PWD:/out" \
  ghcr.io/versatiles-org/versatiles-map-animation:latest \
  --hash 'AVYwwcnDgAOpi_xtYMyLSDIWRAFfkF3...' \
  --width 1920 \
  --fps 30 \
  --output animation.mp4
```

The container's working directory is `/out`, so a plain filename for
`--output` lands in whatever the caller mounted there. The mount above
(`-v "$PWD:/out"`) makes the resulting MP4 appear in the host's current
directory; absolute paths (`--output /out/sub/foo.mp4`) still work too.

You can also pass a full URL with `--url` and the renderer will extract the hash:

```sh
docker run --rm -it -v "$PWD:/out" \
  ghcr.io/versatiles-org/versatiles-map-animation:latest \
  --url 'https://example.org/#kf=AVYw...' \
  --output animation.mp4
```

## Options

| flag                   | default           | notes                                                 |
| ---------------------- | ----------------- | ----------------------------------------------------- |
| `--hash <code>`        | (required)        | URL-hash payload from the editor's Share button       |
| `--url <full-url>`     |                   | alternative to `--hash`; renderer extracts the hash   |
| `--width <n>`          | `1280`            | one of `640`, `1280`, `1920`, `3840` (height = ×9/16) |
| `--fps <n>`            | `30`              | frame rate                                            |
| `--format <name>`      | `mp4`             | `mp4`, `prores`, `ffv1` or `animation` — see below    |
| `--quality <level>`    | `standard`        | for `mp4`: `high`, `standard` or `small`              |
| `--crf <n>`            |                   | for `mp4`: exact x264 CRF instead of `--quality`      |
| `--preset <name>`      | `slow`            | for `mp4`: x264 preset (`ultrafast`…`veryslow`)       |
| `--frame-timeout <ms>` | `30000`           | per-frame settle deadline                             |
| `--motion-blur <n>`    | `1` (off)         | sub-frames per output frame; 4–8 typical; N× slower   |
| `--shutter-angle <d>`  | `180`             | shutter angle in degrees (only with motion blur)      |
| `--no-prewarm`         | (prewarm enabled) | skip the initial pass that fills the tile cache       |
| `--end-time <s>`       | full duration     | cap render duration (useful for previews)             |
| `--output <path>`      | (required)        | output file; its ending has to match the format       |

## Formats

| `--format`  | file   | what it is                              | for                                                                  |
| ----------- | ------ | --------------------------------------- | -------------------------------------------------------------------- |
| `mp4`       | `.mp4` | H.264, 4:2:0, 8 bit                     | the web, social media, sending around. Small, plays everywhere.      |
| `prores`    | `.mov` | ProRes 4444, 4:4:4, 10 bit              | editing in Premiere, Final Cut, DaVinci Resolve. Visually lossless.  |
| `ffv1`      | `.mkv` | FFV1, RGB — **lossless**                | archiving and exact work. Compact; opens in Resolve, VLC, ffmpeg.    |
| `animation` | `.mov` | QuickTime Animation, RGB — **lossless** | lossless for Adobe and Apple software. About twice the size of FFV1. |

The two lossless formats store exactly the pixels the browser drew. As a
guide, at 1920×1080 a frame takes about 0.1 MB as `mp4`, 1.5 MB as `prores`,
1.5–2 MB as `ffv1` and 3–4 MB as `animation`.

`mp4` has three quality levels:

| `--quality` | x264 CRF | roughly, at 1920×1080 and 30 fps | for                                       |
| ----------- | -------- | -------------------------------- | ----------------------------------------- |
| `high`      | 15       | 27–40 Mbit/s                     | uploading to a platform that re-encodes   |
| `standard`  | 18       | 18–28 Mbit/s                     | general use                               |
| `small`     | 24       | 7–13 Mbit/s                      | embedding the file directly on a web page |

`--crf` sets the value directly. `--quality`, `--crf` and `--preset` only
apply to `mp4`.

```sh
docker run --rm -it -v "$PWD:/out" \
  ghcr.io/versatiles-org/versatiles-map-animation:latest \
  --hash 'AVYw...' --width 1920 --format ffv1 --output animation.mkv
```

**Colour.** The captured frames are sRGB. The lossless formats keep those
RGB values untouched; `mp4` and `prores` are converted with the BT.709
matrix to limited range, as every player expects of HD video. All files are
tagged with BT.709 primaries and the sRGB transfer curve. With motion blur
the frames are averaged in linear light at 16 bits and brought back to the
same sRGB curve, so anything that does not move keeps its exact colour.

## Timing summary

At the end of every run the renderer prints where the time went:

```
timing:
  loading the page               7.5 s   3%
  warming the tile cache        15.1 s   5%
  drawing frames               191.2 s  70%  (1062 ms per frame)
  capturing frames              60.6 s  22%  (337 ms per frame)
  encoding after last frame      0.2 s   0%
  total                        274.6 s
```

"Drawing" is seeking to a frame and waiting until the map has settled;
"capturing" is the screenshot (read-back, PNG encoding, transfer from the
browser). ffmpeg encodes in parallel while frames are captured, so only what
is left after the last frame shows up as encoding.

## How it works

The container bundles a prerendered version of the `/view` route. A small
Node CLI (`render.mjs`) launches headless Chromium with `--use-gl=swiftshader`
so WebGL runs on the CPU, then drives the page frame-by-frame:

1. Navigate to `view.html?render=1#kf=<hash>`. The page's render-mode hook
   exposes `window.__renderer.{seekTo, duration}` and `window.__map`.
2. Optional pre-warm pass: walk the trajectory once at 2 fps to populate the
   browser's HTTP tile cache. Skips with `--no-prewarm`.
3. Capture pass: for each frame, drive the playhead with
   `__renderer.seekTo(t)`, wait for `map.on('idle')`, screenshot. The
   idle wait is the synchronisation point — by the time it resolves,
   tiles are loaded and any MapLibre internal animations have settled —
   so wall-clock time spent rendering each frame doesn't leak into the
   captured output. In render mode the page switches off what makes
   MapLibre take many frames to settle (label fades, terrain textures
   renewed one tile per frame), so a frame is usually final after one or
   two redraws. The screenshot uses Chromium's speed-optimised PNG.
4. Frames stream into ffmpeg over stdin, which encodes them in the chosen
   format (`formats.mjs` holds the ffmpeg settings of each).

Per-frame render time scales with viewport size and animation complexity.
As a guide, the example animation (satellite + terrain) takes about
0.6 s/frame at 1920×1080 in the container on an Apple M4 Pro; expect
several times that at 4K, and multiply by the `--motion-blur` factor. The
timing summary at the end of a run shows the numbers for your machine.
