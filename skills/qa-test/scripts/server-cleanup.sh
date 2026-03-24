#!/bin/bash
# Cleanup dev server and associated resources for qa-test skill.
# Reads PID from evidence dir, kills process, removes lock file.
#
# Usage: server-cleanup.sh <TICKET_KEY>
# Example: server-cleanup.sh POS-3044

KEY="${1:?Usage: server-cleanup.sh <TICKET_KEY>}"
EVIDENCE_DIR="$HOME/.claude/state/qa-test/$KEY"
PID_FILE="$EVIDENCE_DIR/server.pid"
LOCK_FILE="$HOME/.claude/state/qa-test/RUNNING"

cleanup_server() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill -TERM "$PID" 2>/dev/null
      sleep 2
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" 2>/dev/null
      fi
    fi
    rm -f "$PID_FILE"
  fi
}

cleanup_port() {
  lsof -ti:44389 2>/dev/null | xargs kill -9 2>/dev/null || true
}

cleanup_react() {
  pkill -f "react-scripts start" 2>/dev/null || true
}

cleanup_lock() {
  rm -f "$LOCK_FILE"
}

# Run all cleanup steps
cleanup_server
cleanup_port
cleanup_react
cleanup_lock

echo "Cleanup complete for $KEY"
