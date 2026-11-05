#!/usr/bin/env bash
#
# add-notes.sh - publish new Papyrus notes and refresh every note's renderer.
#
# Steps (all run by default, in this order):
#   1. import    Every archive in new_notes/ (a .zip or an already extracted
#                folder) is read from its first section -- data/input/note.md --
#                to find the course and the title. The cat_* folder is chosen
#                from the course, the note folder is named
#                note_<course short name><class session>, and its contents are
#                built from note_rendererRef + the archive's own data/ folder.
#   2. sync      Every existing note folder gets the reference renderer:
#                everything is replaced with note_rendererRef except data/.
#   3. render    `node src/main.js` is run inside every note folder.
#   4. manifest  `node update-manifest.js` regenerates notes.json.
#
# Per-archive overrides live in new_notes/import-map.tsv:
#   <archive>	<cat folder>	<note folder>
#
# Usage:
#   ./add-notes.sh                     # everything
#   ./add-notes.sh --dry-run           # show the plan, change nothing
#   ./add-notes.sh --import-only       # only bring in new_notes/*
#   ./add-notes.sh --sync-only         # only update existing renderers
#   ./add-notes.sh --render-only       # only re-render
#   ./add-notes.sh --manifest-only     # only rebuild notes.json
#   ./add-notes.sh --force             # overwrite a note folder that exists
#   ./add-notes.sh --keep-zips         # do not delete imported archives
#
# Requirements: bash 4.2+, node, rsync, unzip.
#
# Notes that cannot be named safely are reported and left in new_notes/ (the
# archive is not deleted) so nothing is published under a guessed name. Add a
# row to new_notes/import-map.tsv and run the script again.

set -Eeuo pipefail

SELF=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
ROOT=$SELF
NEW_NOTES="$ROOT/new_notes"
REF="$ROOT/note_rendererRef"
IMPORT_MAP="$NEW_NOTES/import-map.tsv"

DRY_RUN=0
FORCE=0
KEEP_ZIPS=0
DO_IMPORT=1
DO_SYNC=1
DO_RENDER=1
DO_MANIFEST=1
FAILURES=0
SKIPPED=0
IMPORTED=0
SYNCED=0
RENDERED=0

if [[ -t 1 ]]; then
    C_INFO=$'\033[36m' C_OK=$'\033[32m' C_WARN=$'\033[33m'
    C_ERR=$'\033[31m' C_DIM=$'\033[2m' C_OFF=$'\033[0m'
else
    C_INFO='' C_OK='' C_WARN='' C_ERR='' C_DIM='' C_OFF=''
fi

say()  { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s warn%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
err()  { printf '%serr %s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; }
dim()  { printf '%s      %s%s\n' "$C_DIM" "$*" "$C_OFF"; }
die()  { err "$*"; exit 1; }

usage() {
    sed -n '2,34p' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
}

while (($#)); do
    case $1 in
        --dry-run|-n)     DRY_RUN=1 ;;
        --force|-f)       FORCE=1 ;;
        --keep-zips)      KEEP_ZIPS=1 ;;
        --import-only)    DO_SYNC=0; DO_RENDER=0; DO_MANIFEST=0 ;;
        --sync-only)      DO_IMPORT=0; DO_RENDER=0; DO_MANIFEST=0 ;;
        --render-only)    DO_IMPORT=0; DO_SYNC=0; DO_MANIFEST=0 ;;
        --manifest-only)  DO_IMPORT=0; DO_SYNC=0; DO_RENDER=0 ;;
        -h|--help)        usage; exit 0 ;;
        *)                die "unknown option: $1 (try --help)" ;;
    esac
    shift
done

TMP=$(mktemp -d "${TMPDIR:-/tmp}/add-notes.XXXXXX")
trap 'rm -rf -- "$TMP"' EXIT

# ---------------------------------------------------------------- text helpers

# Unifies the Persian/Arabic variants that show up in course names, turns
# ZWNJ into a space and squeezes whitespace, so keyword matching is stable.
norm() {
    printf '%s' "${1-}" | sed \
        -e 's/\xe2\x80\x8c/ /g' \
        -e 's/ي/ی/g' -e 's/ى/ی/g' -e 's/ك/ک/g' \
        -e 's/۰/0/g' -e 's/۱/1/g' -e 's/۲/2/g' -e 's/۳/3/g' -e 's/۴/4/g' \
        -e 's/۵/5/g' -e 's/۶/6/g' -e 's/۷/7/g' -e 's/۸/8/g' -e 's/۹/9/g' \
        -e 's/٠/0/g' -e 's/١/1/g' -e 's/٢/2/g' -e 's/٣/3/g' -e 's/٤/4/g' \
        -e 's/٥/5/g' -e 's/٦/6/g' -e 's/٧/7/g' -e 's/٨/8/g' -e 's/٩/9/g' \
        -e 's/[[:space:]]\+/ /g' \
        -e 's/^ //' -e 's/ $//'
}

# Value of a "**درس:** ..." / "**مبحث:** ..." line in note.md.
meta_value() {
    local file=$1 label=$2
    sed -n -E "s/.*\*\*[[:space:]]*${label}[[:space:]]*:?[[:space:]]*\*\*[[:space:]]*:?[[:space:]]*//p" \
        "$file" | head -n 1 | sed -E 's/[[:space:]]+$//'
}

# First markdown H1 ("# title"), which is the note's first section.
first_h1() {
    sed -n -E 's/^#[[:space:]]+//p' "$1" | head -n 1 | sed -E 's/[[:space:]]+$//'
}

declare -A SESSION_WORDS=(
    [اول]=1 [یکم]=1 [یک]=1
    [دوم]=2 [دو]=2
    [سوم]=3 [سه]=3
    [چهارم]=4 [چهار]=4
    [پنجم]=5 [پنج]=5
    [ششم]=6 [شش]=6
    [هفتم]=7 [هفت]=7
    [هشتم]=8 [هشت]=8
    [نهم]=9 [نه]=9
    [دهم]=10 [ده]=10
    [یازدهم]=11 [یازده]=11
    [دوازدهم]=12 [دوازده]=12
    [سیزدهم]=13 [سیزده]=13
    [چهاردهم]=14 [چهارده]=14
    [پانزدهم]=15 [پانزده]=15
    [شانزدهم]=16 [شانزده]=16
    [هفدهم]=17 [هفده]=17
    [هجدهم]=18 [هجده]=18
    [نوزدهم]=19 [نوزده]=19
    [بیستم]=20 [بیست]=20
    [سی ام]=30 [سی]=30 [سیام]=30
    [چهلم]=40 [چهل]=40
    [پنجاهم]=50 [پنجاه]=50
)

session_token_value() { # "دوم" -> 2, "ویکم" (half-space lost) -> 1
    local token=$1
    if [[ -n ${SESSION_WORDS[$token]:-} ]]; then
        printf '%s' "${SESSION_WORDS[$token]}"
        return 0
    fi
    if [[ $token == و* && -n ${SESSION_WORDS[${token#و}]:-} ]]; then
        printf '%s' "${SESSION_WORDS[${token#و}]}"
        return 0
    fi
    return 1
}

# "جلسه ۳ کلاس" -> 3, "جلسه اول" -> 1, "جلسه بیست و یکم" -> 21, "session 4" -> 4
session_from_text() {
    local -a tokens
    read -r -a tokens <<< "$(norm "$1")"
    local i j k token next value unit
    for i in "${!tokens[@]}"; do
        [[ ${tokens[i]} == *جلسه* || ${tokens[i],,} == session || ${tokens[i],,} == lecture ]] || continue
        for ((j = i + 1; j < ${#tokens[@]}; j++)); do
            token=${tokens[j]}
            if [[ $token =~ ^[0-9]+$ ]]; then
                printf '%s' "$((10#$token))"
                return 0
            fi
            value=$(session_token_value "$token") || continue

            # "بیست و یکم" = 20 + 1
            if ((value >= 20)); then
                for ((k = j + 1; k < ${#tokens[@]}; k++)); do
                    next=${tokens[k]}
                    [[ $next == و ]] && continue
                    if unit=$(session_token_value "$next"); then
                        ((unit >= 1 && unit <= 9)) && { printf '%s' "$((value + unit))"; return 0; }
                    fi
                    break
                done
            fi
            printf '%s' "$value"
            return 0
        done
    done
    return 1
}

# "Immuno3" -> 3, "brucelosisT3" -> 3, "Immuno3 (3)" -> 3
session_from_name() {
    local digits number
    digits=$(norm "$1" | grep -oE '[0-9]+' | tail -n 1 || true)
    [[ -n $digits ]] || return 1
    number=$((10#$digits))
    ((number >= 1 && number <= 99)) || return 1
    printf '%s' "$number"
}

# Course keyword -> existing cat_* folder. Order matters: the first hit wins,
# so specific courses come before the broad "ایمنی" one.
CATEGORY_RULES=(
    "cat_Karamoozy|کارآموزی|کار اموزی|karamooz|بهداشت"
    "cat_Microbiology|میکروب|microb"
    "cat_Hematology|هماتو|خون|hemato|hematolog"
    "cat_Immuno|ایمنی|ایمونو|سرولوژ|immuno|serolog"
)

# Course keyword -> note_<name> prefix.
NAME_RULES=(
    "آزمایشگاه ایمونو|ImmunoLabTheory"
    "آزمایشگاه ایمنی|ImmunoLabTheory"
    "روش های آزمایشگاهی|ImmunoLabTheory"
    "بهداشت|KarAmozi"
    "ایمونو|Immuno"
    "ایمنی|Immuno"
    "هماتو|Hemato"
    "خون|Hemato"
    "میکروب|Microbe"
    "کارآموزی|KarAmozi"
    "کار اموزی|KarAmozi"
)

matches() { # haystack pattern...
    local hay=$1 pattern
    shift
    for pattern in "$@"; do
        [[ $hay == *"$pattern"* ]] && return 0
    done
    return 1
}

resolve_category() { # lowercase haystack -> cat_* folder name
    local hay=$1 rule
    local -a parts
    for rule in "${CATEGORY_RULES[@]}"; do
        IFS='|' read -r -a parts <<< "$rule"
        [[ -d $ROOT/${parts[0]} ]] || continue
        matches "$hay" "${parts[@]:1}" && { printf '%s' "${parts[0]}"; return 0; }
    done
    return 1
}

resolve_prefix() { # lowercase haystack -> note name prefix
    local hay=$1 rule
    for rule in "${NAME_RULES[@]}"; do
        [[ $hay == *"${rule%%|*}"* ]] && { printf '%s' "${rule#*|}"; return 0; }
    done
    return 1
}

# ------------------------------------------------------------- import map

MAP_CAT=''
MAP_NAME=''

lookup_map() { # archive, stem, inner folder
    MAP_CAT=''
    MAP_NAME=''
    [[ -f $IMPORT_MAP ]] || return 1

    local key category name rest candidate
    while IFS=$'\t' read -r key category name rest || [[ -n ${key:-} ]]; do
        [[ -z ${key//[[:space:]]/} ]] && continue
        [[ $key == \#* ]] && continue
        for candidate in "$1" "$2" "$3"; do
            [[ -n $candidate ]] || continue
            if [[ ${candidate,,} == "${key,,}" ]]; then
                MAP_CAT=$(norm "$category")
                MAP_NAME=$(norm "$name")
                return 0
            fi
        done
    done < "$IMPORT_MAP"
    return 1
}

# ------------------------------------------------------------- renderer sync

# Replace everything in <note folder> with note_rendererRef, keeping data/.
sync_renderer() {
    local dest=$1
    if ((DRY_RUN)); then
        dim "would replace ${dest#"$ROOT"/}/ (except data/) with note_rendererRef"
        return 0
    fi
    mkdir -p -- "$dest"
    rsync -a --delete --exclude '/data/' "$REF"/ "$dest"/
}

# ------------------------------------------------------------- new note import

find_renderer_dir() { # $1 = extraction work dir
    local work=$1 renderer md
    renderer=$(find "$work" \
        \( -name node_modules -o -name .git -o -name __MACOSX \) -prune -o \
        -type d -name note_renderer -print -quit)
    if [[ -n $renderer && -f $renderer/src/main.js ]]; then
        printf '%s' "$renderer"
        return 0
    fi

    # Fallback: any folder that looks like the renderer (data/input/note.md + src/main.js)
    md=$(find "$work" \
        \( -name node_modules -o -name .git -o -name __MACOSX \) -prune -o \
        -type f -path '*/data/input/note.md' -print -quit)
    [[ -n $md ]] || return 1
    renderer=$(cd -- "$(dirname -- "$md")/../.." && pwd)
    [[ -f $renderer/src/main.js ]] || return 1
    printf '%s' "$renderer"
}

import_one() { # $1 = zip file or extracted folder
    local item=$1
    local archive='' label stem work renderer md inner
    local course topic h1 hay
    local category name prefix session dest

    if [[ -d $item ]]; then
        work=$item
        label=$(basename -- "$item")
        stem=$label
    else
        archive=$item
        label=$(basename -- "$item")
        stem=${label%.*}
        work=$(mktemp -d "$TMP/note.XXXXXX")
        unzip -q -o -- "$item" -d "$work" || { err "$label: cannot unzip"; return 1; }
    fi

    renderer=$(find_renderer_dir "$work") ||
        { err "$label: no note_renderer (data/input/note.md + src/main.js) inside"; return 1; }
    md="$renderer/data/input/note.md"
    [[ -f $md ]] || { err "$label: note_renderer has no data/input/note.md"; return 1; }

    inner=$(basename -- "$(dirname -- "$renderer")")

    course=$(meta_value "$md" "درس")
    topic=$(meta_value "$md" "مبحث")
    h1=$(first_h1 "$md")
    [[ -n $topic$h1$course ]] || { err "$label: cannot read the title from note.md"; return 1; }

    # The "haystack" used for keyword matching: course first, then title.
    hay=$(norm "$course $h1 $topic")
    hay=${hay,,}

    session=$(session_from_text "$topic") ||
        session=$(session_from_text "$h1") ||
        session=$(session_from_name "$inner") ||
        session=$(session_from_name "$stem") ||
        session=''

    if lookup_map "$label" "$stem" "$inner"; then
        category=$MAP_CAT
        name=$MAP_NAME
        dim "map: $label -> $category/$name"
    else
        category=$(resolve_category "$hay") || {
            err "$label: cannot tell which cat_* folder belongs to \"${course:-$h1}\""
            dim "add a row to new_notes/import-map.tsv: $label<TAB>cat_...<TAB>note_..."
            return 1
        }
        prefix=$(resolve_prefix "$hay") || {
            err "$label: cannot build a folder name for \"${course:-$h1}\""
            dim "add a row to new_notes/import-map.tsv: $label<TAB>${category}<TAB>note_..."
            return 1
        }
        name="note_${prefix}${session}"
    fi

    [[ -d $ROOT/$category ]] || { err "$label: $category does not exist"; return 1; }
    dest="$ROOT/$category/$name"

    if [[ -e $dest ]]; then
        if ((!FORCE)); then
            warn "$label: $category/$name already exists, skipped (use --force to overwrite)"
            SKIPPED=$((SKIPPED + 1))
            return 0
        fi
        warn "$label: replacing existing $category/$name (--force)"
    fi

    printf '  %-32s -> %s/%s\n' "$label" "$category" "$name"
    dim "course: ${course:-?}   session: ${session:-?}"

    if ((!DRY_RUN)); then
        mkdir -p -- "$dest"
        sync_renderer "$dest"
        rsync -a --delete "$renderer/data/" "$dest/data/"
        ok "imported $category/$name"
    else
        dim "would create $category/$name from note_rendererRef + the archive's data/"
    fi

    IMPORTED=$((IMPORTED + 1))

    if ((!DRY_RUN && !KEEP_ZIPS)); then
        if [[ -n $archive ]]; then
            rm -f -- "$archive"
            dim "removed $label"
        else
            rm -rf -- "$item"
            dim "removed new_notes/$(basename -- "$item")"
        fi
    fi
}

do_import() {
    say "importing new notes from new_notes/"

    local -a items=()
    local item
    if [[ -d $NEW_NOTES ]]; then
        while IFS= read -r -d '' item; do items+=("$item"); done \
            < <(find "$NEW_NOTES" -maxdepth 1 -type f -iname '*.zip' -print0 | sort -z)
        while IFS= read -r -d '' item; do items+=("$item"); done \
            < <(find "$NEW_NOTES" -mindepth 1 -maxdepth 1 -type d \
                ! -name processed ! -name '_*' -print0 | sort -z)
    fi

    if ((${#items[@]} == 0)); then
        dim "nothing to import"
        return 0
    fi

    if ! command -v unzip >/dev/null; then
        for item in "${items[@]}"; do
            if [[ $item == *.zip || $item == *.ZIP ]]; then
                die "unzip is required to import .zip archives"
            fi
        done
    fi

    for item in "${items[@]}"; do
        import_one "$item" || FAILURES=$((FAILURES + 1))
    done

    if ((DRY_RUN)); then
        ok "$IMPORTED would be imported, $SKIPPED already exist (dry run)"
    else
        ok "$IMPORTED imported, $SKIPPED skipped"
    fi
}

# ------------------------------------------------------------- sync & render

note_dirs() {
    local dir
    shopt -s nullglob
    for dir in "$ROOT"/note_*/ "$ROOT"/cat_*/note_*/; do
        dir=${dir%/}
        [[ $dir == "$REF" ]] && continue
        [[ -d $dir ]] && printf '%s\0' "$dir"
    done
    shopt -u nullglob
}

do_sync() {
    say "updating the renderer of every note (data/ is kept)"
    local dir
    while IFS= read -r -d '' dir; do
        [[ -d $dir/data ]] || warn "${dir#"$ROOT"/}: no data/ folder"
        if ((DRY_RUN)); then
            dim "would replace ${dir#"$ROOT"/}/ (except data/) with note_rendererRef"
            SYNCED=$((SYNCED + 1))
            continue
        fi
        if rsync -a --delete --exclude '/data/' "$REF"/ "$dir"/; then
            SYNCED=$((SYNCED + 1))
        else
            err "could not update ${dir#"$ROOT"/}"
            FAILURES=$((FAILURES + 1))
        fi
    done < <(note_dirs)
    ok "$SYNCED note renderer(s) updated"
}

do_render() {
    say "rendering every note (node src/main.js)"
    local dir log
    while IFS= read -r -d '' dir; do
        if [[ ! -f $dir/src/main.js ]]; then
            warn "${dir#"$ROOT"/}: no src/main.js, skipped"
            FAILURES=$((FAILURES + 1))
            continue
        fi
        if ((DRY_RUN)); then
            dim "would render ${dir#"$ROOT"/}"
            RENDERED=$((RENDERED + 1))
            continue
        fi

        log="$TMP/render.log"
        if (cd -- "$dir" && node src/main.js) >"$log" 2>&1; then
            if [[ ! -s $dir/output/index.html ]]; then
                err "${dir#"$ROOT"/}: render finished but output/index.html is missing"
                FAILURES=$((FAILURES + 1))
                continue
            fi
            ok "rendered ${dir#"$ROOT"/}"
            RENDERED=$((RENDERED + 1))
        else
            err "render failed: ${dir#"$ROOT"/}"
            sed -E 's/^/      /' "$log" >&2
            FAILURES=$((FAILURES + 1))
        fi
    done < <(note_dirs)

    say "$RENDERED note(s) rendered"
}

do_manifest() {
    say "updating notes.json"
    if ((DRY_RUN)); then
        dim "would run node update-manifest.js"
        return 0
    fi
    if (cd -- "$ROOT" && node update-manifest.js); then
        ok "notes.json updated"
    else
        err "update-manifest.js failed"
        FAILURES=$((FAILURES + 1))
    fi
}

# ---------------------------------------------------------------- main

[[ -d $ROOT ]] || die "cannot find the project root"
[[ -d $REF ]] || die "missing $REF"
[[ -f $REF/src/main.js ]] || die "missing $REF/src/main.js"
[[ -f $REF/templates/note.html ]] || die "missing $REF/templates/note.html"
command -v node >/dev/null || die "node is not installed"
command -v rsync >/dev/null || die "rsync is not installed"

((DRY_RUN)) && say "dry run - nothing will be changed"

((DO_IMPORT)) && do_import
((DO_SYNC)) && do_sync
((DO_RENDER)) && do_render
((DO_MANIFEST)) && do_manifest

echo
if ((FAILURES > 0)); then
    err "finished with $FAILURES problem(s)"
    exit 1
fi
if ((DRY_RUN)); then ok "done (dry run)"; else ok "done"; fi
