#!/usr/bin/env python3
"""End-to-end Artifact Policy Module demonstration."""

from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

from artifact_policy import ArtifactPolicyModule, run_authoritative_verification


def git(repo: Path, *argv: str) -> None:
    subprocess.run(["git", "-C", str(repo), *argv], check=True, stdout=subprocess.DEVNULL)


def write(path: Path, value: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    path.chmod(mode)


def synthetic_demo(root: Path) -> dict:
    repo = root / "synthetic-repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.name", "Artifact Policy Demo")
    git(repo, "config", "user.email", "artifact-policy@example.invalid")
    (repo / ".gitignore").write_text("node_modules/\n.local/\n", encoding="utf-8")
    (repo / "package.json").write_text('{"name":"artifact-policy-demo","private":true}\n', encoding="utf-8")
    (repo / "bun.lock").write_text("lockfileVersion = 1\n", encoding="utf-8")
    policy_document = {
        "schema": "artifact-policy.repo.v1",
        "precious_roots": ["node_modules/local.db"],
        "regenerable_roots": [],
        "regenerable_divergence": "disclose",
    }
    (repo / ".ce-artifact-policy.json").write_text(json.dumps(policy_document) + "\n", encoding="utf-8")
    git(repo, "add", ".gitignore", "package.json", "bun.lock", ".ce-artifact-policy.json")
    git(repo, "commit", "-q", "-m", "demo fixture")

    write(repo / ".local" / "settings.db", "precious-settings\n", 0o600)
    os.symlink("settings.db", repo / ".local" / "current")
    write(repo / "node_modules" / "local.db", "precious-override\n", 0o640)
    write(repo / "node_modules" / "changed.js", "before-changed\n")
    write(repo / "node_modules" / "deleted.js", "before-deleted\n")

    policy = ArtifactPolicyModule.load(str(repo))
    advisory = policy.require_eligible("prepare-advisory")
    command = [
        sys.executable,
        "-c",
        "; ".join([
            "from pathlib import Path",
            "import os",
            "Path('.local/settings.db').write_text('mutated')",
            "Path('.local/settings.db').chmod(0o777)",
            "Path('.local/current').unlink()",
            "os.symlink('wrong-target', '.local/current')",
            "Path('node_modules/local.db').unlink()",
            "Path('node_modules/changed.js').write_text('after-changed')",
            "Path('node_modules/deleted.js').unlink()",
            "Path('node_modules/introduced.js').write_text('introduced')",
        ]),
    ]
    state = root / "controller-state"
    state.mkdir(mode=0o700)
    receipt = run_authoritative_verification(policy, command, str(state), "artifact policy demo")

    assert receipt["outcome"] == "VERIFIED_WITH_REGENERABLE_DIVERGENCE"
    assert receipt["precious_restoration_proven"] is True
    assert receipt["canonical_ignored_state_preserved"] is False
    assert (repo / ".local" / "settings.db").read_text(encoding="utf-8") == "precious-settings\n"
    assert stat.S_IMODE(os.lstat(repo / ".local" / "settings.db").st_mode) == 0o600
    assert os.readlink(repo / ".local" / "current") == "settings.db"
    assert (repo / "node_modules" / "local.db").read_text(encoding="utf-8") == "precious-override\n"
    assert (repo / "node_modules" / "changed.js").read_text(encoding="utf-8") == "after-changed"
    assert not (repo / "node_modules" / "deleted.js").exists()
    assert (repo / "node_modules" / "introduced.js").exists()
    return {
        "advisory": {
            "eligible": advisory["eligible"],
            "inventory": advisory["inventory"],
            "classes": advisory["classes"],
        },
        "receipt": receipt,
        "postconditions": {
            "precious_file_bytes_and_mode_restored": True,
            "precious_symlink_payload_restored": True,
            "precious_override_inside_node_modules_restored": True,
            "regenerable_divergence_left_for_owner": True,
        },
    }


def warm_demo(path: Path) -> dict:
    before_status = subprocess.run(
        ["git", "-C", str(path), "status", "--porcelain"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    policy = ArtifactPolicyModule.load(str(path))
    report = policy.require_eligible("prepare-advisory")
    after_status = subprocess.run(
        ["git", "-C", str(path), "status", "--porcelain"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    inventory = report["inventory"]
    classes = report["classes"]
    assert before_status == after_status
    assert inventory["entries"] > 512
    assert inventory["regular_bytes"] > 64 * 1024 * 1024
    assert inventory["types"]["symlink"] > 0
    assert classes["precious"]["entries"] <= 512
    assert classes["regenerable"]["entries"] > 512
    assert classes["regenerable"]["types"]["symlink"] > 0
    assert classes["precious"]["entries"] + classes["regenerable"]["entries"] == inventory["entries"]
    return {
        "path": str(path),
        "read_only": True,
        "eligible": report["eligible"],
        "inventory": inventory,
        "classes": classes,
        "why_current_controller_refuses": {
            "entry_limit": 512,
            "byte_limit": 64 * 1024 * 1024,
            "symlink_refusal": True,
        },
        "why_module_passes": "classification precedes custody limits and type rules; node_modules is package-manager-owned regenerable state",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--warm",
        default="/private/tmp/ce-work-react-prototype.bHxwD7",
        help="read-only warm JS/TS fixture",
    )
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="artifact-policy-demo-") as td:
        result = {
            "schema": "artifact-policy.demo.v1",
            "synthetic": synthetic_demo(Path(td)),
            "warm_fixture": warm_demo(Path(args.warm)),
        }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
