// Note slug creation.
//
// Slugs become folder names under notes/, so they must be filesystem-safe,
// URL-friendly and stable. Because note titles are usually Persian (which has
// no ASCII transliteration we could rely on) the slug is derived from the
// source *file name* first, then from the registry override, and only falls
// back to a generated id as a last resort.

const UNSAFE_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const MAX_SLUG_LENGTH = 64;

/**
 * Turn arbitrary text into a lowercase ASCII slug.
 * Persian/Arabic text reduces to an empty string — callers must handle that.
 */
export function slugify(value) {
    return toSlugSource(value)
        .replace(UNSAFE_SLUG_CHARACTERS, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/g, "");
}

/** Normalise a file name into slug *source* text (extension, spaces removed). */
export function toSlugSource(value) {
    return String(value ?? "")
        .replace(/\.[^./\\]+$/, "")
        .replace(/[\s_]+/g, "-")
        .replace(/[()\[\]{}"'`,]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
}

const RESERVED_SLUGS = new Set([
    "",
    ".",
    "..",
    "assets",
    "index",
    "notes",
    "site",
    "src",
    "styles",
    "templates",
    "vendor",
    "content",
    "config",
    "data",
    "tests",
    "output"
]);

/**
 * Produce the final, guaranteed-unique slug for a note.
 *
 * @param {Object} options
 * @param {string} options.requestedSlug - Registry override (optional).
 * @param {string} options.fileName - Source file name, used as a fallback.
 * @param {Set<string>} options.takenSlugs - Slugs already used by other notes.
 * @returns {string}
 */
export function createNoteSlug({ requestedSlug, fileName, takenSlugs }) {
    const taken = takenSlugs instanceof Set ? takenSlugs : new Set(takenSlugs ?? []);

    const candidates = [requestedSlug, fileName];

    for (const candidate of candidates) {
        const slug = slugify(candidate);

        if (!slug || RESERVED_SLUGS.has(slug)) {
            continue;
        }

        if (!taken.has(slug)) {
            return slug;
        }

        // Keep both notes: append a numeric suffix instead of overwriting.
        let suffix = 2;

        while (taken.has(`${slug}-${suffix}`)) {
            suffix++;
        }

        return `${slug}-${suffix}`;
    }

    let fallback = 1;

    while (taken.has(`note-${fallback}`)) {
        fallback++;
    }

    return `note-${fallback}`;
}