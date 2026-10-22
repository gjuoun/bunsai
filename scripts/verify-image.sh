#!/usr/bin/env bash
# verify-image.sh — prove bunsai runs as a containerized worker, not just from the host.
#
#   bash scripts/verify-image.sh              build for the host platform, run examples/ IN the container
#   bash scripts/verify-image.sh --action     also check action.yml's default tag and run its exact command
#   bash scripts/verify-image.sh --multiarch  build linux/amd64,linux/arm64 and assert the OCI index
#
# Docker or podman may provide the runtime (autodetected); --multiarch needs docker buildx.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="bunsai:verify"
mode="${1:-}"
version="$(cd "$root" && bun -e 'console.log(JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version)')"

fail() {
  echo "FAIL $1"
  shift
  for line in "$@"; do [ -n "$line" ] && printf '%s\n' "$line" | tail -20; done
  exit 1
}

cli="$(command -v docker || command -v podman)"
[ -n "$cli" ] || fail "no docker or podman on PATH"
case "$(uname -m)" in
  arm64|aarch64) platform="linux/arm64" ;;
  *) platform="linux/amd64" ;;
esac

# 1. Build the image for this host (--load makes it runnable here; that is all the e2e needs).
build_log="$("$cli" build --platform "$platform" -t "$image" "$root" 2>&1)" || fail "image build" "$build_log"
echo "image-build=ok ($platform)"

# 2. Run the demo pipeline inside the container with the repo mounted.
run_log="$("$cli" run --rm -v "$root:/work" -w /work/examples "$image" run --force 2>&1)"
printf '%s\n' "$run_log" | grep -q '4/4 steps succeeded' || fail "container run did not report 4/4 steps" "$run_log"
printf '%s\n' "$run_log" | grep -q 'layers: 3 · 4 steps' || fail "container run did not render the layered graph" "$run_log"
echo "container-run=ok"

# 3. The thin tool layer and the bundled binary.
git_log="$("$cli" run --rm --entrypoint git "$image" --version 2>&1)"
printf '%s\n' "$git_log" | grep -q 'git version' || fail "git missing from the image" "$git_log"
docker_log="$("$cli" run --rm --entrypoint docker "$image" --version 2>&1)"
printf '%s\n' "$docker_log" | grep -q 'Docker version' || fail "docker CLI missing from the image" "$docker_log"
image_version="$("$cli" run --rm "$image" --version 2>&1 | tr -d '[:space:]')"
[ "$image_version" = "$version" ] || fail "image reports $image_version, package.json says $version" "$image_version"
echo "tools=ok version=$version"

if [ "$mode" = "--action" ]; then
  tag="$(grep -o 'ghcr\.io/gjuoun/bunsai:[0-9][0-9.]*' "$root/action.yml" | head -1)"
  [ "$tag" = "ghcr.io/gjuoun/bunsai:$version" ] || fail "action.yml default image is '${tag}', expected ghcr.io/gjuoun/bunsai:$version"
  # Same command form as the composite action, against the local image.
  action_log="$("$cli" run --rm -v "$root/examples:/work" -w /work "$image" run --force 2>&1)"
  printf '%s\n' "$action_log" | grep -q '4/4 steps succeeded' || fail "action command form failed" "$action_log"
  echo "action=ok tag=$version"
fi

if [ "$mode" = "--multiarch" ]; then
  command -v docker >/dev/null 2>&1 || fail "--multiarch needs docker buildx"
  dest="$(mktemp -d)"
  trap 'rm -rf "$dest"' EXIT
  multi_log="$(cd "$root" && docker buildx build --platform linux/amd64,linux/arm64 --output "type=oci,dest=$dest/image.oci" . 2>&1)" \
    || fail "multi-arch build" "$multi_log"
  if [ -d "$dest/image.oci" ]; then
    index="$dest/image.oci/index.json"
  else
    tar -xOf "$dest/image.oci" index.json > "$dest/index.json"
    index="$dest/index.json"
  fi
  cat > "$dest/check-index.ts" <<'TS'
const { readFileSync } = require("node:fs");
const index = JSON.parse(readFileSync(process.argv[2], "utf8"));
const found: string[] = (index.manifests ?? []).flatMap((m: any) =>
  m.platform ? [`${m.platform.os}/${m.platform.architecture}`] : []);
const want = ["linux/amd64", "linux/arm64"];
const missing = want.filter((p) => !found.includes(p));
if (missing.length > 0) {
  console.error(`missing ${missing.join(", ")} (index has ${found.join(", ")})`);
  process.exit(1);
}
console.log(`multiarch=ok ${want.join(",")}`);
TS
  index_log="$(bun "$dest/check-index.ts" "$index" 2>&1)" || fail "OCI index platforms" "$index_log"
  echo "$index_log"
fi
