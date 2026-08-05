#!/usr/bin/env python3
"""Typed ignored-artifact policy prototype for CE Work.

Standard-library only. Git supplies the ignored inventory; this Module owns
classification, precious custody, regenerable manifests, receipts, and repair
actions. It does not own package materialisation or Git integration.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


POLICY_SCHEMA = "artifact-policy.repo.v1"
PREFLIGHT_SCHEMA = "artifact-policy.preflight.v1"
RECEIPT_SCHEMA = "artifact-policy.receipt.v1"
PRECIOUS_MAX_ENTRIES = 512
PRECIOUS_MAX_BYTES = 64 * 1024 * 1024
REGENERABLE_MANIFEST_MAX_ENTRIES = 200_000
DIFF_PATH_SAMPLE = 20
O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


class PolicyError(RuntimeError):
    """A refusal with structured, user-repairable detail."""

    def __init__(self, reason: str, detail: dict | None = None):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail or {}


@dataclass(frozen=True)
class LifecycleOwner:
    owner: str
    repair_argv: tuple[str, ...]
    source: str

    def action(self, root: str) -> dict:
        return {
            "action": "regenerate",
            "root": root,
            "owner": self.owner,
            "argv": list(self.repair_argv),
            "cwd": ".",
            "source": self.source,
        }


@dataclass(frozen=True)
class RegenerableRule:
    root: str
    lifecycle: LifecycleOwner


@dataclass(frozen=True)
class ArtifactEntry:
    path: str
    kind: str
    size: int
    mode: int
    dev: int
    ino: int
    nlink: int
    uid: int
    mtime_ns: int
    ctime_ns: int
    link_target: str | None

    def stat_manifest(self) -> dict:
        return {
            "kind": self.kind,
            "size": self.size,
            "mode": self.mode,
            "dev": self.dev,
            "ino": self.ino,
            "nlink": self.nlink,
            "mtime_ns": self.mtime_ns,
            "ctime_ns": self.ctime_ns,
            "link_target": self.link_target,
        }


@dataclass(frozen=True)
class ClassifiedEntry:
    entry: ArtifactEntry
    artifact_class: str
    rule_root: str | None
    lifecycle: LifecycleOwner | None


@dataclass(frozen=True)
class PreciousRecord:
    path: str
    kind: str
    mode: int
    mtime_ns: int
    size: int
    sha256: str | None
    link_target: str | None
    backup: str | None


def _json_digest(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def _normalise_root(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "\0" in value:
        raise PolicyError(f"{label} must be a non-empty relative path")
    path = value.replace("\\", "/").strip("/")
    if not path or path == "." or path.startswith("../") or "/../" in f"/{path}/":
        raise PolicyError(f"{label} escapes the repository: {value!r}")
    return path


def _path_under(path: str, root: str) -> bool:
    return path == root or path.startswith(root + "/")


def _safe_artifact_path(repo: str, rel: str) -> str:
    root = os.path.abspath(repo)
    if os.path.isabs(rel) or rel in {"", "."}:
        raise PolicyError("ignored inventory returned an unsafe path", {"path": rel})
    target = os.path.abspath(os.path.join(root, rel))
    if os.path.commonpath([root, target]) != root or target == root:
        raise PolicyError("ignored inventory escaped the repository", {"path": rel})
    return target


def _validate_parents(repo: str, rel: str) -> None:
    root = os.path.abspath(repo)
    parts = Path(rel).parts[:-1]
    current = root
    for part in parts:
        current = os.path.join(current, part)
        try:
            entry = os.lstat(current)
        except OSError as exc:
            raise PolicyError("ignored inventory parent cannot be inspected", {"path": rel, "parent": current, "error": str(exc)}) from exc
        if stat.S_ISLNK(entry.st_mode) or not stat.S_ISDIR(entry.st_mode):
            raise PolicyError("ignored inventory has a non-directory parent", {"path": rel, "parent": os.path.relpath(current, root)})


def _git_ignored_paths(repo: str) -> list[str]:
    proc = subprocess.run(
        ["git", "-C", repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        raise PolicyError("Git ignored inventory failed", {"stderr": proc.stderr.decode("utf-8", "replace").strip()})
    return sorted(filter(None, proc.stdout.decode("utf-8", "surrogateescape").split("\0")))


def inventory_ignored(repo: str) -> list[ArtifactEntry]:
    """Inventory without following final symlinks.

    Classification happens immediately after this representation-only pass;
    caps, ownership rules, link rules, and custody type rules happen later.
    """

    rows: list[ArtifactEntry] = []
    for rel in _git_ignored_paths(repo):
        _validate_parents(repo, rel)
        target = _safe_artifact_path(repo, rel)
        try:
            observed = os.lstat(target)
        except OSError as exc:
            raise PolicyError("ignored inventory changed during inspection", {"path": rel, "error": str(exc)}) from exc
        if stat.S_ISLNK(observed.st_mode):
            kind = "symlink"
            link_target = os.readlink(target)
            size = 0
        elif stat.S_ISREG(observed.st_mode):
            kind = "regular"
            link_target = None
            size = observed.st_size
        elif stat.S_ISDIR(observed.st_mode):
            kind = "directory"
            link_target = None
            size = 0
        else:
            kind = "other"
            link_target = None
            size = 0
        rows.append(ArtifactEntry(
            path=rel,
            kind=kind,
            size=size,
            mode=stat.S_IMODE(observed.st_mode),
            dev=observed.st_dev,
            ino=observed.st_ino,
            nlink=observed.st_nlink,
            uid=observed.st_uid,
            mtime_ns=observed.st_mtime_ns,
            ctime_ns=observed.st_ctime_ns,
            link_target=link_target,
        ))
    return rows


def _package_manager_owner(repo: str) -> LifecycleOwner:
    candidates = [
        ("bun.lock", "bun", ("bun", "install", "--frozen-lockfile")),
        ("bun.lockb", "bun", ("bun", "install", "--frozen-lockfile")),
        ("pnpm-lock.yaml", "pnpm", ("pnpm", "install", "--frozen-lockfile")),
        ("yarn.lock", "yarn", ("yarn", "install", "--immutable")),
        ("package-lock.json", "npm", ("npm", "ci")),
    ]
    for filename, owner, argv in candidates:
        if os.path.isfile(os.path.join(repo, filename)):
            return LifecycleOwner(owner=owner, repair_argv=argv, source=f"built-in:{filename}")
    return LifecycleOwner(
        owner="package-manager",
        repair_argv=("<package-manager>", "install", "<locked-mode>"),
        source="built-in:no-lockfile-detected",
    )


class ArtifactPolicyModule:
    """Artifact Policy Module: classification and lifecycle policy owner."""

    def __init__(
        self,
        repo: str,
        precious_roots: Iterable[str] = (),
        regenerable_rules: Iterable[RegenerableRule] = (),
        divergence_mode: str = "disclose",
        override_source: str | None = None,
    ):
        self.repo = os.path.abspath(repo)
        self.precious_roots = tuple(sorted(set(precious_roots)))
        self.regenerable_rules = tuple(sorted(regenerable_rules, key=lambda rule: (-len(rule.root), rule.root)))
        self.divergence_mode = divergence_mode
        self.override_source = override_source
        if divergence_mode not in {"disclose", "block"}:
            raise PolicyError("regenerable_divergence must be disclose or block")

    @classmethod
    def load(cls, repo: str, policy_path: str | None = None) -> "ArtifactPolicyModule":
        repo = os.path.abspath(repo)
        precious: list[str] = []
        rules = [RegenerableRule("node_modules", _package_manager_owner(repo))]
        divergence_mode = "disclose"
        selected = policy_path
        default = os.path.join(repo, ".ce-artifact-policy.json")
        if selected is None and os.path.isfile(default):
            selected = default
        if selected:
            try:
                document = json.loads(Path(selected).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise PolicyError("repository artifact policy cannot be read", {"path": selected, "error": str(exc)}) from exc
            if document.get("schema") != POLICY_SCHEMA:
                raise PolicyError("repository artifact policy schema is unsupported", {"expected": POLICY_SCHEMA})
            raw_precious = document.get("precious_roots", [])
            raw_regenerable = document.get("regenerable_roots", [])
            if not isinstance(raw_precious, list) or not isinstance(raw_regenerable, list):
                raise PolicyError("artifact policy roots must be arrays")
            precious.extend(_normalise_root(value, "precious root") for value in raw_precious)
            for row in raw_regenerable:
                if not isinstance(row, dict):
                    raise PolicyError("regenerable root entries must be objects")
                root = _normalise_root(row.get("root"), "regenerable root")
                owner = row.get("owner")
                argv = row.get("repair_argv")
                if not isinstance(owner, str) or not owner or not isinstance(argv, list) or not argv or any(not isinstance(v, str) or not v for v in argv):
                    raise PolicyError("regenerable root requires owner and non-empty repair_argv", {"root": root})
                rules.append(RegenerableRule(root, LifecycleOwner(owner, tuple(argv), "repo-override")))
            divergence_mode = document.get("regenerable_divergence", "disclose")
        return cls(repo, precious, rules, divergence_mode, selected)

    def policy_document(self) -> dict:
        return {
            "schema": POLICY_SCHEMA,
            "built_in": ["node_modules"],
            "precious_roots": list(self.precious_roots),
            "regenerable_roots": [
                {
                    "root": rule.root,
                    "owner": rule.lifecycle.owner,
                    "repair_argv": list(rule.lifecycle.repair_argv),
                    "source": rule.lifecycle.source,
                }
                for rule in self.regenerable_rules
            ],
            "regenerable_divergence": self.divergence_mode,
            "override_source": self.override_source,
        }

    @property
    def digest(self) -> str:
        return _json_digest(self.policy_document())

    def classify(self, entries: Iterable[ArtifactEntry]) -> list[ClassifiedEntry]:
        classified: list[ClassifiedEntry] = []
        for entry in entries:
            # Precious always wins, even inside a built-in regenerable root.
            precious_root = next((root for root in self.precious_roots if _path_under(entry.path, root)), None)
            if precious_root is not None:
                classified.append(ClassifiedEntry(entry, "precious", precious_root, None))
                continue
            rule = next((candidate for candidate in self.regenerable_rules if _path_under(entry.path, candidate.root)), None)
            if rule is not None:
                classified.append(ClassifiedEntry(entry, "regenerable", rule.root, rule.lifecycle))
            else:
                classified.append(ClassifiedEntry(entry, "precious", None, None))
        return classified

    def inspect(self, phase: str) -> dict:
        entries = inventory_ignored(self.repo)
        classified = self.classify(entries)
        precious = [row for row in classified if row.artifact_class == "precious"]
        regenerable = [row for row in classified if row.artifact_class == "regenerable"]
        blockers = self._enforce_after_classification(precious, regenerable)
        report = {
            "schema": PREFLIGHT_SCHEMA,
            "phase": phase,
            "eligible": not blockers,
            "policy_digest": self.digest,
            "policy": self.policy_document(),
            "inventory": _inventory_summary(entries),
            "classes": {
                "precious": _class_summary(precious),
                "regenerable": _class_summary(regenerable),
            },
            "limits": {
                "precious_max_entries": PRECIOUS_MAX_ENTRIES,
                "precious_max_bytes": PRECIOUS_MAX_BYTES,
                "regenerable_manifest_max_entries": REGENERABLE_MANIFEST_MAX_ENTRIES,
            },
            "blockers": blockers,
            "repair_actions": [
                {
                    "action": "review-artifact-classification-or-reduce-precious-state",
                    "reason": blocker["reason"],
                    "paths": blocker.get("paths", []),
                }
                for blocker in blockers
            ],
        }
        return report

    def require_eligible(self, phase: str) -> dict:
        report = self.inspect(phase)
        if not report["eligible"]:
            raise PolicyError("artifact policy preflight refused dispatch or verification", report)
        return report

    def _enforce_after_classification(
        self,
        precious: list[ClassifiedEntry],
        regenerable: list[ClassifiedEntry],
    ) -> list[dict]:
        blockers: list[dict] = []
        precious_bytes = sum(row.entry.size for row in precious if row.entry.kind == "regular")
        if len(precious) > PRECIOUS_MAX_ENTRIES:
            blockers.append({"reason": "precious-entry-limit", "actual": len(precious), "limit": PRECIOUS_MAX_ENTRIES})
        if precious_bytes > PRECIOUS_MAX_BYTES:
            blockers.append({"reason": "precious-byte-limit", "actual": precious_bytes, "limit": PRECIOUS_MAX_BYTES})
        unsupported = [row.entry.path for row in precious if row.entry.kind not in {"regular", "symlink"}]
        if unsupported:
            blockers.append({"reason": "precious-entry-type-unsupported", "paths": unsupported[:DIFF_PATH_SAMPLE]})
        linked = [row.entry.path for row in precious if row.entry.kind == "regular" and row.entry.nlink != 1]
        if linked:
            blockers.append({"reason": "precious-hardlink-topology-unsupported", "paths": linked[:DIFF_PATH_SAMPLE]})
        uid_getter = getattr(os, "geteuid", None) or getattr(os, "getuid", None)
        if uid_getter is not None:
            effective_uid = uid_getter()
            foreign = [row.entry.path for row in precious if row.entry.uid != effective_uid]
            if foreign:
                blockers.append({"reason": "precious-ownership-mismatch", "paths": foreign[:DIFF_PATH_SAMPLE]})
        if len(regenerable) > REGENERABLE_MANIFEST_MAX_ENTRIES:
            blockers.append({
                "reason": "regenerable-manifest-entry-limit",
                "actual": len(regenerable),
                "limit": REGENERABLE_MANIFEST_MAX_ENTRIES,
            })
        return blockers


def _inventory_summary(entries: Iterable[ArtifactEntry]) -> dict:
    entries = list(entries)
    types = {kind: 0 for kind in ("regular", "symlink", "directory", "other")}
    for entry in entries:
        types[entry.kind] += 1
    return {
        "entries": len(entries),
        "regular_bytes": sum(entry.size for entry in entries if entry.kind == "regular"),
        "types": types,
    }


def _class_summary(entries: Iterable[ClassifiedEntry]) -> dict:
    entries = list(entries)
    summary = _inventory_summary(row.entry for row in entries)
    roots: dict[str, dict] = {}
    for row in entries:
        if row.artifact_class != "regenerable":
            continue
        root = row.rule_root or "<unknown>"
        current = roots.setdefault(root, {
            "root": root,
            "entries": 0,
            "regular_bytes": 0,
            "owner": row.lifecycle.owner if row.lifecycle else None,
            "repair_argv": list(row.lifecycle.repair_argv) if row.lifecycle else [],
        })
        current["entries"] += 1
        current["regular_bytes"] += row.entry.size if row.entry.kind == "regular" else 0
    summary["roots"] = [roots[key] for key in sorted(roots)]
    return summary


class ExactPreciousCustody:
    """Content-bearing custody for the declared precious contract.

    Exact contract: starting path set, final entry type, regular-file bytes,
    regular-file mode and mtime, symlink payload, and precious parent modes.
    Inodes and ctime are intentionally excluded because replacement changes them.
    """

    CONTRACT = [
        "starting path set",
        "entry type",
        "regular-file bytes",
        "regular-file mode",
        "regular-file mtime_ns",
        "symlink payload",
        "precious parent-directory mode",
    ]

    def __init__(self, repo: str, root: str, records: dict[str, PreciousRecord], parent_modes: dict[str, int]):
        self.repo = repo
        self.root = root
        self.records = records
        self.parent_modes = parent_modes

    @classmethod
    def capture(cls, repo: str, precious: list[ClassifiedEntry], state_parent: str) -> "ExactPreciousCustody":
        root = tempfile.mkdtemp(prefix="artifact-policy-custody-", dir=state_parent)
        records: dict[str, PreciousRecord] = {}
        parent_modes: dict[str, int] = {}
        try:
            for index, classified in enumerate(sorted(precious, key=lambda row: row.entry.path)):
                entry = classified.entry
                target = _safe_artifact_path(repo, entry.path)
                _validate_parents(repo, entry.path)
                parent = os.path.dirname(target)
                while parent != os.path.abspath(repo):
                    rel_parent = os.path.relpath(parent, repo)
                    observed_parent = os.lstat(parent)
                    if stat.S_ISLNK(observed_parent.st_mode) or not stat.S_ISDIR(observed_parent.st_mode):
                        raise PolicyError("precious custody parent changed during capture", {"path": entry.path, "parent": rel_parent})
                    parent_modes[rel_parent] = stat.S_IMODE(observed_parent.st_mode)
                    parent = os.path.dirname(parent)
                if entry.kind == "regular":
                    backup = os.path.join(root, f"{index:08d}.bin")
                    digest = _copy_regular_exact(target, backup, entry)
                    records[entry.path] = PreciousRecord(
                        path=entry.path,
                        kind="regular",
                        mode=entry.mode,
                        mtime_ns=entry.mtime_ns,
                        size=entry.size,
                        sha256=digest,
                        link_target=None,
                        backup=backup,
                    )
                elif entry.kind == "symlink":
                    payload = os.readlink(target)
                    if payload != entry.link_target:
                        raise PolicyError("precious symlink changed during capture", {"path": entry.path})
                    records[entry.path] = PreciousRecord(
                        path=entry.path,
                        kind="symlink",
                        mode=entry.mode,
                        mtime_ns=entry.mtime_ns,
                        size=0,
                        sha256=None,
                        link_target=payload,
                        backup=None,
                    )
                else:
                    raise PolicyError("unsupported precious entry reached custody", {"path": entry.path, "kind": entry.kind})
        except Exception:
            shutil.rmtree(root, ignore_errors=True)
            raise
        return cls(os.path.abspath(repo), root, records, parent_modes)

    def restore(self) -> tuple[list[str], bool, list[str]]:
        restored: list[str] = []
        errors: list[str] = []
        # Re-establish and validate parents before writing any entry. Never let
        # a verification-created parent symlink redirect restoration outside
        # the repository.
        for rel, mode in sorted(self.parent_modes.items(), key=lambda row: (row[0].count("/"), row[0])):
            target = _safe_artifact_path(self.repo, rel)
            try:
                observed = os.lstat(target)
            except FileNotFoundError:
                try:
                    os.mkdir(target, mode)
                    restored.append(rel + "/")
                except OSError as exc:
                    errors.append(f"{rel}: {exc}")
                continue
            except OSError as exc:
                errors.append(f"{rel}: {exc}")
                continue
            if stat.S_ISLNK(observed.st_mode) or not stat.S_ISDIR(observed.st_mode):
                errors.append(f"{rel}: precious parent is obstructed")
                continue
            if stat.S_IMODE(observed.st_mode) != mode:
                try:
                    os.chmod(target, mode, follow_symlinks=False)
                    restored.append(rel + "/")
                except OSError as exc:
                    errors.append(f"{rel}: {exc}")
        for rel, record in sorted(self.records.items()):
            target = _safe_artifact_path(self.repo, rel)
            try:
                _validate_parents(self.repo, rel)
                if _precious_matches(target, record):
                    continue
                if record.kind == "regular":
                    temporary = os.path.join(os.path.dirname(target), f".artifact-policy-restore-{os.getpid()}-{len(restored)}")
                    try:
                        shutil.copyfile(record.backup or "", temporary, follow_symlinks=False)
                        os.chmod(temporary, record.mode, follow_symlinks=False)
                        os.utime(temporary, ns=(record.mtime_ns, record.mtime_ns), follow_symlinks=False)
                        os.replace(temporary, target)
                    finally:
                        if os.path.lexists(temporary):
                            os.unlink(temporary)
                else:
                    temporary = os.path.join(os.path.dirname(target), f".artifact-policy-link-{os.getpid()}-{len(restored)}")
                    try:
                        os.symlink(record.link_target or "", temporary)
                        os.replace(temporary, target)
                    finally:
                        if os.path.lexists(temporary):
                            os.unlink(temporary)
                restored.append(rel)
            except (OSError, PolicyError) as exc:
                errors.append(f"{rel}: {exc}")
        proven = not errors and all(
            _precious_matches(_safe_artifact_path(self.repo, rel), record)
            for rel, record in self.records.items()
        ) and all(
            _directory_mode_matches(_safe_artifact_path(self.repo, rel), mode)
            for rel, mode in self.parent_modes.items()
        )
        return sorted(set(restored)), proven, errors

    def digest(self) -> str:
        return precious_state_digest(self.repo, self.records)

    def close(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


def _copy_regular_exact(source: str, backup: str, expected: ArtifactEntry) -> str:
    source_fd = os.open(source, os.O_RDONLY | O_NOFOLLOW)
    target_fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | O_NOFOLLOW, 0o600)
    digest = hashlib.sha256()
    try:
        opened = os.fstat(source_fd)
        if (opened.st_dev, opened.st_ino, opened.st_size) != (expected.dev, expected.ino, expected.size):
            raise PolicyError("precious artifact changed before custody", {"path": expected.path})
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                view = view[os.write(target_fd, view):]
        finished = os.fstat(source_fd)
        if (finished.st_size, finished.st_mtime_ns, finished.st_ctime_ns) != (expected.size, expected.mtime_ns, expected.ctime_ns):
            raise PolicyError("precious artifact changed during custody", {"path": expected.path})
    finally:
        os.close(source_fd)
        os.close(target_fd)
    return digest.hexdigest()


def _hash_regular(path: str) -> str:
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | O_NOFOLLOW)
    try:
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    finally:
        os.close(fd)
    return digest.hexdigest()


def _precious_matches(path: str, record: PreciousRecord) -> bool:
    try:
        observed = os.lstat(path)
    except OSError:
        return False
    if record.kind == "symlink":
        return stat.S_ISLNK(observed.st_mode) and os.readlink(path) == record.link_target
    return (
        stat.S_ISREG(observed.st_mode)
        and not stat.S_ISLNK(observed.st_mode)
        and observed.st_size == record.size
        and stat.S_IMODE(observed.st_mode) == record.mode
        and observed.st_mtime_ns == record.mtime_ns
        and _hash_regular(path) == record.sha256
    )


def _directory_mode_matches(path: str, mode: int) -> bool:
    try:
        observed = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISDIR(observed.st_mode) and not stat.S_ISLNK(observed.st_mode) and stat.S_IMODE(observed.st_mode) == mode


def precious_state_digest(repo: str, records: dict[str, PreciousRecord]) -> str:
    rows: list[dict] = []
    for rel, record in sorted(records.items()):
        path = _safe_artifact_path(repo, rel)
        try:
            _validate_parents(repo, rel)
            matches = _precious_matches(path, record)
        except PolicyError:
            matches = False
        if not matches:
            rows.append({"path": rel, "matches": False})
        elif record.kind == "regular":
            observed = os.lstat(path)
            rows.append({
                "path": rel,
                "kind": "regular",
                "mode": stat.S_IMODE(observed.st_mode),
                "mtime_ns": observed.st_mtime_ns,
                "size": observed.st_size,
                "sha256": _hash_regular(path),
            })
        else:
            rows.append({"path": rel, "kind": "symlink", "link_target": os.readlink(path)})
    return _json_digest(rows)


def _manifest(classified: Iterable[ClassifiedEntry]) -> tuple[dict[str, dict], dict[str, RegenerableRule]]:
    rows: dict[str, dict] = {}
    rules: dict[str, RegenerableRule] = {}
    for row in classified:
        if row.artifact_class != "regenerable" or row.lifecycle is None or row.rule_root is None:
            continue
        rows[row.entry.path] = row.entry.stat_manifest()
        rules[row.rule_root] = RegenerableRule(row.rule_root, row.lifecycle)
    return rows, rules


def _diff_summary(paths: Iterable[str]) -> dict:
    ordered = sorted(paths)
    return {
        "count": len(ordered),
        "paths": ordered[:DIFF_PATH_SAMPLE],
        "truncated": len(ordered) > DIFF_PATH_SAMPLE,
    }


def _repair_actions(
    changed: set[str],
    deleted: set[str],
    introduced: set[str],
    before_rules: dict[str, RegenerableRule],
    after_rules: dict[str, RegenerableRule],
) -> list[dict]:
    affected = changed | deleted | introduced
    available = {**before_rules, **after_rules}
    roots = sorted(
        root for root in available
        if any(_path_under(path, root) for path in affected)
    )
    return [available[root].lifecycle.action(root) for root in roots]


def _require_private_state_parent(path: str) -> None:
    os.makedirs(path, mode=0o700, exist_ok=True)
    observed = os.lstat(path)
    uid_getter = getattr(os, "geteuid", None) or getattr(os, "getuid", None)
    if stat.S_ISLNK(observed.st_mode) or not stat.S_ISDIR(observed.st_mode):
        raise PolicyError("custody state parent must be a real directory", {"path": path})
    if uid_getter is not None and observed.st_uid != uid_getter():
        raise PolicyError("custody state parent ownership mismatch", {"path": path})
    if stat.S_IMODE(observed.st_mode) != 0o700:
        raise PolicyError("custody state parent must have mode 0700", {"path": path})


def run_authoritative_verification(
    policy: ArtifactPolicyModule,
    argv: Sequence[str],
    state_parent: str,
    summary: str = "",
) -> dict:
    """Run verification with exact precious custody and detect-only bulk state."""

    if not argv or any(not isinstance(value, str) or not value or "\0" in value for value in argv):
        raise PolicyError("verification argv must be a non-empty direct argv")
    preflight = policy.require_eligible("authoritative-verification")
    before_entries = inventory_ignored(policy.repo)
    before_classified = policy.classify(before_entries)
    precious_before = [row for row in before_classified if row.artifact_class == "precious"]
    before_precious_paths = {row.entry.path for row in precious_before}
    before_bulk, before_rules = _manifest(before_classified)
    _require_private_state_parent(state_parent)
    custody = ExactPreciousCustody.capture(policy.repo, precious_before, state_parent)
    starting_precious_digest = custody.digest()
    try:
        try:
            proc = subprocess.run(list(argv), cwd=policy.repo, stdin=subprocess.DEVNULL, check=False)
            verification_exit = proc.returncode
            launch_error = None
        except OSError as exc:
            verification_exit = 127
            launch_error = str(exc)

        observation_error = None
        try:
            after_entries = inventory_ignored(policy.repo)
            after_classified = policy.classify(after_entries)
            after_precious_paths = {row.entry.path for row in after_classified if row.artifact_class == "precious"}
            introduced_precious = sorted(after_precious_paths - before_precious_paths)
            after_bulk, after_rules = _manifest(after_classified)
            before_paths = set(before_bulk)
            after_paths = set(after_bulk)
            bulk_changed = {path for path in before_paths & after_paths if before_bulk[path] != after_bulk[path]}
            bulk_deleted = before_paths - after_paths
            bulk_introduced = after_paths - before_paths
        except PolicyError as exc:
            # Custody restoration still runs. An unreadable post-state never
            # turns into an optimistic preservation claim.
            observation_error = {"reason": exc.reason, "detail": exc.detail}
            introduced_precious = []
            after_rules = {}
            bulk_changed = set()
            bulk_deleted = set()
            bulk_introduced = set()
        restored_paths, precious_proven, restoration_errors = custody.restore()
        final_precious_digest = custody.digest()
        precise_restoration = precious_proven and starting_precious_digest == final_precious_digest and not introduced_precious
        actions = _repair_actions(
            bulk_changed,
            bulk_deleted,
            bulk_introduced,
            before_rules,
            after_rules,
        )
        if introduced_precious:
            actions.append({
                "action": "inspect-preserved-introduced-precious-state",
                "paths": introduced_precious[:DIFF_PATH_SAMPLE],
                "reason": "not present at transaction start; controller refused destructive cleanup",
            })
        if observation_error:
            actions.append({
                "action": "inspect-artifact-state-before-retry",
                "reason": "post-verification inventory was not trustworthy",
            })
        bulk_diverged = bool(bulk_changed or bulk_deleted or bulk_introduced)
        if not precise_restoration:
            outcome = "BLOCKED_PRECIOUS_RESTORATION"
        elif observation_error:
            outcome = "BLOCKED_ARTIFACT_OBSERVATION"
        elif verification_exit != 0:
            outcome = "VERIFICATION_FAILED"
        elif bulk_diverged and policy.divergence_mode == "block":
            outcome = "BLOCKED_REGENERABLE_DIVERGENCE"
        elif bulk_diverged:
            outcome = "VERIFIED_WITH_REGENERABLE_DIVERGENCE"
        else:
            outcome = "VERIFIED"
        receipt = {
            "schema": RECEIPT_SCHEMA,
            "outcome": outcome,
            "summary": summary,
            "policy_digest": policy.digest,
            "ignored_state_policy": "typed-artifacts-v1",
            "verification": {
                "argv": list(argv),
                "exit": verification_exit,
                "launch_error": launch_error,
            },
            "preflight": {
                "inventory": preflight["inventory"],
                "classes": preflight["classes"],
            },
            "precious_contract": list(ExactPreciousCustody.CONTRACT),
            "precious_captured": len(precious_before),
            "precious_restored": restored_paths,
            "precious_introduced": introduced_precious,
            "precious_restoration_proven": precise_restoration,
            "precious_start_digest": starting_precious_digest,
            "precious_final_digest": final_precious_digest,
            "precious_restoration_errors": restoration_errors,
            "bulk_changed": _diff_summary(bulk_changed),
            "bulk_deleted": _diff_summary(bulk_deleted),
            "bulk_introduced": _diff_summary(bulk_introduced),
            "bulk_divergence_detected": bulk_diverged,
            "bulk_observation_complete": observation_error is None,
            "artifact_observation_error": observation_error,
            "bulk_restored": False,
            "canonical_ignored_state_preserved": precise_restoration and not bulk_diverged and observation_error is None,
            "repair_actions": actions,
        }
        receipt["receipt_sha256"] = _json_digest(receipt)
        return receipt
    finally:
        custody.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect or exercise typed ignored-artifact policy")
    sub = parser.add_subparsers(dest="command", required=True)
    inspect_parser = sub.add_parser("inspect", help="read-only dispatch or verification eligibility")
    inspect_parser.add_argument("--repo", required=True)
    inspect_parser.add_argument("--policy")
    inspect_parser.add_argument("--phase", default="prepare")
    verify_parser = sub.add_parser("verify", help="run authoritative verification through artifact custody")
    verify_parser.add_argument("--repo", required=True)
    verify_parser.add_argument("--policy")
    verify_parser.add_argument("--state-parent", required=True)
    verify_parser.add_argument("--summary", default="")
    verify_parser.add_argument("verification_argv", nargs=argparse.REMAINDER)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        policy = ArtifactPolicyModule.load(args.repo, args.policy)
        if args.command == "inspect":
            result = policy.inspect(args.phase)
            print(json.dumps(result, indent=2, sort_keys=True))
            return 0 if result["eligible"] else 2
        command = list(args.verification_argv)
        if command and command[0] == "--":
            command.pop(0)
        receipt = run_authoritative_verification(policy, command, args.state_parent, args.summary)
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0 if receipt["outcome"] in {"VERIFIED", "VERIFIED_WITH_REGENERABLE_DIVERGENCE"} else 3
    except PolicyError as exc:
        print(json.dumps({"error": exc.reason, "detail": exc.detail}, indent=2, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
