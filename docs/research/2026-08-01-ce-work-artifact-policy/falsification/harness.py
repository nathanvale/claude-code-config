#!/usr/bin/env python3
"""Falsification harness: Artifact Policy Module wired into the ce-work 3.21.0
controller (disposable copy). Injects hard crashes at five transaction points
plus mutation fixtures, then judges resume against the falsification criterion:

  Falsified if resume cannot produce one idempotent receipt without deleting
  unowned state or falsely claiming canonical ignored-state preservation.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import time

EXP = os.path.dirname(os.path.abspath(__file__))
CONTROLLER = os.path.join(EXP, "controller")
CLI = os.path.join(CONTROLLER, "unit-workspace.py")
FIXTURES = os.path.join(EXP, "fixtures")
STATE = os.path.join(EXP, "state")

sys.path.insert(0, CONTROLLER)

GIT_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "falsify",
    "GIT_AUTHOR_EMAIL": "falsify@example.invalid",
    "GIT_COMMITTER_NAME": "falsify",
    "GIT_COMMITTER_EMAIL": "falsify@example.invalid",
}

REPORT: list[dict] = []


def sh(args, cwd=None, env=None, check=True):
    proc = subprocess.run(args, cwd=cwd, env=env or GIT_ENV, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"{args} failed rc={proc.returncode}\n{proc.stdout}\n{proc.stderr}")
    return proc


def write(path, content, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(content)
    os.chmod(path, mode)


def tree_fingerprint(root, exclude=(".git",)):
    """path -> (kind, payload) for every entry under root."""
    out = {}
    root = os.path.abspath(root)
    for parent, dirs, files in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = [d for d in dirs if d not in exclude or os.path.relpath(parent, root) != "."]
        for name in files + [d for d in dirs if os.path.islink(os.path.join(parent, d))]:
            path = os.path.join(parent, name)
            rel = os.path.relpath(path, root)
            entry = os.lstat(path)
            if stat.S_ISLNK(entry.st_mode):
                out[rel] = ("symlink", os.readlink(path))
            elif stat.S_ISREG(entry.st_mode):
                digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
                out[rel] = ("regular", digest, stat.S_IMODE(entry.st_mode))
    return out


def cli(scenario_state, args, faults="", fault_mode="", check=False):
    env = dict(GIT_ENV)
    env["CE_WORK_RUNS_ROOT"] = scenario_state
    if faults:
        env["CE_WORK_TEST_FAULT"] = faults
    if fault_mode:
        env["CE_WORK_FAULT_MODE"] = fault_mode
    proc = subprocess.run(
        [sys.executable, CLI, *args],
        capture_output=True,
        text=True,
        env=env,
        cwd=CONTROLLER,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"CLI {args} rc={proc.returncode}\n{proc.stdout}\n{proc.stderr}")
    lines = proc.stdout.strip().splitlines()
    word = lines[0] if lines else ""
    body = {}
    if len(lines) > 1:
        try:
            body = json.loads(lines[1])
        except json.JSONDecodeError:
            body = {}
    return proc.returncode, word, body, proc.stderr


def make_repo(path, gitignore, policy=None, extra_tracked=None):
    os.makedirs(path)
    sh(["git", "init", "-q", "-b", "main"], cwd=path)
    sh(["git", "config", "core.excludesFile", "/dev/null"], cwd=path)
    write(os.path.join(path, "README.md"), "falsification fixture\n")
    write(os.path.join(path, ".gitignore"), gitignore)
    if policy is not None:
        write(os.path.join(path, ".ce-artifact-policy.json"), json.dumps(policy, indent=2) + "\n")
    for rel, content in (extra_tracked or {}).items():
        write(os.path.join(path, rel), content)
    sh(["git", "add", "README.md", ".gitignore"] + (
        [".ce-artifact-policy.json"] if policy is not None else []
    ) + list((extra_tracked or {})), cwd=path)
    sh(["git", "commit", "-q", "-m", "base"], cwd=path)
    base = sh(["git", "rev-parse", "HEAD"], cwd=path).stdout.strip()
    write(os.path.join(path, "unit-change.txt"), "accepted unit work\n")
    sh(["git", "add", "unit-change.txt"], cwd=path)
    sh(["git", "commit", "-q", "-m", "unit u1 accepted work"], cwd=path)
    head = sh(["git", "rev-parse", "HEAD"], cwd=path).stdout.strip()
    return base, head


def init_run(scenario_state, repo, base, head):
    os.makedirs(scenario_state, exist_ok=True)
    os.chmod(scenario_state, 0o700)
    brief = os.path.join(os.path.dirname(repo), "brief.md")
    write(brief, "synthetic falsification brief\n")
    digest = hashlib.sha256(open(brief, "rb").read()).hexdigest()
    binding = json.dumps({"mode": "prefer", "target": "claude", "model": None, "source": "falsify"})
    egress = json.dumps({"route": "claude", "intermediaries": [], "restrictions": []})
    rc, word, body, err = cli(scenario_state, [
        "init", "--run-id", "run1", "--repo", repo,
        "--prompt-brief", brief, "--prompt-digest", digest,
        "--binding-json", binding, "--egress-json", egress,
    ])
    if word != "READY":
        raise RuntimeError(f"init failed: {word} {err}")
    os.environ["CE_WORK_RUNS_ROOT"] = scenario_state
    import unit_workspace_state as st
    import unit_workspace_integration as integ
    snapshot = integ.semantic_snapshot(repo)
    assert snapshot["head"] == head
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    claim = {
        "at": now, "reason": "synthetic", "caller_mode": "interactive",
        "mode": "prefer", "confirmed_native": False, "canonical_head": base,
    }
    completion = {
        "at": now, "base": base, "accepted_head": head,
        "evidence_digest": "ab" * 32, "summary": "synthetic completion",
        "snapshot": snapshot, "claim": claim, "changed_paths": [],
    }
    unit = {
        "unit_id": "u1", "state": "native-completed", "dependencies": [], "wave": {},
        "workspace": {"base": base, "path": os.path.join(scenario_state, "run1", "units", "u1", "workspace"), "registered": False},
        "packet_digest": "0" * 64,
        "attempts": [{
            "attempt_id": "attempt-1", "job_id": None, "process_state": "never-started",
            "fallback": {"eligible": False, "reason": "synthetic", "claimed": claim, "completed": completion},
        }],
    }
    with st.locked_manifest("run1", write=True) as doc:
        doc["units"]["u1"] = unit


def manifest(scenario_state):
    return json.loads(open(os.path.join(scenario_state, "run1", "manifest.json")).read())


def jobs_dir(scenario_state):
    return os.path.join(scenario_state, "run1", "jobs")


def record(scenario, name, ok, detail=""):
    REPORT.append({"scenario": scenario, "check": name, "ok": bool(ok), "detail": detail})
    marker = "PASS" if ok else "FAIL"
    print(f"  [{marker}] {name}" + (f" -- {detail}" if detail and not ok else ""))


# ---------------------------------------------------------------- fixtures

def build_bun_linkfarm(root):
    repo = os.path.join(root, "repo")
    policy = {
        "schema": "artifact-policy.repo.v1",
        "precious_roots": ["node_modules/local.db"],
        "regenerable_roots": [
            {"root": "dist", "owner": "project-build", "repair_argv": ["bun", "run", "build"]},
        ],
        "regenerable_divergence": "disclose",
    }
    base, head = make_repo(
        repo,
        "node_modules/\ndist/\n.local-state/\n",
        policy=policy,
        extra_tracked={"bun.lock": "{}\n"},
    )
    write(os.path.join(repo, "node_modules", "pkg-a", "index.js"), "module.exports = 1;\n")
    write(os.path.join(repo, "node_modules", "pkg-a", "cli.js"), "#!/usr/bin/env node\n")
    write(os.path.join(repo, "node_modules", "pkg-b", "util.js"), "module.exports = 2;\n")
    write(os.path.join(repo, "node_modules", "local.db"), "PRECIOUS-OVERRIDE-DB\n")
    os.makedirs(os.path.join(repo, "node_modules", ".bin"))
    os.symlink("../pkg-a/cli.js", os.path.join(repo, "node_modules", ".bin", "tool"))
    write(os.path.join(repo, "packages", "app", "node_modules", "dep", "index.js"), "package-local dep\n")
    write(os.path.join(repo, ".local-state", "config.json"), '{"precious": true}\n')
    write(os.path.join(repo, "dist", "out.js"), "built output v1\n")
    mutate = os.path.join(root, "mutate.py")
    write(mutate, f"""#!/usr/bin/env python3
import os
repo = {repo!r}
open(os.path.join(repo, 'node_modules', 'pkg-a', 'index.js'), 'w').write('MUTATED\\n')
os.unlink(os.path.join(repo, 'node_modules', 'pkg-b', 'util.js'))
os.makedirs(os.path.join(repo, 'node_modules', 'pkg-c'), exist_ok=True)
open(os.path.join(repo, 'node_modules', 'pkg-c', 'new.js'), 'w').write('INTRODUCED\\n')
tool = os.path.join(repo, 'node_modules', '.bin', 'tool')
os.unlink(tool); os.symlink('../pkg-b/util.js', tool)
open(os.path.join(repo, '.local-state', 'config.json'), 'w').write('VERIFICATION SCRIBBLE\\n')
open(os.path.join(repo, 'dist', 'out.js'), 'w').write('built output MUTATED\\n')
""", mode=0o755)
    return repo, base, head, mutate


# ---------------------------------------------------------------- scenarios

def scenario_baseline():
    name = "baseline-bun-linkfarm"
    print(f"== {name}")
    root = os.path.join(FIXTURES, name)
    state = os.path.join(STATE, name)
    repo, base, head, mutate = build_bun_linkfarm(root)
    init_run(state, repo, base, head)
    before = tree_fingerprint(repo)
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", sys.executable, mutate])
    record(name, "verify-run passes with disclosure", word == "RUN_VERIFIED", f"word={word} err={err[-400:]}")
    record(name, "outcome disclosed divergence", body.get("artifact_outcome") == "VERIFIED_WITH_REGENERABLE_DIVERGENCE", str(body.get("artifact_outcome")))
    record(name, "receipt does not claim preservation", body.get("canonical_ignored_state_preserved") is False)
    after = tree_fingerprint(repo)
    for precious in (".local-state/config.json", "node_modules/local.db", "packages/app/node_modules/dep/index.js"):
        record(name, f"precious restored: {precious}", after.get(precious) == before.get(precious))
    record(name, "regenerable change kept (not restored)", after.get("node_modules/pkg-a/index.js") != before.get("node_modules/pkg-a/index.js"))
    record(name, "regenerable delete kept", "node_modules/pkg-b/util.js" not in after)
    record(name, "regenerable introduction preserved (no unowned delete)", "node_modules/pkg-c/new.js" in after)
    record(name, "symlink payload restored is NOT claimed (regenerable)", after.get("node_modules/.bin/tool") == ("symlink", "../pkg-b/util.js"))
    actions = body.get("repair_actions", [])
    owners = {(a.get("owner"), a.get("root")) for a in actions if a.get("action") == "regenerate"}
    record(name, "bun owns node_modules repair", ("bun", "node_modules") in owners, str(actions))
    record(name, "project-build owns dist repair", ("project-build", "dist") in owners)
    doc = manifest(state)
    record(name, "lock released", doc.get("integration_lock") is None)
    record(name, "exactly one receipt", len(doc.get("verifications", [])) == 1)
    rc2, word2, body2, err2 = cli(state, ["verify-run", "--run-id", "run1", "--", "true"])
    record(name, "system dispatchable afterwards", word2 == "RUN_VERIFIED", f"word={word2} err={err2[-300:]}")


CRASH_POINTS = [
    ("p1-after-reclassify", "artifact-after-reclassify", False),
    ("p2-during-capture", "artifact-during-precious-capture", False),
    ("p3-before-restore", "artifact-before-precious-restore", True),
    ("p4-after-restore-before-receipt", "artifact-after-restore-before-receipt", True),
    ("p5-after-receipt-before-release", "artifact-after-receipt-before-release", True),
]


def scenario_crash(label, fault, verification_ran):
    name = f"crash-{label}"
    print(f"== {name}")
    root = os.path.join(FIXTURES, name)
    state = os.path.join(STATE, name)
    repo, base, head, mutate = build_bun_linkfarm(root)
    init_run(state, repo, base, head)
    before = tree_fingerprint(repo)
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", sys.executable, mutate], faults=fault, fault_mode="hard")
    record(name, "hard crash observed", rc == 21, f"rc={rc} word={word}")
    doc = manifest(state)
    record(name, "lock retained by crash (recovery state exists)", doc.get("integration_lock") is not None or fault == "artifact-after-reclassify", str(doc.get("integration_lock")))
    if label == "p4-after-restore-before-receipt":
        # Concurrent mutation inside the crash window, before resume.
        write(os.path.join(repo, "dist", "out.js"), "window mutation after crash\n")
    rc, word, body, err = cli(state, ["artifact-resume", "--run-id", "run1"])
    record(name, "resume completes", word == "ARTIFACT_RESUMED", f"word={word} err={err[-400:]}")
    resume_body = body
    doc = manifest(state)
    record(name, "lock released after resume", doc.get("integration_lock") is None)
    after = tree_fingerprint(repo)
    for precious in (".local-state/config.json", "node_modules/local.db", "packages/app/node_modules/dep/index.js"):
        record(name, f"precious intact after resume: {precious}", after.get(precious) == before.get(precious))
    receipts = doc.get("verifications", [])
    if verification_ran:
        record(name, "exactly one receipt for crashed txn", len(receipts) == 1, f"n={len(receipts)}")
        if receipts:
            art = receipts[0].get("artifact", {})
            diverged = art.get("bulk_divergence_detected")
            preserved = art.get("canonical_ignored_state_preserved")
            record(name, "no false preservation claim", not (preserved is True and diverged), f"preserved={preserved} diverged={diverged}")
            record(name, "verification mutations not deleted by resume", "node_modules/pkg-c/new.js" in after)
    else:
        record(name, "no phantom receipt for a txn that never verified", len(receipts) == 0, f"n={len(receipts)}")
        record(name, "repo untouched", after == before)
    rc, word, body, err = cli(state, ["artifact-resume", "--run-id", "run1"])
    doc2 = manifest(state)
    record(name, "resume idempotent (second run adds nothing)", len(doc2.get("verifications", [])) == len(receipts) and word == "ARTIFACT_RESUMED", f"word={word}")
    custody_debris = [n for n in os.listdir(jobs_dir(state)) if n.startswith("artifact-policy-custody-")]
    record(name, "no orphan custody debris", not custody_debris, str(custody_debris))
    rc, word2, body2, err2 = cli(state, ["verify-run", "--run-id", "run1", "--", "true"])
    record(name, "fresh verify-run succeeds after recovery", word2 == "RUN_VERIFIED", f"word={word2} err={err2[-400:]}")


def scenario_pnpm_hardlinks():
    name = "pnpm-hardlinks"
    print(f"== {name}")
    root = os.path.join(FIXTURES, name)
    state = os.path.join(STATE, name)
    repo = os.path.join(root, "repo")
    base, head = make_repo(repo, "node_modules/\ndata/\n", extra_tracked={"pnpm-lock.yaml": "lockfileVersion: 9\n"})
    store = os.path.join(root, "store")
    write(os.path.join(store, "dep-file.js"), "pnpm store content\n")
    os.makedirs(os.path.join(repo, "node_modules", "dep"))
    os.link(os.path.join(store, "dep-file.js"), os.path.join(repo, "node_modules", "dep", "file.js"))
    init_run(state, repo, base, head)
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", "true"])
    record(name, "regenerable pnpm hardlinks admitted", word == "RUN_VERIFIED", f"word={word} err={err[-300:]}")
    # Now add a precious file with an external hardlink alias.
    write(os.path.join(store, "blob.bin"), "external alias target\n")
    os.makedirs(os.path.join(repo, "data"))
    os.link(os.path.join(store, "blob.bin"), os.path.join(repo, "data", "blob.bin"))
    before = tree_fingerprint(repo)
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", "true"])
    record(name, "precious external hardlink refused", rc != 0 and word == "REFUSED", f"rc={rc} word={word}")
    record(name, "refusal names hardlink topology", "hardlink" in (err + json.dumps(body)), (err + json.dumps(body))[-300:])
    record(name, "nothing mutated by refusal", tree_fingerprint(repo) == before)
    doc = manifest(state)
    record(name, "lock released after refusal", doc.get("integration_lock") is None)


def scenario_opaque_nested():
    name = "opaque-nested-repo"
    print(f"== {name}")
    root = os.path.join(FIXTURES, name)
    state = os.path.join(STATE, name)
    repo = os.path.join(root, "repo")
    base, head = make_repo(repo, "vendor/\n")
    nested = os.path.join(repo, "vendor", "opaque")
    os.makedirs(nested)
    sh(["git", "init", "-q", "-b", "main"], cwd=nested)
    write(os.path.join(nested, "secret.txt"), "hidden nested state\n")
    sh(["git", "add", "secret.txt"], cwd=nested)
    sh(["git", "commit", "-q", "-m", "nested"], cwd=nested)
    init_run(state, repo, base, head)
    before = tree_fingerprint(os.path.join(repo, "vendor"), exclude=())
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", "true"])
    record(name, "opaque precious directory refused", rc != 0 and word == "REFUSED", f"rc={rc} word={word} err={err[-300:]}")
    record(name, "refusal names unsupported entry type", "type-unsupported" in (err + json.dumps(body)), (err + json.dumps(body))[-300:])
    record(name, "nested repository untouched", tree_fingerprint(os.path.join(repo, "vendor"), exclude=()) == before)
    doc = manifest(state)
    record(name, "lock released after refusal", doc.get("integration_lock") is None)


def scenario_gitignore_change():
    name = "gitignore-change"
    print(f"== {name}")
    root = os.path.join(FIXTURES, name)
    state = os.path.join(STATE, name)
    repo = os.path.join(root, "repo")
    base, head = make_repo(repo, "node_modules/\n", extra_tracked={"bun.lock": "{}\n"})
    write(os.path.join(repo, "node_modules", "pkg", "index.js"), "dep\n")
    # Advisory classification under the pre-transport policy.
    advisory = subprocess.run(
        [sys.executable, os.path.join(CONTROLLER, "artifact_policy.py"), "inspect", "--repo", repo, "--phase", "prepare"],
        capture_output=True, text=True, env=GIT_ENV,
    )
    advisory_report = json.loads(advisory.stdout)
    # Transport-added .gitignore change: committed on the canonical branch.
    write(os.path.join(repo, ".gitignore"), "node_modules/\ngenerated/\n")
    sh(["git", "add", ".gitignore"], cwd=repo)
    sh(["git", "commit", "-q", "-m", "transport: ignore generated"], cwd=repo)
    head2 = sh(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
    write(os.path.join(repo, "generated", "cache.bin"), "generated precious unknown v1\n")
    init_run(state, repo, base, head2)
    before = tree_fingerprint(repo)
    mutate = os.path.join(root, "mutate.py")
    write(mutate, f"""#!/usr/bin/env python3
import os
open(os.path.join({repo!r}, 'generated', 'cache.bin'), 'w').write('SCRIBBLED BY VERIFICATION\\n')
""", mode=0o755)
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", sys.executable, mutate])
    record(name, "authoritative run passes", word == "RUN_VERIFIED", f"word={word} err={err[-300:]}")
    doc = manifest(state)
    art = doc["verifications"][0]["artifact"] if doc.get("verifications") else {}
    record(name, "advisory did not see generated/ as ignored",
           all("generated" not in p for p in [advisory_report.get("classes", {}).get("precious", {}).get("roots", [])] ) and advisory_report.get("inventory", {}).get("entries") == 1,
           json.dumps(advisory_report.get("inventory")))
    record(name, "authoritative reclassification captured generated/", art.get("precious_captured", 0) == 1 and "generated/cache.bin" in art.get("precious_restored", []), json.dumps({k: art.get(k) for k in ('precious_captured', 'precious_restored')}))
    after = tree_fingerprint(repo)
    record(name, "reclassified precious restored exactly", after.get("generated/cache.bin") == before.get("generated/cache.bin"))


def scenario_introduced_precious():
    name = "introduced-precious"
    print(f"== {name}")
    root = os.path.join(FIXTURES, name)
    state = os.path.join(STATE, name)
    repo = os.path.join(root, "repo")
    base, head = make_repo(repo, ".local-state/\n")
    write(os.path.join(repo, ".local-state", "existing.json"), "existing precious\n")
    init_run(state, repo, base, head)
    mutate = os.path.join(root, "mutate.py")
    write(mutate, f"""#!/usr/bin/env python3
import os
open(os.path.join({repo!r}, '.local-state', 'new-data.bin'), 'w').write('UNKNOWN INTRODUCED STATE\\n')
""", mode=0o755)
    rc, word, body, err = cli(state, ["verify-run", "--run-id", "run1", "--", sys.executable, mutate])
    blocked = rc != 0 and word == "BLOCKED" and body.get("outcome") == "BLOCKED_PRECIOUS_RESTORATION"
    record(name, "introduced unknown precious blocks", blocked, f"rc={rc} word={word} body={json.dumps(body)[-300:]}")
    record(name, "introduced state preserved, never auto-deleted", os.path.exists(os.path.join(repo, ".local-state", "new-data.bin")))
    doc = manifest(state)
    record(name, "receipt recorded and truthful", bool(doc.get("verifications")) and doc["verifications"][0]["artifact"]["canonical_ignored_state_preserved"] is False)
    record(name, "lock released after receipted block", doc.get("integration_lock") is None)
    # Owner inspects and removes the introduced state; the system must be dispatchable again.
    os.unlink(os.path.join(repo, ".local-state", "new-data.bin"))
    rc, word2, body2, err2 = cli(state, ["verify-run", "--run-id", "run1", "--", "true"])
    record(name, "dispatchable after owner inspection", word2 == "RUN_VERIFIED", f"word={word2} err={err2[-300:]}")


def main():
    for path in (FIXTURES, STATE):
        shutil.rmtree(path, ignore_errors=True)
        os.makedirs(path)
    scenario_baseline()
    for label, fault, verification_ran in CRASH_POINTS:
        scenario_crash(label, fault, verification_ran)
    scenario_pnpm_hardlinks()
    scenario_opaque_nested()
    scenario_gitignore_change()
    scenario_introduced_precious()
    failures = [row for row in REPORT if not row["ok"]]
    summary = {
        "checks": len(REPORT),
        "failed": len(failures),
        "failures": failures,
        "falsified": bool(failures),
    }
    with open(os.path.join(EXP, "report.json"), "w") as handle:
        json.dump({"summary": summary, "checks": REPORT}, handle, indent=2, sort_keys=True)
    print(json.dumps(summary, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
