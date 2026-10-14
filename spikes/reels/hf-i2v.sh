#!/usr/bin/env bash
# Image-to-video through the Higgsfield API (https://api.higgsfield.ai).
# usage: hf-i2v.sh <image.jpg|png> <out.mp4> <prompt> [model] [duration] [resolution]
# models (path = <vendor>/<model>/image-to-video): alibaba/wan-3.0, kling-video/v3.0/std, bytedance/seedance-2.0
# Reads HIGGSFIELD_API_KEY ("<id>:<secret>") from the repo .env; never prints it.
set -euo pipefail
IMG=$1; OUT=$2; PROMPT=$3; MODEL=${4:-alibaba/wan-3.0}; DUR=${5:-5}; RES=${6:-720p}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
KEY=$(grep '^HIGGSFIELD_API_KEY=' "$ROOT/.env" | cut -d= -f2-)
API=https://api.higgsfield.ai
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
case "$IMG" in *.png) CT=image/png;; *) CT=image/jpeg;; esac
curl -sf -X POST "$API/files/generate-upload-url" -H "Authorization: Key $KEY" -H "Content-Type: application/json" -d "{\"content_type\":\"$CT\"}" -o "$TMP/up.json"
python3 - "$TMP/up.json" "$IMG" <<'PY'
import json,subprocess,sys
d=json.load(open(sys.argv[1])); a=['curl','-sf','-X','PUT','--data-binary','@'+sys.argv[2],d['upload_url']]
for k,v in d['upload_headers'].items(): a[1:1]=['-H',f'{k}: {v}']
subprocess.run(a,check=True); open(sys.argv[1]+'.pub','w').write(d['public_url'])
PY
BODY=$(python3 - "$(cat "$TMP/up.json.pub")" "$PROMPT" "$MODEL" "$DUR" "$RES" <<'PY'
import json,sys
url,prompt,model,dur,res=sys.argv[1:6]
b={"image_url":url,"prompt":prompt,"duration":int(dur)}
if model.startswith("alibaba/wan"): b.update(resolution=res,aspect_ratio="adaptive",generate_audio=False,enable_thinking=False)
elif model.startswith("bytedance/seedance"): b.update(resolution=res,generate_audio=False)
elif model.startswith("kling-video"): b.update(sound="off",cfg_scale=0.5,multi_shots=False)
print(json.dumps(b))
PY
)
curl -sf -X POST "$API/$MODEL/image-to-video" -H "Authorization: Key $KEY" -H "Content-Type: application/json" -H "Idempotency-Key: $(uuidgen | tr A-Z a-z)" -d "$BODY" -o "$TMP/sub.json"
RID=$(python3 -c "import json;print(json.load(open('$TMP/sub.json'))['request_id'])")
echo "request $RID" >&2
for _ in $(seq 1 90); do
  curl -sf -H "Authorization: Key $KEY" "$API/requests/$RID/status" -o "$TMP/st.json"
  S=$(python3 -c "import json;print(json.load(open('$TMP/st.json'))['status'])")
  case "$S" in completed) break;; failed|nsfw|canceled) echo "status $S" >&2; exit 1;; esac
  sleep 8
done
curl -sf -o "$OUT" "$(python3 -c "import json;print(json.load(open('$TMP/st.json'))['video']['url'])")"
echo "saved $OUT" >&2
