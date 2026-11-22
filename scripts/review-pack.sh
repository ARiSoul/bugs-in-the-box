#!/usr/bin/env bash
# Builds a visual-review packet from captures/ (see scripts/capture-poses.md), for any scenario:
#   scripts/review-pack.sh <out-dir>
# Inputs:  captures/pose-1..8.png, captures/fly-000..299.jpg (10 s at 30 fps, 1920x1080)
# Outputs: <out-dir>/pose-N.png, flythrough.mp4, fly-sheet-{a,b}.jpg (contact sheets, every 0.5 s),
#          burst-{1,2,3}.jpg (6 consecutive frames at full resolution, centre crops, for shimmer,
#          aliasing and popping), burst-diff-{1,2,3}.jpg (frame-to-frame difference, amplified).
set -euo pipefail
out=${1:?usage: review-pack.sh <out-dir>}
cap=captures
mkdir -p "$out"
cp "$cap"/pose-[1-9].png "$out"/
ffmpeg -loglevel error -y -framerate 30 -i "$cap/fly-%03d.jpg" -c:v libx264 -pix_fmt yuv420p -crf 18 "$out/flythrough.mp4"
# contact sheets: 20 frames each (every 15th frame = 0.5 s), 5x4 grid at 384x216
ffmpeg -loglevel error -y -framerate 30 -i "$cap/fly-%03d.jpg" -frames:v 1 \
  -vf "select='not(mod(n\,15))*lt(n\,150)',scale=384:216,tile=5x2" "$out/fly-sheet-a.jpg"
ffmpeg -loglevel error -y -framerate 30 -i "$cap/fly-%03d.jpg" -frames:v 1 \
  -vf "select='not(mod(n\,15))*gte(n\,150)',scale=384:216,tile=5x2" "$out/fly-sheet-b.jpg"
# bursts: 6 consecutive frames (1/30 s apart), centre 960x540 crop at full resolution, 3x2 grid
i=1
for start in 40 140 240; do
  ffmpeg -loglevel error -y -framerate 30 -start_number $start -i "$cap/fly-%03d.jpg" -frames:v 1 \
    -vf "select='lt(n\,6)',crop=960:540:480:270,tile=3x2" "$out/burst-$i.jpg"
  ffmpeg -loglevel error -y -framerate 30 -start_number $start -i "$cap/fly-%03d.jpg" -frames:v 1 \
    -vf "tblend=all_mode=difference,eq=contrast=6,select='lt(n\,6)',crop=960:540:480:270,tile=3x2" "$out/burst-diff-$i.jpg"
  i=$((i + 1))
done
ls -la "$out"
