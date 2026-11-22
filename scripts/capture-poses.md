# Visual review captures

Shared procedure for every scenario (the hooks live in `src/debug/`, not in a generator).

1. Start the dev server: `npm run dev`.
2. For each pose N in 1..6, open
   `http://localhost:5173/?scenario=<id>&pose=N&res=1920x1080&hud=0`
   and, after the pose has settled (6 s of fixed-step render time), run in the console:
   `await __debug.capture('<id>-pose-N')`
   The dev server writes `captures/<id>-pose-N.png` (git-ignored).
3. Fly-through frames: open `?scenario=<id>&flythrough=1&res=1920x1080&hud=0`, then for each time t
   run `__debug.seek(t); await __debug.capture('<id>-fly-' + t)`. For motion artefacts (shimmer,
   popping), capture short bursts of consecutive frames with `__debug.seek(null)` and successive
   `capture` calls, or record the screen at 60 fps and extract frames with ffmpeg.
4. Performance: open `?scenario=<id>&flythrough=1&perf=1&res=2560x1440&hud=0` in Chrome stable, then
   `JSON.stringify(await __debug.perfRun(60))` (or `__debug.perfDownload()` after a run). The report
   has frame-time and GPU-time average, 99th percentile and max, the backend and the GPU adapter.
