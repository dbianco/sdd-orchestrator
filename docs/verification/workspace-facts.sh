#!/usr/bin/env bash
# Derives the workspace facts that route_task expects (spec section 8.3).
# Usage: workspace-facts.sh [--repositories N] [--host NAME]
# Prints one JSON object. Facts the host must estimate itself (estimated_files,
# paths_touched, new_subsystem) are not derived here.
set -euo pipefail

repositories=1
host="${SDD_HOST:-claude-code}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repositories) repositories="$2"; shift 2 ;;
    --host) host="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

has_spec_library=false
for d in openspec specs .specify _bmad-output .kiro/specs .sdlc; do
  if [ -d "$d" ]; then has_spec_library=true; break; fi
done

is_greenfield=false
if [ -f .sdd/config.json ] && grep -Eq '"greenfield"[[:space:]]*:[[:space:]]*true' .sdd/config.json; then
  is_greenfield=true
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  commits=$(git rev-list --count HEAD 2>/dev/null || echo 0)
  if [ "$commits" -lt 20 ]; then is_greenfield=true; fi
else
  is_greenfield=true
fi

printf '{"has_spec_library":%s,"is_greenfield":%s,"repositories":%s,"host":"%s"}\n' \
  "$has_spec_library" "$is_greenfield" "$repositories" "$host"
