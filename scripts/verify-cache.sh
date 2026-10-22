#!/usr/bin/env bash
# verify-cache.sh — proves content-hash cache invalidation on examples/bunsai.config.ts.
#
# 1. clean slate: everything runs (4/4).
# 2. rerun: all four steps are served from the cache.
# 3. content edit of the declared input (deploy-dry-run's bunsai.config.ts):
#    exactly that leaf step reruns. mtime-only changes intentionally do not.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
examples="$root/examples"
config="$examples/bunsai.config.ts"
backup="$(mktemp)"
cp "$config" "$backup"
restore() { cp "$backup" "$config"; rm -f "$backup"; }
trap restore EXIT

rm -rf "$examples/.bunsai"

run() { (cd "$examples" && bun "$root/src/cli.ts" run); }

out1="$(run 2>&1)"
code1=$?
if [ "$code1" -ne 0 ] || ! printf "%s" "$out1" | grep -q "4/4 steps succeeded"; then
  echo "FAIL first run: exit $code1"
  printf "%s\n" "$out1" | tail -10
  exit 1
fi
echo "first-run=ok"

out2="$(run 2>&1)"
code2=$?
cached="$(printf "%s" "$out2" | grep -c "skip (cached)")"
if [ "$code2" -ne 0 ] || [ "$cached" -ne 4 ]; then
  echo "FAIL second run: exit $code2 cached=$cached (want 4)"
  printf "%s\n" "$out2" | tail -10
  exit 1
fi
echo "second-run-cached=ok"

# A content edit of the declared input — touch alone must not invalidate.
printf "\n// cache-bust probe\n" >> "$config"
out3="$(run 2>&1)"
code3=$?

# Assert through the newest run record (written into the gitignored .bunsai dir).
probe="$examples/.bunsai/run-summary.ts"
cat > "$probe" <<"TS"
const { readdirSync, readFileSync } = require("node:fs");
const dir = ".bunsai/runs";
const ids = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
const rec = JSON.parse(readFileSync(dir + "/" + ids[ids.length - 1], "utf8"));
const executed = rec.steps.filter((s) => s.status !== "skipped").map((s) => s.name);
console.log(JSON.stringify({ ok: rec.ok, executed }));
TS
summary="$(cd "$examples" && bun "$probe")"
want='{"ok":true,"executed":["deploy-dry-run"]}'
if [ "$code3" -ne 0 ] || [ "$summary" != "$want" ]; then
  echo "FAIL third run: exit $code3 recorded=$summary (want $want)"
  printf "%s\n" "$out3" | tail -10
  exit 1
fi
echo "third-run-invalidated=ok"
echo "cache-demo=ok"
