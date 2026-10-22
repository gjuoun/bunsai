#!/usr/bin/env bash
# verify-examples.sh — behavior-freeze proof for the two example pipelines.
#
# Clears both .bunsai state dirs, runs each pipeline from scratch, and requires
# exit 0 plus the "4/4 steps succeeded" summary. Docker/podman must be on PATH
# for examples/docker-app.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

rm -rf "$root/examples/.bunsai" "$root/examples/docker-app/.bunsai"

run_demo() {
  local label="$1" dir="$2" log="/tmp/jun/effect-refactor/${1}.log"
  local out code
  out="$(cd "$dir" && bun "$root/src/cli.ts" run 2>&1)"
  code=$?
  printf '%s\n' "$out" > "$log"
  if [ "$code" -ne 0 ] || ! printf '%s' "$out" | grep -q "4/4 steps succeeded"; then
    echo "FAIL ${label}: exit ${code} (log: ${log})"
    printf '%s\n' "$out" | tail -10
    return 1
  fi
  echo "${label}=ok"
}

run_demo examples "$root/examples" || status=1
run_demo docker "$root/examples/docker-app" || status=1

if [ "$status" -ne 0 ]; then
  exit 1
fi
echo "examples=ok docker=ok"