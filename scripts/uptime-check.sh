#!/usr/bin/env bash
# Uptime check of the deployed app (H-06): GET <url>, expect HTTP 200 and {"status":"ok"} (or
# "degraded", which passes with a warning). Three tries, ten seconds each. Used by
# .github/workflows/uptime.yml; run by hand:  bash scripts/uptime-check.sh https://…/api/health
set -uo pipefail

url="${1:-}"
if [ -z "$url" ]; then
  echo "::notice title=Uptime::HEALTH_URL is not set; nothing was checked."
  exit 0
fi

for attempt in 1 2 3; do
  body="$(curl --silent --show-error --max-time 10 --write-out '\n%{http_code}' "$url" 2>&1)"
  code="${body##*$'\n'}"
  json="${body%$'\n'*}"
  status="$(printf '%s' "$json" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')"
  if [ "$code" = "200" ] && [ "$status" = "ok" ]; then
    echo "Uptime: $url is ok."
    exit 0
  fi
  if [ "$code" = "200" ] && [ "$status" = "degraded" ]; then
    echo "::warning title=Uptime::$url answers degraded: $json"
    exit 0
  fi
  echo "Attempt $attempt: HTTP $code, status '${status:-none}'."
  [ "$attempt" -lt 3 ] && sleep 10
done

echo "::error title=Uptime::$url is down (HTTP $code, status '${status:-none}')."
exit 1
