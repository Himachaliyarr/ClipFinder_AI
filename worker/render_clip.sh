#!/usr/bin/env bash
# Basic 9:16 rough cut. Usage: render_clip.sh input.mp4 start_seconds end_seconds output.mp4
set -euo pipefail
INPUT="$1"; START="$2"; END="$3"; OUTPUT="$4"
DURATION=$(python3 -c "print(max(0,float('$END')-float('$START')))")
ffmpeg -y -ss "$START" -i "$INPUT" -t "$DURATION" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1" -c:v libx264 -preset veryfast -crf 21 -c:a aac -b:a 128k -movflags +faststart "$OUTPUT"
