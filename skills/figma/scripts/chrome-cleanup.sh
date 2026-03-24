#!/bin/bash
# Kill zombie chrome-devtools MCP processes that block new connections

# Find and kill any existing chrome-devtools-mcp chrome processes
pids=$(pgrep -f "chrome-devtools-mcp/chrome-profile" 2>/dev/null)

if [ -n "$pids" ]; then
  echo "Found zombie chrome-devtools processes: $pids"
  kill $pids 2>/dev/null
  sleep 1
  # Force kill if still running
  kill -9 $pids 2>/dev/null
  echo "Cleaned up chrome-devtools processes"
else
  echo "No zombie chrome-devtools processes found"
fi

# Also check for any orphaned Chrome processes from MCP
orphans=$(pgrep -f "remote-debugging-port.*chrome-devtools" 2>/dev/null)
if [ -n "$orphans" ]; then
  echo "Found orphaned Chrome debug processes: $orphans"
  kill $orphans 2>/dev/null
  echo "Cleaned up orphaned processes"
fi

echo "Chrome cleanup complete"
