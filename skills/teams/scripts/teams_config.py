"""Config loading for the Teams local-store reader.

Real YAML (PyYAML), replacing the prototype's hand-rolled mini-parser.

Resolution order for the config path:
  1. an explicit ``--config`` path
  2. ``$XDG_CONFIG_HOME/teams/teams-reader.yaml``  (user config, default ~/.config)
  3. ``skills/teams/teams-reader.yaml``            (legacy in-skill config, back-compat)
  4. ``skills/teams/teams-reader.example.yaml``    (committed generic fallback)
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent.parent


def _xdg_config_home() -> Path:
    override = os.environ.get("XDG_CONFIG_HOME")
    return Path(override) if override else Path.home() / ".config"


XDG_CONFIG = _xdg_config_home() / "teams" / "teams-reader.yaml"
LEGACY_CONFIG = SKILL_DIR / "teams-reader.yaml"
EXAMPLE_CONFIG = SKILL_DIR / "teams-reader.example.yaml"


class ConfigError(Exception):
    """A config file exists but cannot be used."""


@dataclass
class Config:
    watch: list[str] = field(default_factory=list)
    ticket_pattern: str | None = None
    lookback_hours: int = 24
    max_per_channel: int = 20
    self_mri: str | None = None
    name_gate: list[str] = field(default_factory=list)
    source: Path | None = None


def default_config_path() -> Path | None:
    for candidate in (XDG_CONFIG, LEGACY_CONFIG, EXAMPLE_CONFIG):
        if candidate.is_file():
            return candidate
    return None


def _as_str_list(value, key: str, source: Path) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return list(value)
    raise ConfigError(f"{source}: '{key}' must be a list of strings, got {type(value).__name__}")


def _as_int(value, key: str, source: Path, fallback: int) -> int:
    if value is None:
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ConfigError(f"{source}: '{key}' must be a number, got {value!r}") from None


def load_config(path: Path | None = None) -> Config:
    """Load config, defaulting to the user file then the committed example.

    Returns empty defaults when no config file exists at all — the reader is
    still usable, it just has no watch list.
    """
    path = path or default_config_path()
    if path is None:
        return Config()

    path = Path(path)
    if not path.is_file():
        raise ConfigError(f"config file not found: {path}")

    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        # Surface a readable error, not a stack trace.
        raise ConfigError(f"{path}: invalid YAML — {exc}") from None

    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: expected a mapping at the top level, got {type(raw).__name__}")

    self_block = raw.get("self") or {}
    if self_block and not isinstance(self_block, dict):
        raise ConfigError(f"{path}: 'self' must be a mapping")

    ticket_pattern = raw.get("ticket_pattern")
    if ticket_pattern is not None and not isinstance(ticket_pattern, str):
        raise ConfigError(f"{path}: 'ticket_pattern' must be a string")

    return Config(
        watch=_as_str_list(raw.get("watch"), "watch", path),
        ticket_pattern=ticket_pattern,
        lookback_hours=_as_int(raw.get("lookback_hours"), "lookback_hours", path, 24),
        max_per_channel=_as_int(raw.get("max_per_channel"), "max_per_channel", path, 20),
        self_mri=self_block.get("mri"),
        name_gate=_as_str_list(raw.get("name_gate"), "name_gate", path),
        source=path,
    )
