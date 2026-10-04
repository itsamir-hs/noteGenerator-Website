// Note registry: the hand-edited metadata file that layers on top of whatever
// the build can extract from a note's Markdown / pre-rendered HTML.
//
// `site/notes.registry.json` is never written by the build — it belongs to the
// repository. Entries are keyed by *source file name* (e.g. "lab-safety.md",
// "bone-marrow-on-a-chip.html" or "output/index.html") so renaming a note never
// silently detaches its description from the note itself.
//
// Shape:
//   {
//     "notes": {
//       "my-note.md": {
//         "slug": "my-note",
//         "title": "عنوان نمایشی دلخواه",
//         "description": "توضیح کوتاه برای کارت خانه",
//         "order": 10,
//         "featured": true,
//         "hidden": false
//       }
//     },
//     "removed": [
//       { "slug": "old-note", "source": "old-note.md", "removedAt": "2026-10-03" }
//     ]
//   }
//
// The `removed` list is maintained by `node site/removeNote.js`. A note listed
// there is never published again, so deleting a note actually sticks even while
// its source file is still on disk. Entries may also be plain strings, which are
// matched against both the slug and the source file name.

import { readFile, writeFile } from "node:fs/promises";
import { SITE_CONFIG } from "./config.js";
import { toAbsolute } from "./paths.js";

const EMPTY_REGISTRY = { notes: {}, removed: [] };

/**
 * Read the registry. A missing file is not an error — the site simply falls
 * back to fully automatic metadata.
 */
export async function readRegistry() {
    const registryPath = toAbsolute(SITE_CONFIG.registryFilePath);

    let fileContent;

    try {
        fileContent = await readFile(registryPath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            return structuredClone(EMPTY_REGISTRY);
        }

        throw error;
    }

    let parsedRegistry;

    try {
        parsedRegistry = JSON.parse(fileContent);
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${SITE_CONFIG.registryFilePath}: ${error.message}`
        );
    }

    const notes =
        parsedRegistry &&
        typeof parsedRegistry.notes === "object" &&
        parsedRegistry.notes !== null
            ? parsedRegistry.notes
            : {};

    const removed = Array.isArray(parsedRegistry?.removed)
        ? parsedRegistry.removed
        : [];

    return { ...parsedRegistry, notes, removed };
}

/** Serialise the registry back to disk, preserving the original key order. */
export async function writeRegistry(registry) {
    const registryPath = toAbsolute(SITE_CONFIG.registryFilePath);

    return writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

/** Registry entry for one source file (never null, so callers stay simple). */
export function getRegistryEntry(registry, fileName) {
    const entry = registry?.notes?.[fileName];

    if (!entry || typeof entry !== "object") {
        return {};
    }

    return entry;
}

/**
 * Look a source up in the registry.
 *
 * A source can be registered either by its full path ("output/index.html") or by
 * its bare file name ("index.html"). The full path wins so two files with the
 * same name in different directories can still be configured independently.
 */
export function lookupRegistryEntry(registry, sourceLabel, fileName) {
    const byLabel = getRegistryEntry(registry, sourceLabel);

    if (Object.keys(byLabel).length > 0) {
        return byLabel;
    }

    return getRegistryEntry(registry, fileName);
}

/** Normalise the user-editable parts of a registry entry. */
export function normalizeRegistryEntry(entry) {
    const normalized = {};

    if (typeof entry.slug === "string" && entry.slug.trim()) {
        normalized.slug = entry.slug.trim();
    }

    if (typeof entry.title === "string" && entry.title.trim()) {
        normalized.title = entry.title.trim();
    }

    if (typeof entry.description === "string" && entry.description.trim()) {
        normalized.description = entry.description.trim();
    }

    if (typeof entry.course === "string" && entry.course.trim()) {
        normalized.course = entry.course.trim();
    }

    if (typeof entry.instructor === "string" && entry.instructor.trim()) {
        normalized.instructor = entry.instructor.trim();
    }

    if (Number.isFinite(Number(entry.order))) {
        normalized.order = Number(entry.order);
    }

    if (entry.featured !== undefined) {
        normalized.featured = Boolean(entry.featured);
    }

    if (entry.hidden !== undefined) {
        normalized.hidden = Boolean(entry.hidden);
    }

    return normalized;
}

/* =========================================================
   Removal list
   ========================================================= */

function removalEntryMatches(entry, { slug, sourceFile }) {
    if (typeof entry === "string") {
        return entry === slug || entry === sourceFile;
    }

    if (!entry || typeof entry !== "object") {
        return false;
    }

    return (
        (typeof entry.slug === "string" && entry.slug === slug) ||
        (typeof entry.source === "string" && entry.source === sourceFile)
    );
}

/** True when a note was removed from the site and must not come back. */
export function isNoteRemoved(registry, { slug, sourceFile }) {
    const removed = Array.isArray(registry?.removed) ? registry.removed : [];

    return removed.some((entry) =>
        removalEntryMatches(entry, { slug, sourceFile })
    );
}

/** Add a removal entry if the note is not listed yet. Returns true when added. */
export function addRemovedEntry(registry, { slug, sourceFile, removedAt }) {
    if (isNoteRemoved(registry, { slug, sourceFile })) {
        return false;
    }

    if (!Array.isArray(registry.removed)) {
        registry.removed = [];
    }

    registry.removed.push({
        slug,
        source: sourceFile,
        removedAt
    });

    return true;
}

/** Drop a removal entry. Returns true when something was removed. */
export function removeRemovedEntry(registry, { slug, sourceFile }) {
    if (!Array.isArray(registry.removed)) {
        return false;
    }

    const before = registry.removed.length;

    registry.removed = registry.removed.filter(
        (entry) => !removalEntryMatches(entry, { slug, sourceFile })
    );

    return registry.removed.length !== before;
}