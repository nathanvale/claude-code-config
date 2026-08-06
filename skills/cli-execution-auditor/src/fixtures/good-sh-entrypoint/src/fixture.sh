#!/usr/bin/env bash
# good-sh-entrypoint runnable: a minimal CORRECT facade CLI fronted by a shell
# script. Exits 0 clean (valid envelope under --json), rejects unknown options
# with the declared usage exit code 2. The auditor MUST exercise this via the
# .sh and find nothing — proving a shell-fronted facade CLI is not false-flagged.
set -euo pipefail
json=0
args=()
for a in "$@"; do
  case "$a" in
    audit) ;;  # ignore the command token
    check) ;;
    --json) json=1 ;;
    *) args+=("$a") ;;
  esac
done
run_id="fixture-sh"
if [ "${#args[@]}" -gt 0 ]; then
  if [ "$json" -eq 1 ]; then
    printf '{"status":"error","run_id":"%s","error":{"code":"usage_error","message":"unknown option","exit_code":2}}\n' "$run_id"
  else
    printf 'unknown option: %s\n' "${args[0]}" >&2
  fi
  exit 2
fi
if [ "$json" -eq 1 ]; then
  printf '{"status":"ok","run_id":"%s","data":{"action":"clean"}}\n' "$run_id"
else
  printf 'clean\n'
fi
exit 0
