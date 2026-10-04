// Remove a note from the site — and make sure it never comes back.
//
//   node site/removeNote.js --list
//   node site/removeNote.js <slug>
//   node site/removeNote.js <slug> --purge      # also delete the source file
//   node site/removeNote.js <slug> --restore    # undo a removal
//   node site/removeNote.js <slug> --no-build   # skip the automatic rebuild
//
// What a removal does:
//   1. deletes the published folder notes/<slug>/
//   2. records the slug AND the source file in site/notes.registry.json
//      ("removed"), so later builds skip it even while the source file is still
//      on disk — the note does not reappear on the home page
//   3. rebuilds the site unless --no-build was passed
//
// The source file itself is only deleted with --purge, and only when it lives in
// a site source directory (content/… or output/…). Nothing else is ever touched.

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { SITE_CONFIG } from "./config.js";
import { PROJECT_ROOT, toAbsolute } from "./paths.js";
import { buildSite } from "./buildSite.js";
import {
    addRemovedEntry,
    readRegistry,
    removeRemovedEntry,
    writeRegistry
} from "./registry.js";

const SOURCE_DIRECTORIES = [
    SITE_CONFIG.markdownNotesDirectoryName,
    SITE_CONFIG.preRenderedNotesDirectoryName,
    SITE_CONFIG.rendererOutputDirectoryName
];

let silent = false;

function log(message) {
    if (!silent) {
        console.log(message);
    }
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** Read the slug → note map written by the last build. */
async function readBuiltNotes() {
    try {
        const generated = JSON.parse(
            await readFile(
                toAbsolute(SITE_CONFIG.generatedIndexFilePath),
                "utf8"
            )
        );

        return generated.notes ?? [];
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

function parseArguments(argumentsList) {
    const options = {
        slug: null,
        purge: false,
        restore: false,
        list: false,
        build: true
    };

    for (const argument of argumentsList) {
        if (argument === "--purge") {
            options.purge = true;
        } else if (argument === "--restore") {
            options.restore = true;
        } else if (argument === "--list") {
            options.list = true;
        } else if (argument === "--no-build") {
            options.build = false;
        } else if (!argument.startsWith("-")) {
            options.slug = argument;
        } else {
            fail(`Unknown option: ${argument}`);
        }
    }

    return options;
}

/**
 * Refuse to delete anything outside the site source directories.
 * The path is resolved first, so `content/notes/../../etc/passwd` is rejected.
 */
export function isPurgeable(sourceFile) {
    if (typeof sourceFile !== "string" || sourceFile === "") {
        return false;
    }

    const resolved = path.resolve(
        PROJECT_ROOT,
        sourceFile.split(path.sep).join("/")
    );

    const relativePath = path
        .relative(PROJECT_ROOT, resolved)
        .split(path.sep)
        .join("/");

    if (relativePath.startsWith("..")) {
        return false;
    }

    return SOURCE_DIRECTORIES.some(
        (directory) =>
            relativePath === directory ||
            relativePath.startsWith(`${directory}/`)
    );
}

/**
 * A removal entry as a flat record, or null.
 * Accepts the object form written by this tool and the shorthand string form.
 */
function findRemovedEntry(registry, slug) {
    const removed = Array.isArray(registry?.removed) ? registry.removed : [];

    return (
        removed.find((entry) => {
            if (typeof entry === "string") {
                return entry === slug;
            }

            return Boolean(entry) && entry.slug === slug;
        }) ?? null
    );
}

function describeRemovedEntry(entry) {
    if (typeof entry === "string") {
        return { slug: entry, source: null };
    }

    return {
        slug: entry.slug,
        source: entry.source ?? null,
        removedAt: entry.removedAt ?? null
    };
}

export async function removeNote({
    slug,
    purge = false,
    restore = false,
    build = true,
    quiet = false
} = {}) {
    silent = quiet;

    const registry = await readRegistry();
    const removedEntry = findRemovedEntry(registry, slug);

    if (restore) {
        // A removed note is, by definition, not in the build index any more —
        // the removal list is the only place it is still recorded.
        if (!removedEntry) {
            log(`"${slug}" is not in the removal list — nothing to restore.`);

            silent = false;

            return { slug, restored: false };
        }

        const { source } = describeRemovedEntry(removedEntry);

        removeRemovedEntry(registry, { slug, sourceFile: source });
        await writeRegistry(registry);

        log(`↩︎  Restored "${slug}"${source ? ` (${source})` : ""}.`);
    } else {
        const builtNotes = (await readBuiltNotes()) ?? [];
        const note = builtNotes.find((entry) => entry.slug === slug);

        if (!note) {
            if (removedEntry) {
                const { source } = describeRemovedEntry(removedEntry);

                log(
                    `"${slug}" is already removed from the site (${source ?? "unknown source"}).`
                );

                if (purge && source && isPurgeable(source)) {
                    await rm(toAbsolute(source), { force: true });

                    log(`   --purge: deleted source file ${source}`);
                } else if (purge) {
                    log(
                        `   --purge skipped: "${source}" is outside ${SOURCE_DIRECTORIES.join(", ")}`
                    );
                }

                silent = false;

                return {
                    slug,
                    restored: false,
                    alreadyRemoved: true,
                    purged: purge
                };
            }

            fail(
                `No published note with slug "${slug}".\n` +
                    `  Published notes: ${
                        builtNotes.map((entry) => entry.slug).join(", ") ||
                        "none"
                    }\n` +
                    `  Removed notes:   ${
                        (registry.removed ?? [])
                            .map((entry) => describeRemovedEntry(entry).slug)
                            .join(", ") || "none"
                    }\n` +
                    `  Run \`node site/removeNote.js --list\` for details.`
            );
        }

        const notesDirectory = path.join(
            toAbsolute(SITE_CONFIG.notesDirectoryName),
            slug
        );

        await rm(notesDirectory, { recursive: true, force: true });

        log(`🗑  Deleted notes/${slug}/`);

        const added = addRemovedEntry(registry, {
            slug,
            sourceFile: note.source.file,
            removedAt: new Date().toISOString().slice(0, 10)
        });

        if (added) {
            await writeRegistry(registry);

            log(
                `   Recorded in ${SITE_CONFIG.registryFilePath} — it will not come back.`
            );
        }

        if (purge) {
            const sourceFile = note.source.file;

            if (!isPurgeable(sourceFile)) {
                log(
                    `   --purge skipped: "${sourceFile}" is outside ${SOURCE_DIRECTORIES.join(", ")}`
                );
            } else {
                await rm(toAbsolute(sourceFile), { force: true });

                log(`   --purge: deleted source file ${sourceFile}`);
            }
        } else {
            log(
                `   Source file kept: ${note.source.file}  (use --purge to delete it)`
            );
        }
    }

    if (build) {
        await buildSite({ quiet });
    }

    silent = false;

    return { slug, restored: restore, purged: purge && !restore };
}

function listNotes(builtNotes, registry) {
    log(`Published notes (from ${SITE_CONFIG.generatedIndexFilePath}):\n`);

    for (const note of builtNotes) {
        log(
            `  ${note.hidden ? "[hidden] " : ""}${note.slug}\n` +
                `      title : ${note.title}\n` +
                `      url   : ${note.url}\n` +
                `      source: ${note.source.file} (${note.source.kind})\n`
        );
    }

    if (!builtNotes.length) {
        log("  (none)\n");
    }

    const removed = (registry.removed ?? []).map(describeRemovedEntry);

    log(`\nRemoved notes (never republished):`);

    for (const entry of removed) {
        log(
            `  ${entry.slug}\n` +
                `      source: ${entry.source ?? "unknown"}` +
                `${entry.removedAt ? ` (removed ${entry.removedAt})` : ""}\n`
        );
    }

    if (!removed.length) {
        log("  (none)");
    }

    log(`\nRemove one with:  node site/removeNote.js <slug>`);
    log(`Undo one with:    node site/removeNote.js <slug> --restore`);
}

const isDirectRun =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
    const options = parseArguments(process.argv.slice(2));

    if (options.list) {
        const builtNotes = (await readBuiltNotes()) ?? [];

        listNotes(builtNotes, await readRegistry());
    } else if (!options.slug) {
        fail(
            "Usage: node site/removeNote.js <slug> [--purge] [--restore] [--no-build]\n       node site/removeNote.js --list"
        );
    } else {
        await removeNote({
            slug: options.slug,
            purge: options.purge,
            restore: options.restore,
            build: options.build
        });
    }
}