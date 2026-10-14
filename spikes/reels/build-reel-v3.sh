#!/usr/bin/env bash
# Video-first Reel v3: scenes on a 120 BPM grid, hard cuts, text card per scene, synthesized beat.
# usage: build-reel-v3.sh <bulgur dir> <A|B> <out.mp4>   (A: pour hook, B: 0.88 s flash opener first)
set -euo pipefail
D=$1; V=$2; OUT=$3; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
S4="$D/scenes/s4b.mp4"; S4T=1.0; [ -s "$S4" ] || { S4="$D/scenes/s4.mp4"; S4T=0; }
S4E=$(python3 -c "print($S4T+1.75)"); S4F=$(python3 -c "print($S4T+0.8)"); S4G=$(python3 -c "print($S4T+1.02)")
seg() { # name dur vf layout card fade input-args...
  local name=$1 dur=$2 vf=$3 lay=$4 card=$5 fade=$6; shift 6
  local box="scale=907:1613:flags=lanczos,pad=1080:1920:173:307:white"; [ "$lay" = full ] && box="scale=1080:1920:flags=lanczos"
  ffmpeg -y -loglevel error "$@" -loop 1 -framerate 30 -t "$dur" -i "$D/cards/$card.png" -filter_complex \
   "[0:v]$vf,colorlevels=rimax=0.9:gimax=0.9:bimax=0.9,$box,fps=30,setsar=1,format=yuv420p[b];[1:v]format=rgba,fade=in:st=0:d=$fade:alpha=1[c];[b][c]overlay=0:0:format=auto,trim=0:$dur,setpts=PTS-STARTPTS,format=yuv420p[o]" \
   -map "[o]" -r 30 -c:v libx264 -preset slow -crf 17 -an "$T/$name.mp4"
}
FLASH=0
LIST=()
if [ "$V" = B ]; then
  FLASH=0.88
  seg f1 0.22 "trim=0.6:0.82,setpts=PTS-STARTPTS" right c1 0.001 -i "$D/scenes/s5.mp4"
  seg f2 0.22 "trim=1.2:1.42,setpts=PTS-STARTPTS" right c1 0.001 -i "$D/hook2-wan.mp4"
  seg f3 0.22 "trim=$S4F:$S4G,setpts=PTS-STARTPTS" right c1 0.001 -i "$S4"
  seg f4 0.22 "trim=0.9:1.12,setpts=PTS-STARTPTS" right c1 0.001 -i "$D/scenes/s8.mp4"
  LIST+=(f1 f2 f3 f4)
fi
seg s1 1.75 "trim=0:1.75,setpts=PTS-STARTPTS" right c1 0.12 -i "$D/hook2-wan.mp4"
seg s2 1.5 "zoompan=z='1.0+0.08*on/45':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=45:s=1080x1920:fps=30" full c2 0.12 -loop 1 -framerate 30 -t 1.5 -i "$D/scenes/f2.jpg"
seg s3 2.0 "trim=0:2.0,setpts=PTS-STARTPTS" right c3 0.12 -i "$D/scenes/s3.mp4"
seg s4 1.75 "trim=$S4T:$S4E,setpts=PTS-STARTPTS" right c4 0.12 -i "$S4"
seg s5 1.75 "trim=0:1.75,setpts=PTS-STARTPTS" right c5 0.12 -i "$D/scenes/s5.mp4"
seg s6 1.75 "trim=1.8:3.0,setpts=1.4583*(PTS-STARTPTS)" right c6 0.12 -i "$D/scenes/s6.mp4"
seg s7 1.5 "trim=3.0:4.5,setpts=PTS-STARTPTS" right c7 0.12 -i "$D/hook2-wan.mp4"
seg s8 2.5 "trim=0:2.5,setpts=PTS-STARTPTS" right c8 0.12 -i "$D/scenes/s8.mp4"
LIST+=(s1 s2 s3 s4 s5 s6 s7 s8)
: > "$T/list.txt"; for n in "${LIST[@]}"; do echo "file '$T/$n.mp4'" >> "$T/list.txt"; done
python3 "$(dirname "$0")/make-sound.py" "$T/beat.wav" 3.5,3,4,3.5,3.5,3.5,3,5 $FLASH >&2
ffmpeg -y -loglevel error -f concat -safe 0 -i "$T/list.txt" -i "$T/beat.wav" -map 0:v -map 1:a -shortest -c:v copy -c:a aac -b:a 160k -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
