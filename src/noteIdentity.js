// Everything we can learn about a note *before* rendering it: its title, its
// metadata block, and the folder slug it will be published under.
//
// These parsers are shared by the render CLI and the site builder so a note is
// identified the same way no matter which entry point produced it.

/**
 * Theme names the stylesheets actually define. A theme that is not in this list
 * falls back to `light`, because the CSS matches `[data-theme="…"]` exactly and
 * a wrong-case value silently renders with the base palette.
 */
const NOTE_THEMES = ["light", "dark", "forest", "paperLike", "neon"];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Longest slug we are willing to publish, to keep URLs readable. */
const MAX_SLUG_LENGTH = 48;

/**
 * Metadata labels understood in the note's leading `**label:** value` lines.
 * Unlisted labels are ignored rather than treated as an error, so notes are free
 * to carry extra front-matter of their own.
 */
const METADATA_LABELS = new Map([
    ["درس", "courseName"],
    ["مبحث", "topic"],
    ["استاد", "instructor"],
    ["تاریخ جلسه", "sessionDate"],
    ["تاریخ تولید جزوه", "generatedDate"],
    ["نامک", "slug"]
]);


function extractNoteTitle(markdownContent) {
    const titleMatch = markdownContent.match(/^# (.+)$/m);

    return titleMatch
        ? titleMatch[1].trim()
        : "Untitled Note";
}


function createEmptyMetadata() {
    return {
        courseName: "",
        topic: "",
        instructor: "",
        sessionDate: "",
        generatedDate: "",
        slug: ""
    };
}


/**
 * Pull the `**label:** value` header block out of a note.
 *
 * @param {string} markdownContent - Note source in Markdown.
 * @returns {Object} Metadata fields, empty strings where the note is silent.
 */
function extractMetadata(markdownContent) {
    const metadata = createEmptyMetadata();

    for (const line of markdownContent.split("\n")) {
        const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);

        if (!match) {
            continue;
        }

        const field = METADATA_LABELS.get(match[1].trim());

        if (field) {
            metadata[field] = match[2].trim();
        }
    }

    return metadata;
}


/**
 * Turn a human title into a folder name that is safe on disk and in a URL.
 *
 * Letters of any script are kept (the notes are Persian, so Persian slugs are
 * the readable option); everything else is dropped, spaces become dashes.
 * ZWNJ is removed rather than replaced because Persian uses it inside words.
 *
 * @param {string} value - Title, topic or explicit slug.
 * @returns {string} Slug, possibly empty when the input has no usable letters.
 */
function createNoteSlug(value) {
    const slug = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
        .replace(/[\s_/\\]+/g, "-")
        .replace(/[^\p{L}\p{N}-]/gu, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug.length > MAX_SLUG_LENGTH
        ? slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "")
        : slug;
}


/**
 * Resolve the slug a note will be published under.
 *
 * Preference order: an explicit `**نامک:**` slug, then the topic (most
 * descriptive), then the course, then the title.
 *
 * @param {Object} identity - `{ title, metadata }`.
 * @returns {string} Slug; falls back to `note` when nothing usable is found.
 */
function resolveNoteSlug(identity) {
    const metadata = identity.metadata ?? createEmptyMetadata();

    const candidates = [
        metadata.slug,
        metadata.topic,
        metadata.courseName,
        identity.title
    ];

    for (const candidate of candidates) {
        const slug = createNoteSlug(candidate);

        if (slug !== "") {
            return slug;
        }
    }

    return "note";
}


/**
 * Make slugs unique within one build.
 *
 * Two notes can legitimately share a title (different courses, re-renders);
 * disambiguating with `-2`, `-3` keeps both instead of silently overwriting one.
 *
 * @param {string} slug - Desired slug.
 * @param {Map<string, string>} taken - Slug -> source path, updated in place.
 * @param {string} source - Identity of the note asking for the slug.
 * @returns {string} A slug not yet present in `taken`.
 */
function claimNoteSlug(slug, taken, source) {
    const safeSlug = slug !== "" ? slug : "note";

    if (!taken.has(safeSlug)) {
        taken.set(safeSlug, source);
        return safeSlug;
    }

    let suffix = 2;

    while (taken.has(`${safeSlug}-${suffix}`)) {
        suffix++;
    }

    const uniqueSlug = `${safeSlug}-${suffix}`;

    taken.set(uniqueSlug, source);
    return uniqueSlug;
}


/**
 * Match a configured theme name against the themes the stylesheets define,
 * ignoring case. Unknown names fall back to `light` rather than emitting a
 * `data-theme` value that no stylesheet matches.
 *
 * @param {string} theme - Configured or previously rendered theme name.
 * @returns {string} A canonical theme name.
 */
function normalizeThemeName(theme) {
    const wanted = String(theme ?? "").trim().toLowerCase();

    return (
        NOTE_THEMES.find(
            (name) => name.toLowerCase() === wanted
        ) ?? "light"
    );
}


export {
    MAX_SLUG_LENGTH,
    METADATA_LABELS,
    NOTE_THEMES,
    PERSIAN_DIGITS,
    claimNoteSlug,
    createEmptyMetadata,
    createNoteSlug,
    extractMetadata,
    extractNoteTitle,
    normalizeThemeName,
    resolveNoteSlug
};