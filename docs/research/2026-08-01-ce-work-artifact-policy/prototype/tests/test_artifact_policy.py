from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from artifact_policy import (  # noqa: E402
    ArtifactPolicyModule,
    PolicyError,
    inventory_ignored,
    run_authoritative_verification,
)


def git(repo: Path, *argv: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), *argv],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode:
        raise AssertionError(proc.stderr)
    return proc.stdout.strip()


def make_repo(root: Path, *, policy: dict | None = None) -> Path:
    repo = root / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.name", "Prototype")
    git(repo, "config", "user.email", "prototype@example.invalid")
    (repo / ".gitignore").write_text("node_modules/\n.local/\ndist/\n", encoding="utf-8")
    (repo / "package.json").write_text('{"name":"fixture","private":true}\n', encoding="utf-8")
    (repo / "bun.lock").write_text("lockfileVersion = 1\n", encoding="utf-8")
    if policy is not None:
        (repo / ".ce-artifact-policy.json").write_text(json.dumps(policy) + "\n", encoding="utf-8")
    git(repo, "add", ".gitignore", "package.json", "bun.lock", *( [".ce-artifact-policy.json"] if policy else [] ))
    git(repo, "commit", "-q", "-m", "fixture")
    return repo


def write(path: Path, value: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    path.chmod(mode)


class ArtifactPolicyTests(unittest.TestCase):
    def test_classifies_before_limits_and_precious_override_wins(self) -> None:
        with tempfile.TemporaryDirectory(prefix="artifact-policy-test-") as td:
            policy_doc = {
                "schema": "artifact-policy.repo.v1",
                "precious_roots": ["node_modules/local.db"],
                "regenerable_roots": [],
                "regenerable_divergence": "disclose",
            }
            repo = make_repo(Path(td), policy=policy_doc)
            for index in range(600):
                write(repo / "node_modules" / "pkg" / f"{index:04d}.js", "x")
            write(repo / "node_modules" / "local.db", "precious")
            write(repo / ".local" / "unknown.db", "unknown")

            policy = ArtifactPolicyModule.load(str(repo))
            report = policy.require_eligible("prepare")

            self.assertEqual(report["inventory"]["entries"], 602)
            self.assertEqual(report["classes"]["regenerable"]["entries"], 600)
            self.assertEqual(report["classes"]["precious"]["entries"], 2)
            self.assertEqual(report["classes"]["regenerable"]["roots"][0]["owner"], "bun")

    def test_restores_precious_exactly_and_discloses_all_bulk_divergence(self) -> None:
        with tempfile.TemporaryDirectory(prefix="artifact-policy-test-") as td:
            base = Path(td)
            policy_doc = {
                "schema": "artifact-policy.repo.v1",
                "precious_roots": ["node_modules/local.db"],
                "regenerable_roots": [],
                "regenerable_divergence": "disclose",
            }
            repo = make_repo(base, policy=policy_doc)
            write(repo / ".local" / "settings.db", "precious-settings\n", 0o600)
            os.symlink("settings.db", repo / ".local" / "current")
            write(repo / "node_modules" / "local.db", "precious-inside-bulk\n", 0o640)
            write(repo / "node_modules" / "changed.js", "before-changed\n")
            write(repo / "node_modules" / "deleted.js", "before-deleted\n")

            script = "; ".join([
                "from pathlib import Path",
                "import os",
                "Path('.local/settings.db').write_text('mutated')",
                "Path('.local/settings.db').chmod(0o777)",
                "Path('.local/current').unlink()",
                "os.symlink('elsewhere', '.local/current')",
                "Path('node_modules/local.db').unlink()",
                "Path('node_modules/changed.js').write_text('after-changed')",
                "Path('node_modules/deleted.js').unlink()",
                "Path('node_modules/introduced.js').write_text('introduced')",
            ])
            policy = ArtifactPolicyModule.load(str(repo))
            state = base / "state"
            state.mkdir(mode=0o700)
            receipt = run_authoritative_verification(
                policy,
                [sys.executable, "-c", script],
                str(state),
                "synthetic mutation proof",
            )

            self.assertEqual(receipt["outcome"], "VERIFIED_WITH_REGENERABLE_DIVERGENCE")
            self.assertTrue(receipt["precious_restoration_proven"])
            self.assertEqual((repo / ".local" / "settings.db").read_text(), "precious-settings\n")
            self.assertEqual(stat.S_IMODE(os.lstat(repo / ".local" / "settings.db").st_mode), 0o600)
            self.assertEqual(os.readlink(repo / ".local" / "current"), "settings.db")
            self.assertEqual((repo / "node_modules" / "local.db").read_text(), "precious-inside-bulk\n")
            self.assertEqual(receipt["bulk_changed"]["paths"], ["node_modules/changed.js"])
            self.assertEqual(receipt["bulk_deleted"]["paths"], ["node_modules/deleted.js"])
            self.assertEqual(receipt["bulk_introduced"]["paths"], ["node_modules/introduced.js"])
            self.assertFalse(receipt["bulk_restored"])
            self.assertFalse(receipt["canonical_ignored_state_preserved"])
            self.assertEqual(receipt["repair_actions"][0]["argv"], ["bun", "install", "--frozen-lockfile"])
            self.assertEqual((repo / "node_modules" / "changed.js").read_text(), "after-changed")
            self.assertFalse((repo / "node_modules" / "deleted.js").exists())
            self.assertTrue((repo / "node_modules" / "introduced.js").exists())

    def test_unknown_precious_hardlink_refuses_but_bulk_hardlink_does_not(self) -> None:
        with tempfile.TemporaryDirectory(prefix="artifact-policy-test-") as td:
            repo = make_repo(Path(td))
            write(repo / ".local" / "first", "precious")
            os.link(repo / ".local" / "first", repo / ".local" / "second")
            write(repo / "node_modules" / "first", "bulk")
            os.link(repo / "node_modules" / "first", repo / "node_modules" / "second")

            report = ArtifactPolicyModule.load(str(repo)).inspect("prepare")

            self.assertFalse(report["eligible"])
            self.assertEqual(
                [row["reason"] for row in report["blockers"]],
                ["precious-hardlink-topology-unsupported"],
            )
            self.assertEqual(report["classes"]["regenerable"]["entries"], 2)

    def test_strict_mode_blocks_after_disclosure_without_claiming_restore(self) -> None:
        with tempfile.TemporaryDirectory(prefix="artifact-policy-test-") as td:
            base = Path(td)
            repo = make_repo(base, policy={
                "schema": "artifact-policy.repo.v1",
                "precious_roots": [],
                "regenerable_roots": [],
                "regenerable_divergence": "block",
            })
            write(repo / "node_modules" / "cache.js", "before")
            state = base / "state"
            state.mkdir(mode=0o700)
            receipt = run_authoritative_verification(
                ArtifactPolicyModule.load(str(repo)),
                [sys.executable, "-c", "from pathlib import Path; Path('node_modules/cache.js').write_text('after')"],
                str(state),
            )

            self.assertEqual(receipt["outcome"], "BLOCKED_REGENERABLE_DIVERGENCE")
            self.assertFalse(receipt["bulk_restored"])
            self.assertTrue(receipt["bulk_divergence_detected"])


if __name__ == "__main__":
    unittest.main()
