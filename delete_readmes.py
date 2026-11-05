#!/usr/bin/env python3
"""
Deletes EVERY README.md (at any depth) inside these folders, for every
cat_<name> / note_<name> combination:

  cat_<name>/note_<name>/node_modules/
  cat_<name>/note_<name>/dashboard/node_modules/

Only files named exactly "README.md" are deleted. Nothing else is touched.

Usage:
  python delete_dompurify_readmes.py                 # run from the root folder
  python delete_dompurify_readmes.py /path/to/root   # or pass the root folder
  python delete_dompurify_readmes.py --dry-run       # only show what would be deleted
"""

import argparse
import os
import sys
from pathlib import Path

# Folders to search (relative to the root). * matches any <name>.
NODE_MODULES_PATTERNS = [
    "cat_*/note_*/node_modules",
    "cat_*/note_*/dashboard/node_modules",
]

TARGET_NAME = "README.md"


def find_readmes(root: Path):
    """Yield every README.md found anywhere inside the matched node_modules folders."""
    seen = set()
    for pattern in NODE_MODULES_PATTERNS:
        for nm_dir in sorted(root.glob(pattern)):
            if not nm_dir.is_dir() or nm_dir.is_symlink():
                continue
            # followlinks=False -> symlinked folders are not entered
            for dirpath, _dirnames, filenames in os.walk(nm_dir, followlinks=False):
                if TARGET_NAME in filenames:
                    path = Path(dirpath) / TARGET_NAME
                    if path in seen or path.is_symlink() or not path.is_file():
                        continue
                    seen.add(path)
                    yield path


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete all README.md files inside node_modules folders.")
    parser.add_argument("root", nargs="?", default=".", help="root folder (default: current directory)")
    parser.add_argument("--dry-run", action="store_true", help="list files without deleting them")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        return 1

    found = deleted = failed = 0

    for path in find_readmes(root):
        found += 1
        if args.dry_run:
            print(f"[dry-run] would delete: {path}")
            continue
        try:
            path.unlink()
            deleted += 1
            print(f"deleted: {path}")
        except OSError as e:
            failed += 1
            print(f"failed:  {path} ({e})", file=sys.stderr)

    print(f"\nFound: {found} | Deleted: {deleted} | Failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
