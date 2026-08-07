"""Load-bearing dependency probe.

Imports the full chain the reader needs. Used by bootstrap.sh for BOTH the
idempotency fast-path and the post-install verification, so a partial install
cannot pass the fast-path check.

Exits 0 when the environment is complete, non-zero otherwise.
"""

from __future__ import annotations

import sys


def main() -> int:
    try:
        # The decoder that does the actual work.
        from ccl_chromium_reader.ccl_chromium_indexeddb import WrappedIndexDB  # noqa: F401

        # Compression backends LevelDB blocks are stored with. These are the
        # pieces that silently go missing in a partial install.
        import ccl_simplesnappy  # noqa: F401
        import zstd  # noqa: F401

        # Config parsing.
        import yaml  # noqa: F401
    except ImportError as exc:
        print(f"dependency check FAILED: {exc}", file=sys.stderr)
        return 1

    # Guard against the broken PyPI look-alike shadowing the real package.
    import ccl_chromium_reader

    if "ccl_chromium_reader" not in (ccl_chromium_reader.__file__ or ""):
        print(
            "dependency check FAILED: ccl_chromium_reader resolved from an "
            f"unexpected location: {ccl_chromium_reader.__file__}",
            file=sys.stderr,
        )
        return 1

    print("dependency check OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
