#!/usr/bin/env node
/*
 * Regenerates notes.json.
 *
 * Supported layout:
 *   note_<name>/note.html                 -> note without a category folder
 *   cat_<category>/<any folder>/note.html -> note inside a category folder
 *
 * Old layout (still supported): the note file is <note folder>/output/index.html
 * instead of <note folder>/note.html. If a folder has both, note.html wins.
 *
 * Title lookup (first hit wins):
 *   1. "**مبحث:** <title>" in <note folder>/note.md, or the old
 *      <note folder>/data/input/note.md (or any single .md in the folder)
 *   2. "<strong>مبحث:</strong> <title>" inside note.html
 *   3. <title> of note.html
 *   4. the folder name
 *
 * Titles follow the standard "<course name> - <subject> - <class session>".
 *   - course  -> automatic category (unless the note sits in a cat_ folder)
 *   - session -> used for "sort by session" (jalase avval / dovom / 3 ...)
 *
 * "added" is the moment the generator first saw the note. It is stored in
 * notes.json and carried over on every later run (matched by the note's
 * folder name, so moving a note into a cat_ folder keeps its date), which
 * means editing or re-generating a note never makes it "new" again.
 * On the very first run (no notes.json, or one from an older version) every
 * existing note is treated as already known: its date comes from git/the
 * file, capped to 2 days ago so nothing gets the "new" tag by accident.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = __dirname;
// Both layouts are supported; the first file that exists wins
const noteFileCandidates = ["note.html", "output/index.html"];
const rawNotes = [];

/* ---------- text helpers ---------- */

function decodeEntities(str) {
    return str
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function cleanTitle(str) {
    return decodeEntities(str.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

// Unifies Arabic/Persian letter + digit variants, drops diacritics, ZWNJ -> space
function normalizeText(str) {
    return str
        .replace(/\u064A/g, "ی")
        .replace(/\u0643/g, "ک")
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/[\u200C\u200E\u200F]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/* ---------- title parsing: <course> - <subject> - <session> ---------- */

const sessionWords = new Map([
    ["اول", 1], ["یکم", 1], ["دوم", 2], ["سوم", 3], ["چهارم", 4], ["پنجم", 5],
    ["ششم", 6], ["هفتم", 7], ["هشتم", 8], ["نهم", 9], ["دهم", 10],
    ["یازدهم", 11], ["دوازدهم", 12], ["سیزدهم", 13], ["چهاردهم", 14],
    ["پانزدهم", 15], ["شانزدهم", 16], ["هفدهم", 17], ["هجدهم", 18],
    ["نوزدهم", 19], ["بیستم", 20], ["بیست", 20], ["سی", 30], ["سیم", 30],
    ["چهل", 40], ["چهلم", 40], ["پنجاه", 50], ["پنجاهم", 50],
]);

// "جلسه دوم" -> 2, "جلسه ۱۲" -> 12, "جلسه بیست و یکم" -> 21
function parseSessionNumber(text) {
    const normalized = normalizeText(text);
    const digits = normalized.match(/\d+/);
    if (digits) return Number(digits[0]);

    let total = 0;
    let found = false;
    for (const token of normalized.split(" ")) {
        if (sessionWords.has(token)) {
            total += sessionWords.get(token);
            found = true;
        }
    }
    return found ? total : null;
}

function parseTitle(title) {
    const parts = title
        .split(/\s+[-–—]\s+/)
        .map((p) => p.trim())
        .filter(Boolean);
    if (parts.length < 2) return {};

    const result = { course: parts[0] };

    let sessionText = null;
    if (parts.length >= 3) {
        sessionText = parts[parts.length - 1];
    } else if (/جلسه|session|lecture/i.test(normalizeText(parts[1]))) {
        sessionText = parts[1];
    }

    if (sessionText) {
        result.session = sessionText;
        const number = parseSessionNumber(sessionText);
        if (number !== null) result.sessionNumber = number;
    }
    return result;
}

/* ---------- titles from files ---------- */

// Markdown source of a note: note.md next to note.html (new flat layout),
// data/input/note.md (old layout), or any single .md file in the folder.
function findMarkdownFile(folderPath) {
    for (const candidate of ["note.md", path.join("data", "input", "note.md")]) {
        const candidatePath = path.join(folderPath, candidate);
        if (fs.existsSync(candidatePath)) return candidatePath;
    }

    const anyMd = fs
        .readdirSync(folderPath)
        .filter((name) => name.toLowerCase().endsWith(".md"))
        .sort()[0];
    return anyMd ? path.join(folderPath, anyMd) : null;
}

function readTitleFromMarkdown(folderPath) {
    const mdPath = findMarkdownFile(folderPath);
    if (!mdPath) return null;

    const md = fs.readFileSync(mdPath, "utf8").replace(/^\uFEFF/, "");
    const match = md.match(/\*\*\s*مبحث\s*:?\s*\*\*\s*:?[ \t]*(.+)/);
    return match ? match[1].trim() || null : null;
}

function readTitleFromHtml(html) {
    const topic = html.match(
        /<(?:strong|b)>\s*مبحث\s*:?\s*<\/(?:strong|b)>\s*:?\s*([\s\S]*?)(?:<br\s*\/?>|<\/(?:p|li|h[1-6]|div|td)>)/
    );
    if (topic) {
        const title = cleanTitle(topic[1]);
        if (title) return title;
    }

    const titleTag = html.match(/<title>([\s\S]*?)<\/title>/);
    if (titleTag) {
        const title = cleanTitle(titleTag[1]);
        if (title) return title;
    }

    return null;
}

/* ---------- date the note was first added ---------- */

function firstAddedDate(relativeFile) {
    try {
        const out = execFileSync(
            "git",
            ["log", "--follow", "--format=%aI", "--", relativeFile],
            { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim();
        if (out) {
            const lines = out.split("\n");
            return lines[lines.length - 1]; // oldest commit that touched the file
        }
    } catch (_) {
        /* no git, or not a repository */
    }

    const stats = fs.statSync(path.join(root, relativeFile));
    const time = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
    return new Date(time).toISOString();
}

/* ---------- scan ---------- */

function findNoteFile(folderPath) {
    return noteFileCandidates.find((file) => fs.existsSync(path.join(folderPath, file))) || null;
}

function readNote(folderPath, relativeFolder, folderCategory) {
    const noteFile = findNoteFile(folderPath);
    if (!noteFile) {
        console.warn(`! skipped ${relativeFolder}: no ${noteFileCandidates.join(" or ")} inside`);
        return;
    }

    const html = fs.readFileSync(path.join(folderPath, noteFile), "utf8");
    const title =
        readTitleFromMarkdown(folderPath) ||
        readTitleFromHtml(html) ||
        path.basename(folderPath);

    const relativeFile = `${relativeFolder}/${noteFile}`;
    rawNotes.push({
        path: relativeFile,
        title,
        folderCategory,
    });
}

// "cat_Clinical_Lab" -> "Clinical Lab"
function categoryDisplayName(folderName) {
    return folderName.slice("cat_".length).replace(/_/g, " ").trim();
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    if (entry.name.startsWith("note_")) {
        readNote(path.join(root, entry.name), entry.name, null);
        continue;
    }

    if (entry.name.startsWith("cat_")) {
        const category = categoryDisplayName(entry.name) || entry.name;
        const categoryPath = path.join(root, entry.name);

        for (const sub of fs.readdirSync(categoryPath, { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            readNote(
                path.join(categoryPath, sub.name),
                `${entry.name}/${sub.name}`,
                category
            );
        }
    }
}

/* ---------- categories: folder name wins, otherwise the course name ---------- */

const categoryNames = new Map(); // normalized key -> display name

function displayCategory(name) {
    const key = normalizeText(name).toLowerCase();
    if (!categoryNames.has(key)) categoryNames.set(key, name);
    return categoryNames.get(key);
}

// Register cat_ folder names first so they win the display name
for (const raw of rawNotes) {
    if (raw.folderCategory) displayCategory(raw.folderCategory);
}

/* ---------- "added" dates: carried over from the previous notes.json ---------- */

const manifestPath = path.join(root, "notes.json");
const manifestSchema = 2;

// note_Immuno1/note.html, cat_X/note_Immuno1/output/index.html -> "note_Immuno1"
function noteId(notePath) {
    const parts = notePath.split("/");
    parts.pop();
    if (parts[parts.length - 1] === "output") parts.pop();
    return parts[parts.length - 1];
}

function readPreviousManifest() {
    try {
        const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const added = new Map();
        for (const n of data.notes || []) {
            if (n && n.path && n.added) added.set(n.id || noteId(n.path), n.added);
        }
        return { trusted: data.schema >= manifestSchema, added };
    } catch (_) {
        return { trusted: false, added: new Map() };
    }
}

const previous = readPreviousManifest();
const now = new Date();
const baselineCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
const newlyAdded = [];

function baselineDate(relativeFile) {
    const date = new Date(firstAddedDate(relativeFile));
    return (Number.isNaN(date.getTime()) || date > baselineCutoff ? baselineCutoff : date).toISOString();
}

const notes = rawNotes.map((raw) => {
    const parsed = parseTitle(raw.title);
    const id = noteId(raw.path);
    const note = { id, path: raw.path, title: raw.title };

    let added = previous.trusted ? previous.added.get(id) : null;
    if (!added) {
        if (previous.trusted) {
            added = now.toISOString();
            newlyAdded.push(raw.path);
        } else {
            added = baselineDate(raw.path);
        }
    }

    const category = raw.folderCategory
        ? displayCategory(raw.folderCategory)
        : parsed.course
          ? displayCategory(parsed.course)
          : null;

    if (category) note.category = category;
    if (parsed.course) note.course = parsed.course;
    if (parsed.session) note.session = parsed.session;
    if (parsed.sessionNumber !== undefined) note.sessionNumber = parsed.sessionNumber;
    note.added = added;
    return note;
});

// Stable order in the file: categories alphabetical, uncategorized last, then title
notes.sort((a, b) => {
    const ca = a.category || "";
    const cb = b.category || "";
    if (ca !== cb) {
        if (!ca) return 1;
        if (!cb) return -1;
        return ca.localeCompare(cb, "fa");
    }
    return a.title.localeCompare(b.title, "fa");
});

fs.writeFileSync(
    manifestPath,
    JSON.stringify({ schema: manifestSchema, notes }, null, 2) + "\n"
);

const categoryCount = new Set(notes.map((n) => n.category).filter(Boolean)).size;
const uncategorized = notes.filter((n) => !n.category);
if (!previous.trusted) {
    console.log("first run with date tracking: existing notes were treated as already known (nothing is marked new)");
}
for (const p of newlyAdded) console.log(`+ new note: ${p}`);
console.log(
    `notes.json updated: ${notes.length} note(s), ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`
);
for (const n of uncategorized) {
    console.warn(`! no category (title not in "course - subject - session" form): ${n.path}`);
}
