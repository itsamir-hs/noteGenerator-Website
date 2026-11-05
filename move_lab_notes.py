#!/usr/bin/env python3
"""
Moves lab notes into the cat_Labs category folder.

A note is a lab note when the word «آزمایشگاه» or «آز» appears in the COURSE part
of its title. The title is the text after the **مبحث:** tag and follows
"<course> - <subject> - <session>"; only the first part is checked, so a subject
that merely mentions the lab never counts (use --whole-title to check everything). The title is looked up the same way
update-manifest.js does it, so every note format is covered:

  1. **مبحث:** line in note.md next to note.html           (flat layout)
  2. **مبحث:** line in data/input/note.md                  (old layout)
     (or any other .md file in the note folder; every .md is tried until one has the tag)
  3. <strong>مبحث:</strong> line inside the note's HTML    (if there is no usable .md)
  4. <title> of the note's HTML

The folder note_rendererRef is always ignored (see IGNORED_FOLDERS).

Checked folders: the notes inside every cat_* folder (except cat_Labs), then the
note_* folders in the repo root. Supported note folders: note_<name>, note_<name>_NE, with note.html or the
old output/index.html. The whole folder is moved, so everything inside it
(including both the html and the markdown) goes along.

Matching is by whole words, so «آزاد», «آزمون» or «از» never match, while
«آزمایشگاه», «آزمایشگاهی», «آزمایشگاه‌ها» and «آز» (also with a trailing digit,
like «آز۲») do.

Usage (run from the repo root, or pass --root):
  python3 move_lab_notes.py                # dry run: only shows what would move
  python3 move_lab_notes.py --apply        # really move the folders
  python3 move_lab_notes.py --apply --update-manifest   # ...and rebuild notes.json

Options:
  --root-only     skip the cat_* folders and only check note_* folders directly in
                  the repo root (by default both are checked: first the notes inside
                  the cat_* folders, then the ones in the root)
  --whole-title   check the whole title instead of only the course part
  --verbose       also list every note that is NOT a lab note, with the title it was read from
"""
import argparse
import html as htmllib
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

TARGET = "cat_Labs"
IGNORED_FOLDERS = {"note_rendererRef"}  # never read, never moved
NOTE_FILES = ("note.html", "output/index.html")
MARKDOWN_CANDIDATES = ("note.md", "data/input/note.md")

TOPIC_MD = re.compile(r"\*\*\s*مبحث\s*:?\s*\*\*\s*:?[ \t]*(.+)")
TOPIC_HTML = re.compile(
    r"<(?:strong|b)>\s*مبحث\s*:?\s*</(?:strong|b)>\s*:?\s*([\s\S]*?)"
    r"(?:<br\s*/?>|</(?:p|li|h[1-6]|div|td)>)",
    re.I,
)
TITLE_TAG = re.compile(r"<title>([\s\S]*?)</title>", re.I)


# ---------- reading titles ----------

def read_text(path):
    return path.read_text(encoding="utf-8-sig", errors="replace")


def clean_html_text(text):
    text = htmllib.unescape(re.sub(r"<[^>]*>", "", text))
    return re.sub(r"\s+", " ", text).strip()


def find_note_file(folder):
    for candidate in NOTE_FILES:
        path = folder / candidate
        if path.is_file():
            return path
    return None


def find_markdowns(folder):
    """Every markdown file of the note, most likely one first."""
    found = []
    for candidate in MARKDOWN_CANDIDATES:
        path = folder / candidate
        if path.is_file():
            found.append(path)
    for where in (folder, folder / "data" / "input"):
        if where.is_dir():
            for path in sorted(where.glob("*.md")):
                if path.is_file() and path not in found:
                    found.append(path)
    return found


def read_topic(folder, note_file):
    """Returns (title, source) or (None, None)."""
    # every markdown file is tried until one has the **مبحث:** line
    for markdown in find_markdowns(folder):
        match = TOPIC_MD.search(read_text(markdown))
        if match and match.group(1).strip():
            return match.group(1).strip(), markdown.relative_to(folder).as_posix()

    if note_file:
        html_text = read_text(note_file)
        source = note_file.relative_to(folder).as_posix()

        match = TOPIC_HTML.search(html_text)
        if match and clean_html_text(match.group(1)):
            return clean_html_text(match.group(1)), source

        match = TITLE_TAG.search(html_text)
        if match and clean_html_text(match.group(1)):
            return clean_html_text(match.group(1)), source + " <title>"

    return None, None


# ---------- matching ----------

def normalize(text):
    text = unicodedata.normalize("NFC", text)  # "ا" + maddah mark -> "آ"
    text = text.replace("\u064A", "ی").replace("\u0643", "ک")
    text = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", text)  # diacritics, tatweel
    text = re.sub(r"[\u200c\u200e\u200f]", " ", text)  # half-space -> space
    return text


def course_of(title):
    """'<course> - <subject> - <session>' -> '<course>'.
    A title without the " - " separators has no separate course, so it is used whole."""
    parts = re.split(r"\s+[-–—]\s+", title.strip())
    return parts[0].strip() if len(parts) >= 2 and parts[0].strip() else title


def is_lab_title(title, whole_title=False):
    # By default only the course part is checked, so a lab mentioned in the
    # subject of a theory note ("... ارتباط آن با آزمایشگاه ...") does not count
    text = title if whole_title else course_of(title)

    # letters only, so digits never glue to a word ("آز۲" -> "آز")
    for word in re.findall(r"[^\W\d_]+", normalize(text)):
        # "ازمایشگاه" (without the madda) is a common typo, "از" alone never matches
        if word == "آز" or word.startswith(("آزمایشگاه", "ازمایشگاه")):
            return True
    return False


# ---------- moving ----------

def find_note_folders(root, include_categorized):
    entries = [e for e in sorted(root.iterdir()) if e.is_dir() and e.name not in IGNORED_FOLDERS]

    # 1. notes inside the other cat_* folders (cat_Labs itself is the target)
    if include_categorized:
        for entry in entries:
            if entry.name.startswith("cat_") and entry.name != TARGET:
                for sub in sorted(entry.iterdir()):
                    if sub.is_dir() and sub.name not in IGNORED_FOLDERS:
                        yield sub

    # 2. notes directly in the repo root
    for entry in entries:
        if entry.name.startswith("note_"):
            yield entry


def git_tracked(path, root):
    try:
        result = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", path.relative_to(root).as_posix()],
            cwd=root, capture_output=True, text=True,
        )
        return result.returncode == 0
    except OSError:
        return False


def move_folder(src, dest, root):
    dest.parent.mkdir(exist_ok=True)

    # git mv keeps the history; plain move for untracked folders
    if (root / ".git").exists() and git_tracked(src, root):
        try:
            result = subprocess.run(
                ["git", "mv", src.relative_to(root).as_posix(), dest.relative_to(root).as_posix()],
                cwd=root, capture_output=True, text=True,
            )
            if result.returncode == 0:
                return
        except OSError:
            pass

    shutil.move(str(src), str(dest))


def main():
    parser = argparse.ArgumentParser(description="Move lab notes into cat_Labs")
    parser.add_argument("--root", default=Path(__file__).resolve().parent, type=Path,
                        help="repo root (default: the folder of this script)")
    parser.add_argument("--apply", action="store_true",
                        help="actually move the folders (default is a dry run)")
    parser.add_argument("--root-only", action="store_true",
                        help="only check note_* folders in the repo root, skip the cat_* folders")
    parser.add_argument("--whole-title", action="store_true",
                        help="check the whole title instead of only the course part")
    parser.add_argument("--verbose", action="store_true",
                        help="also list the notes that are not lab notes, with their title")
    parser.add_argument("--update-manifest", action="store_true",
                        help="run node update-manifest.js after moving")
    args = parser.parse_args()

    # Persian text in a Windows console (cp1252/cp1256) would crash print()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass

    root = Path(args.root).resolve()
    target = root / TARGET
    moved = skipped = checked = 0

    print(f"Scanning: {root}\n")

    for folder in find_note_folders(root, not args.root_only):
        checked += 1
        shown = folder.relative_to(root).as_posix()
        note_file = find_note_file(folder)

        title, source = read_topic(folder, note_file)
        if not title:
            print(f"?  {shown}: no مبحث title found (no .md with the tag, no usable html), left alone")
            continue
        if not is_lab_title(title, args.whole_title):
            if args.verbose:
                print(f"   {shown}: not a lab note   [{source}]  course: {course_of(title)}   (title: {title})")
            continue

        dest = target / folder.name

        if dest.exists():
            print(f"!  {shown}: {TARGET}/{folder.name} already exists, skipped")
            skipped += 1
            continue

        verb = "moved" if args.apply else "would move"
        print(f"{verb}  {shown}  ->  {TARGET}/{folder.name}    [{source}]  course: {course_of(title)}   (title: {title})")
        if args.apply:
            parent = folder.parent
            move_folder(folder, dest, root)
            if parent != root and parent.exists() and not any(parent.iterdir()):
                parent.rmdir()  # category folder left empty
        moved += 1

    if checked == 0:
        print("No note_* folders found here. Put the script in the repo root next to "
              "index.html, or point it there with --root PATH.")
    else:
        print(f"Checked {checked} note folder(s).")

    if args.apply:
        print(f"\nDone: {moved} note(s) moved to {TARGET}, {skipped} skipped.")
        if args.update_manifest:
            try:
                subprocess.run(["node", "update-manifest.js"], cwd=root, check=True)
            except (OSError, subprocess.CalledProcessError) as error:
                print(f"Could not run update-manifest.js: {error}", file=sys.stderr)
        elif moved:
            print("Now run: node update-manifest.js (or just commit and push).")
    else:
        print(f"\nDry run: {moved} note(s) would move to {TARGET}, {skipped} would be skipped. "
              "Run again with --apply to move them.")


if __name__ == "__main__":
    main()
