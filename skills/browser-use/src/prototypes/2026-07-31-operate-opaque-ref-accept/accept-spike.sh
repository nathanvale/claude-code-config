#!/usr/bin/env bash
# PROTOTYPE — throwaway post-build acceptance spike for PR #284
# (operate opaque-adapter-ref fix). Proves `browser-use operate snapshot`
# resolves an agent-browser target by its native t1 tab ref and drives the
# operation end to end — the exact case that returned
# browser_operation_target_missing before the fix. Run from the worktree's
# skills/browser-use dir. Secret-free; served http fixture.
set -uo pipefail
SPIKE="$(cd "$(dirname "$0")" && pwd)"
ENV="$SPIKE/env.json"
STATE="$SPIKE/state.json"
PORT=8787
FIXTURE="http://localhost:$PORT/login-shapes-fixture.html"

# run the FIXED worktree browser-use, dropping bun's leading "$ ..." echo line
bu() { bun run browser-use "$@" 2>&1 | grep -v '^\$ '; }

echo "== mint verified envelope =="
browser-connect connect agent-browser --json > "$ENV" 2>/dev/null
python3 -c "import json;print(' endpoint:', json.load(open('$ENV'))['data']['endpoint']['ws'][-12:])"

echo "== 1. targets list --mode handoff-bound =="
bu targets list --mode handoff-bound --handoff "$ENV" --json > "$SPIKE/list.json"
python3 -c "import json;d=json.load(open('$SPIKE/list.json'));print(' status:',d['status'],'candidates:',d['data'].get('candidate_count'))"

echo "== 2. targets select --candidate 1 =="
cat "$SPIKE/list.json" | bu targets select --candidate 1 --state "$STATE" --json > "$SPIKE/select.json"
python3 -c "import json;d=json.load(open('$SPIKE/select.json'));print(' select:',d['status'],d.get('error',{}).get('code',''))"
RUNID=$(python3 -c "import json;print(json.load(open('$STATE'))['run_id'])")
echo " state run_id: $RUNID"

echo "== 3. operate snapshot (THE acceptance test) =="
bu --run-id "$RUNID" operate snapshot --handoff "$ENV" --state "$STATE" --json > "$SPIKE/operate.json"
python3 -c "
import json
d=json.load(open('$SPIKE/operate.json'))
print(' operate snapshot:', d['status'], d.get('error',{}).get('code',''))
if d['status']=='ok':
    s=json.dumps(d.get('data',{}))
    print(' Password field present in snapshot:', 'Password' in s)
    print(' VERDICT: PASS — operate resolved the agent-browser t1 target end to end')
else:
    print(' VERDICT: FAIL —', d.get('error',{}).get('code'), d.get('error',{}).get('message',''))
"
