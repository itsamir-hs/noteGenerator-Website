#!/usr/bin/env python3
"""
Deletes ONLY these files (for every cat_<name> / note_<name> combination):

  cat_<name>/note_<name>/node_modules/dompurify/README.md
  cat_<name>/note_<name>/dashboard/node_modules/dompurify/README.md

Usage:
  python delete_dompurify_readmes.py                 # run from the root folder
  python delete_dompurify_readmes.py /path/to/root   # or pass the root folder
  python delete_dompurify_readmes.py --dry-run       # only show what would be deleted
"""

import argparse
import sys
from pathlib import Path

# Relative patterns, starting from the root folder.
# The * wildcards match any <name> in cat_<name> and note_<name>.
PATTERNS = [
    "cat_*/note_*/node_modules/dompurify/README.md",
    "cat_*/note_*/dashboard/node_modules/dompurify/README.md",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete dompurify README.md files.")
    parser.add_argument("root", nargs="?", default=".", help="root folder (default: current directory)")
    parser.add_argument("--dry-run", action="store_true", help="list files without deleting them")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"Error: {root} is not a directory", file=sys.stderr)
        return 1

    found = deleted = failed = 0

    for pattern in PATTERNS:
        for path in sorted(root.glob(pattern)):
            # Safety checks: must be a real file (not a dir/symlink) named exactly README.md
            if path.name != "README.md" or path.is_symlink() or not path.is_file():
                continue

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
