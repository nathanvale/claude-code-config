#!/usr/bin/env python3
"""ADHD-friendly Claude Code hook handler (user-scoped)."""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from shutil import copy2
from typing import Any, Dict
try:
    from fcntl import LOCK_EX, LOCK_UN, flock  # Unix
except ImportError:  # pragma: no cover - Windows fallback
    LOCK_EX = LOCK_UN = None
    flock = None

STATE_PATH = Path.home() / ".claude" / "adhd-hooks-state.json"
REPO_POLICY_REL = Path(".claude") / "adhd-hooks.json"
MISSION_MAX_AGE_HOURS = 24
AUTH_CONTEXT_HINT = re.compile(r"\b(xero|api-explorer|tenant)\b", re.IGNORECASE)
AUTH_ACTION_HINT = re.compile(r"\b(auth|authenticate|login|oauth|re-?login|re-?auth|session|expired)\b", re.IGNORECASE)
VALID_MODES = {"off", "nudge", "strict"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_input() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def load_state() -> Dict[str, Any]:
    default = {
        "active_mission": None,
        "mode": "nudge",
        "edits_in_mission": 0,
        "subagents_active": 0,
        "last_updated_at": now_iso(),
    }
    if not STATE_PATH.exists():
        return default
    try:
        return json.loads(STATE_PATH.read_text())
    except json.JSONDecodeError:
        try:
            backup = STATE_PATH.with_suffix(f".json.corrupt-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}")
            copy2(STATE_PATH, backup)
        except OSError:
            pass
        return default
    except OSError:
        return default


def save_state(state: Dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    state["last_updated_at"] = now_iso()
    tmp = STATE_PATH.with_suffix(".json.tmp")
    if flock is None:
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(state, indent=2) + "\n")
        os.replace(tmp, STATE_PATH)
        return

    lock_path = STATE_PATH.with_suffix(".json.lock")
    with open(lock_path, "a") as lock:
        flock(lock.fileno(), LOCK_EX)
        try:
            fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(json.dumps(state, indent=2) + "\n")
            os.replace(tmp, STATE_PATH)
        finally:
            flock(lock.fileno(), LOCK_UN)


def out(obj: Dict[str, Any]) -> None:
    print(json.dumps(obj))


def notify(title: str, body: str) -> None:
    """Send a macOS/Linux notification. Best-effort, never raises."""
    try:
        if sys.platform == "darwin":
            safe_body = body.replace('"', "").replace("\\", "")[:120]
            safe_title = title.replace('"', "").replace("\\", "")[:60]
            subprocess.run(
                ["osascript", "-e", f'display notification "{safe_body}" with title "{safe_title}"'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        elif sys.platform.startswith("linux"):
            subprocess.run(
                ["notify-send", title, body],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
    except Exception:
        pass


def block(reason: str) -> int:
    out({"decision": "block", "reason": reason})
    return 0


def additional(event: str, text: str) -> int:
    out(
        {
            "hookSpecificOutput": {
                "hookEventName": event,
                "additionalContext": text,
            }
        }
    )
    return 0


def load_repo_policy(cwd: str) -> Dict[str, Any]:
    if not cwd:
        return {}
    path = Path(cwd) / REPO_POLICY_REL
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def has_control_token(prompt: str, token: str) -> bool:
    # Treat control tokens as explicit directives only when they appear
    # at the start of a non-code-fence line to avoid accidental triggers in snippets.
    token_re = re.compile(rf"^\s*{re.escape(token)}(?:\b|$)")
    in_fence = False
    for line in prompt.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if token_re.search(line):
            return True
    return False


def is_xero_auth_recovery(prompt: str) -> bool:
    return bool(AUTH_CONTEXT_HINT.search(prompt) and AUTH_ACTION_HINT.search(prompt))


def is_non_executing_segment(segment: str) -> bool:
    lowered = segment.lstrip().lower()
    return lowered.startswith(("echo ", "printf ", "cat ", "grep ", "rg ", "sed ", "awk "))


def command_is_dangerous(command: str) -> bool:
    separators = re.compile(r"(?:&&|\|\||;|\n)")
    segments = [s.strip() for s in separators.split(command) if s.strip()]
    for seg in segments:
        if is_non_executing_segment(seg):
            continue
        try:
            parts = shlex.split(seg)
        except ValueError:
            parts = seg.split()
        if not parts:
            continue
        while parts and parts[0] in {"sudo", "command", "env", "time"}:
            parts = parts[1:]
        if not parts:
            continue
        # Detect wrapped shell executions like:
        #   bash -lc "rm -rf /tmp/x"
        #   sh -c "git reset --hard"
        if parts[0] in {"bash", "sh", "zsh", "fish"}:
            idx = None
            for i, arg in enumerate(parts):
                if arg == "-c" or (arg.startswith("-") and "c" in arg[1:] and len(arg) > 2):
                    idx = i
                    break
            if idx is not None and idx + 1 < len(parts):
                nested = parts[idx + 1]
                if command_is_dangerous(nested):
                    return True
        lower_parts = [p.lower() for p in parts]
        joined = " ".join(lower_parts)
        if parts[0] == ":" and "(){ :|:& };:" in joined:
            return True
        if lower_parts[0] == "rm" and (
            {"-rf", "-fr"}.intersection(lower_parts)
            or ("-r" in lower_parts and "-f" in lower_parts)
        ):
            return True
        if lower_parts[0] == "git":
            if lower_parts[1:3] == ["reset", "--hard"]:
                return True
            if lower_parts[1:3] == ["clean", "-f"] or lower_parts[1:3] == ["clean", "-fd"] or lower_parts[1:3] == ["clean", "-fx"]:
                return True
            if len(lower_parts) >= 3 and lower_parts[1] == "checkout" and "--" in lower_parts:
                return True
            if len(lower_parts) >= 3 and lower_parts[1] == "restore" and any(
                flag in lower_parts for flag in ("--source", "--worktree", "--staged")
            ):
                return True
    return False


def mission_is_stale(active: Dict[str, Any]) -> bool:
    stamp = active.get("paused_at") or active.get("started_at")
    if not stamp or not isinstance(stamp, str):
        return False
    try:
        dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return False
    age_hours = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600
    return age_hours > MISSION_MAX_AGE_HOURS


def prune_stale_mission(state: Dict[str, Any]) -> bool:
    active = state.get("active_mission")
    if isinstance(active, dict) and mission_is_stale(active):
        state["active_mission"] = None
        state["edits_in_mission"] = 0
        return True
    return False


def effective_mode(data: Dict[str, Any], state: Dict[str, Any]) -> str:
    mode = str(state.get("mode", "nudge")).lower()
    if mode not in VALID_MODES:
        mode = "nudge"
    policy = load_repo_policy(str(data.get("cwd", "")))
    if policy.get("enabled") is False:
        return "off"
    policy_mode = str(policy.get("mode", "")).lower()
    if policy_mode in VALID_MODES:
        return policy_mode
    return mode


def parse_focus(prompt: str) -> str | None:
    p = prompt.lower()
    for level in ("low", "normal", "deep"):
        if re.search(rf"\bfocus\s*[:=]?\s*{level}\b", p):
            return level
    return None


def parse_mission(prompt: str) -> str | None:
    m = re.search(r"(?:start\s+mission|mission)\s*[:\-]\s*(.+)$", prompt, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def handle_session_start(data: Dict[str, Any], state: Dict[str, Any]) -> int:
    if effective_mode(data, state) == "off":
        return 0
    cwd = data.get("cwd", "")
    active = state.get("active_mission")
    if active and active.get("cwd") == cwd:
        goal = active.get("goal", "unnamed mission")
        notify("Welcome back", f"Picking up where you left off: {goal[:60]}")
        return additional(
            "SessionStart",
            f"ADHD Focus Resume: Active mission is '{goal}'. "
            "Work one thread only. Run one mission at a time (default: 25 items or 15 minutes). "
            "When done, output a short closeout with: done, risks, next action.",
        )

    notify("Ready to roll", "Type MISSION to pick a quest")
    return additional(
        "SessionStart",
        "ADHD Focus Protocol: before substantial work, define ONE mission and focus level "
        "(focus: low|normal|deep). Default mission cap is 25 items or 15 minutes. "
        "If you need to switch repos while another mission is active, use SWITCH_MISSION in your prompt.",
    )


def handle_user_prompt_submit(data: Dict[str, Any], state: Dict[str, Any]) -> int:
    prompt = str(data.get("prompt", ""))
    cwd = str(data.get("cwd", ""))
    active = state.get("active_mission")
    mode = effective_mode(data, state)

    if has_control_token(prompt, "ADHD_OFF"):
        state["mode"] = "off"
        save_state(state)
        notify("Guardrails off", "Flying solo. Type ADHD_NUDGE when you want backup.")
        return additional("UserPromptSubmit", "ADHD hooks set to OFF. Use ADHD_NUDGE or ADHD_STRICT to re-enable.")

    if has_control_token(prompt, "ADHD_NUDGE") or has_control_token(prompt, "ADHD_ON"):
        state["mode"] = "nudge"
        save_state(state)
        return additional("UserPromptSubmit", "ADHD hooks set to NUDGE mode (reminders, minimal blocking).")

    if has_control_token(prompt, "ADHD_STRICT"):
        state["mode"] = "strict"
        save_state(state)
        notify("Locked in", "Strict mode on. No distractions, no detours.")
        return additional("UserPromptSubmit", "ADHD hooks set to STRICT mode (strong focus guardrails).")

    if has_control_token(prompt, "ADHD_STATUS"):
        active_goal = (active or {}).get("goal")
        return additional(
            "UserPromptSubmit",
            f"ADHD hooks status: mode={mode}, active_mission={active_goal or 'none'}",
        )

    if has_control_token(prompt, "COMPLETE_MISSION"):
        completed_goal = (active or {}).get("goal", "mission")
        edits = state.get("edits_in_mission", 0)
        state["active_mission"] = None
        state["edits_in_mission"] = 0
        save_state(state)
        notify("Shipped it!", f"{completed_goal[:50]} done. {edits} edits. Nice work.")
        return additional("UserPromptSubmit", "Mission marked complete. Start a fresh mission when ready.")

    if has_control_token(prompt, "PAUSE_MISSION"):
        if active:
            active["paused_at"] = now_iso()
            state["active_mission"] = active
            save_state(state)
            notify("On pause", f"Saved your spot: {active.get('goal', 'mission')[:60]}")
        return additional("UserPromptSubmit", "Mission paused. Resume explicitly or start a new one with SWITCH_MISSION.")

    auth_recovery = is_xero_auth_recovery(prompt)
    bypass = has_control_token(prompt, "ADHD_BYPASS") or auth_recovery
    if active and active.get("cwd") and active.get("cwd") != cwd and not has_control_token(prompt, "SWITCH_MISSION") and not bypass:
        if mode == "strict":
            return block(
                "Single-thread guard: you already have an active mission in another repo. "
                "Finish it, or resubmit with SWITCH_MISSION to switch deliberately."
            )
        if mode == "nudge":
            return additional(
                "UserPromptSubmit",
                "Nudge: you have an active mission in another repo. Consider finishing it first, "
                "or use SWITCH_MISSION to switch deliberately.",
            )

    # Bare "MISSION" with no goal -- gather context and ask Claude to offer numbered options.
    bare_mission = re.match(r"^\s*MISSION\s*$", prompt, re.IGNORECASE)
    if bare_mission:
        context_parts: list[str] = []
        # Git branch.
        try:
            result = subprocess.run(
                ["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, timeout=3,
            )
            if result.returncode == 0:
                context_parts.append(f"Branch: {result.stdout.strip()}")
        except Exception:
            pass
        # Xero reconciliation backlog -- find the oldest quarter with unreconciled lines.
        data_dir = Path(cwd) / "data" if cwd else None
        oldest_quarter: str | None = None
        oldest_unrec = 0
        if data_dir and data_dir.is_dir():
            for ndjson in sorted(data_dir.glob("statement-lines-*.ndjson")):
                q_unrec = 0
                try:
                    for line in ndjson.read_text().splitlines():
                        if not line.strip():
                            continue
                        row = json.loads(line)
                        if not row.get("isReconciled") and not row.get("bankTransactions"):
                            q_unrec += 1
                except Exception:
                    continue
                if q_unrec > 0 and oldest_quarter is None:
                    oldest_quarter = ndjson.stem.replace("statement-lines-", "").upper().replace("-", " ")
                    oldest_unrec = q_unrec
                    break  # Oldest first (sorted), stop at first hit.
            if oldest_quarter:
                context_parts.append(f"Xero: {oldest_unrec} unreconciled in {oldest_quarter}")

        # Open PRs that need review.
        try:
            result = subprocess.run(
                ["gh", "pr", "list", "--state", "open", "--json", "number,title", "--limit", "3"],
                capture_output=True, text=True, timeout=5, cwd=cwd or None,
            )
            if result.returncode == 0:
                prs = json.loads(result.stdout)
                if prs:
                    pr_summaries = [f"#{p['number']} {p['title'][:40]}" for p in prs]
                    context_parts.append(f"Open PRs: {', '.join(pr_summaries)}")
        except Exception:
            pass

        # Pending todos.
        todos_dir = Path(cwd) / "todos" if cwd else None
        if todos_dir and todos_dir.is_dir():
            pending = [f.name for f in todos_dir.glob("*-pending-*.md")]
            if pending:
                context_parts.append(f"Pending todos: {len(pending)}")

        context_str = ". ".join(context_parts) if context_parts else "No extra context found"
        return additional(
            "UserPromptSubmit",
            "User typed bare MISSION. Show 4 numbered quest options. "
            f"Context: {context_str}. "
            "If there's Xero reconciliation backlog, option 1 is reconciling that quarter (include the count). "
            "If there are open PRs, one option should be reviewing/shipping a PR. "
            "If there are pending todos, one option should be tackling todos. "
            "Keep each option under 12 words. "
            "Option 4 is always: Something else -- just tell me. "
            "Ask them to reply with the number. Do NOT start any work until they pick.",
        )

    focus = parse_focus(prompt)
    mission = parse_mission(prompt)

    if mission:
        state["active_mission"] = {
            "goal": mission,
            "cwd": cwd,
            "focus": focus or "normal",
            "started_at": now_iso(),
        }
        state["edits_in_mission"] = 0
        save_state(state)
        focus_level = focus or "normal"
        notify("Let's go!", f"{mission[:60]} -- focus: {focus_level}")
        return additional(
            "UserPromptSubmit",
            f"Mission set: {mission} (focus: {focus or 'normal'}). "
            "Work this thread only. Cap session at 25 items or 15 minutes.",
        )

    if has_control_token(prompt, "SWITCH_MISSION"):
        new_goal = mission or prompt.strip()[:140]
        state["active_mission"] = {
            "goal": new_goal,
            "cwd": cwd,
            "focus": focus or "normal",
            "started_at": now_iso(),
            "switched": True,
        }
        state["edits_in_mission"] = 0
        save_state(state)
        notify("New quest", f"Switching to: {new_goal[:70]}")
        return additional("UserPromptSubmit", f"Mission switched deliberately. New mission: {new_goal}")

    return 0


def handle_pre_tool_use(data: Dict[str, Any], _state: Dict[str, Any]) -> int:
    tool_name = data.get("tool_name", "")
    if tool_name not in {"Bash", "Shell"}:
        return 0
    command = str((data.get("tool_input") or {}).get("command", ""))
    if command_is_dangerous(command):
        out(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "Blocked by ADHD safety guard: destructive command detected.",
                }
            }
        )
        return 0
    return 0


def handle_post_tool_use(data: Dict[str, Any], state: Dict[str, Any]) -> int:
    if effective_mode(data, state) == "off":
        return 0
    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write"):
        return 0
    state["edits_in_mission"] = int(state.get("edits_in_mission", 0)) + 1
    edits = state["edits_in_mission"]
    save_state(state)

    milestones = {5, 10, 20, 25}
    if edits in milestones:
        if edits == 25:
            notify("Boss level!", f"{edits} edits. Wrap up or keep going?")
        elif edits == 20:
            notify("On fire!", f"{edits} edits. 5 more to the finish line.")
        elif edits == 10:
            notify("Double digits!", f"{edits} edits and counting.")
        else:
            notify("Warming up", f"{edits} edits. You're in the zone.")
        return additional(
            "PostToolUse",
            f"Momentum: {edits} edits this mission. XP +{edits}. "
            "If attention drops, switch to rapid-fire or take a 3-minute reset.",
        )
    return 0


def handle_post_tool_use_failure(data: Dict[str, Any], state: Dict[str, Any]) -> int:
    # Keep this helpful even in off mode; it's non-blocking context only.
    tool_name = data.get("tool_name", "")
    err = str(data.get("error", ""))[:160]
    signature = f"{tool_name}:{err}"
    previous_signature = str(state.get("last_failure_signature", ""))
    previous_at_raw = state.get("last_failure_at")
    if previous_signature == signature and isinstance(previous_at_raw, str):
        try:
            previous_at = datetime.fromisoformat(previous_at_raw.replace("Z", "+00:00"))
            age_seconds = (datetime.now(timezone.utc) - previous_at.astimezone(timezone.utc)).total_seconds()
            if age_seconds < 90:
                return 0
        except ValueError:
            pass

    state["last_failure_signature"] = signature
    state["last_failure_at"] = now_iso()
    save_state(state)
    notify("Oops", f"{tool_name} hit a wall: {err[:70]}. Check terminal.")
    return additional(
        "PostToolUseFailure",
        f"Recovery coach: {tool_name} failed ({err}). Pick one: 1) narrow scope, 2) rollback last step, 3) ask for help with exact error.",
    )


def handle_notification(data: Dict[str, Any], state: Dict[str, Any]) -> int:
    ntype = str(data.get("notification_type", ""))
    msg = str(data.get("message", "Claude needs your attention"))
    active = state.get("active_mission")
    if ntype == "permission_prompt":
        notify("Quick question", msg if msg != "Claude needs your attention" else "Need a yes/no from you to keep going")
    elif ntype == "idle_prompt":
        mission_hint = f" on: {active['goal'][:40]}" if active and active.get("goal") else ""
        notify("Your turn", f"Claude is waiting{mission_hint}. Check terminal.")
    else:
        notify("Claude Code", msg)
    if ntype in {"permission_prompt", "idle_prompt"}:
        return additional("Notification", "Attention ping: close current micro-task, then answer Claude.")
    return 0


def handle_subagent_start(_data: Dict[str, Any], state: Dict[str, Any]) -> int:
    if str(state.get("mode", "nudge")).lower() == "off":
        return 0
    state["subagents_active"] = int(state.get("subagents_active", 0)) + 1
    active = state["subagents_active"]
    save_state(state)
    if active > 2:
        notify("Heads up", f"{active} agents running. That's a lot of plates spinning.")
        return additional(
            "SubagentStart",
            f"Cognitive load alert: {active} subagents active. Prefer one-at-a-time to avoid context thrash.",
        )
    return 0


def handle_subagent_stop(_data: Dict[str, Any], state: Dict[str, Any]) -> int:
    state["subagents_active"] = max(0, int(state.get("subagents_active", 0)) - 1)
    save_state(state)
    return 0


def handle_stop(data: Dict[str, Any], state: Dict[str, Any]) -> int:
    mode = effective_mode(data, state)
    if mode == "off":
        return 0
    # Avoid infinite loop if already re-entering due to Stop block.
    if bool(data.get("stop_hook_active")):
        return 0

    active = state.get("active_mission")
    if not active:
        return 0

    cwd = str(data.get("cwd", ""))
    if active.get("cwd") != cwd:
        return 0

    msg = str(data.get("last_assistant_message", ""))
    msg_lower = msg.lower()
    has_structured_closeout = (
        "mission closeout" in msg_lower
        or "win recap" in msg_lower
        or ("done" in msg_lower and "risk" in msg_lower and "next action" in msg_lower)
    )
    if has_structured_closeout:
        return 0

    if mode == "strict":
        notify("Hold up", "Write a quick closeout before you go")
        return block(
            "Before stopping, provide a Mission closeout: 1) done, 2) risk/open issue, 3) next single action."
        )
    notify("Almost done?", "Jot down what's done, what's risky, what's next")
    return additional(
        "Stop",
        "Nudge: add a 3-line mission closeout (done, risk, next action) before you finish.",
    )


def handle_pre_compact(_data: Dict[str, Any], state: Dict[str, Any]) -> int:
    if str(state.get("mode", "nudge")).lower() == "off":
        return 0
    active = state.get("active_mission")
    if not active:
        return 0
    return additional(
        "PreCompact",
        f"Compaction guard: preserve active mission '{active.get('goal', 'unnamed')}', "
        "focus level, and exact next action in the compacted context.",
    )


def handle_config_change(data: Dict[str, Any], _state: Dict[str, Any]) -> int:
    source = str(data.get("source", "unknown"))
    path = str(data.get("file_path", "unknown"))
    return additional(
        "ConfigChange",
        f"Config changed ({source}): {path}. Keep focus flow stable and re-check ADHD hook behavior if needed.",
    )


def main() -> int:
    event = sys.argv[1] if len(sys.argv) > 1 else ""
    data = load_input()
    state = load_state()
    if prune_stale_mission(state):
        save_state(state)

    handlers = {
        "SessionStart": handle_session_start,
        "UserPromptSubmit": handle_user_prompt_submit,
        "PreToolUse": handle_pre_tool_use,
        "PostToolUse": handle_post_tool_use,
        "PostToolUseFailure": handle_post_tool_use_failure,
        "Notification": handle_notification,
        "SubagentStart": handle_subagent_start,
        "SubagentStop": handle_subagent_stop,
        "Stop": handle_stop,
        "PreCompact": handle_pre_compact,
        "ConfigChange": handle_config_change,
    }

    fn = handlers.get(event)
    if not fn:
        return 0
    try:
        return int(fn(data, state) or 0)
    except Exception as exc:
        # Fail open: hooks should never brick workflow due to internal errors.
        print(f"ADHD hook warning ({event}): {exc}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
