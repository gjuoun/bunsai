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
  # actionlint validates workflows, not action metadata: parse action.yml for real instead.
  scratch="$(mktemp -d)"
  trap 'rm -rf "$scratch"' EXIT
  cat > "$scratch/check-action.ts" <<'TS'
const { readFileSync } = require("node:fs");
const action: any = Bun.YAML.parse(readFileSync(process.argv[2], "utf8"));
const version = JSON.parse(readFileSync(process.argv[3], "utf8")).version;
const problems: string[] = [];
if (action?.runs?.using !== "composite") problems.push("runs.using must be composite");
if (!Array.isArray(action?.runs?.steps) || action.runs.steps.length === 0) problems.push("runs.steps must be non-empty");
if (action?.runs?.steps?.[0]?.shell !== "bash") problems.push("the action step must set shell: bash");
const image = action?.inputs?.image?.default;
const args = action?.inputs?.args?.default;
const workdir = action?.inputs?.workdir?.default;
if (image !== `ghcr.io/gjuoun/bunsai:${version}`) problems.push(`inputs.image default is ${image}, want ghcr.io/gjuoun/bunsai:${version}`);
if (args !== "run") problems.push(`inputs.args default is ${args}, want run`);
if (typeof workdir !== "string" || !workdir.includes("github.workspace")) problems.push("inputs.workdir default must reference github.workspace");
if (problems.length > 0) { console.error(problems.join("; ")); process.exit(1); }
console.log(`action=ok tag=${version}`);
TS
  action_check="$(bun "$scratch/check-action.ts" "$root/action.yml" "$root/package.json" 2>&1)" \
    || fail "action.yml" "$action_check"
  # Same command form as the composite action: mount a workspace, run its pipeline in the image.
  ws="$(mktemp -d /tmp/bunsai-action-ws.XXXXXX)"
  trap 'rm -rf "$scratch" "$ws"' EXIT
  printf '%s\n' \
    'export default { steps: [{ name: "hello", run: (ctx) => ctx.shell("echo action-ok") }] };' \
    > "$ws/bunsai.config.ts"
  action_log="$("$cli" run --rm -v "$ws:/work" -w /work "$image" run 2>&1)"
  printf '%s\n' "$action_log" | grep -q '1/1 steps succeeded' || fail "action command form failed" "$action_log"
  echo "$action_check"
fi

if [ "$mode" = "--multiarch" ]; then
  command -v docker >/dev/null 2>&1 || fail "--multiarch needs docker buildx"
  dest="$(mktemp -d)"
  trap 'rm -rf "$dest"' EXIT
  multi_log="$(cd "$root" && docker buildx build --platform linux/amd64,linux/arm64 --output "type=oci,dest=$dest/image.oci" . 2>&1)" \
    || fail "multi-arch build" "$multi_log"
  mkdir -p "$dest/oci"
  if [ -d "$dest/image.oci" ]; then
    cp -R "$dest/image.oci/." "$dest/oci/"
  else
    tar -xf "$dest/image.oci" -C "$dest/oci"
  fi
  # buildx wraps the result in an index of indexes, so walk nested manifests.
  cat > "$dest/check-index.ts" <<'TS'
const { existsSync, readFileSync } = require("node:fs");
const root = process.argv[2];
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
function platforms(node: any): string[] {
  const out: string[] = [];
  for (const manifest of node?.manifests ?? []) {
    if (manifest.platform) out.push(`${manifest.platform.os}/${manifest.platform.architecture}`);
    else if (typeof manifest.digest === "string") {
      const blob = `${root}/blobs/${manifest.digest.replace(":", "/")}`;
      if (existsSync(blob)) out.push(...platforms(read(blob)));
    }
  }
  return out;
}
const found = [...new Set(platforms(read(`${root}/index.json`)))];
const want = ["linux/amd64", "linux/arm64"];
const missing = want.filter((p) => !found.includes(p));
if (missing.length > 0) {
  console.error(`missing ${missing.join(", ")} (index has ${found.join(", ") || "nothing"})`);
  process.exit(1);
}
console.log(`multiarch=ok ${want.join(",")}`);
TS
  index_log="$(bun "$dest/check-index.ts" "$dest/oci" 2>&1)" || fail "OCI index platforms" "$index_log"
  echo "$index_log"
fi
