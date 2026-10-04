// Turns note sources into the publishable pages under `notes/<slug>/index.html`.
//
// Three source directories are supported and produce identical output:
//
//   content/notes/*.md        → rendered with the original module's public API
//                                (renderNoteHtml from src/main.js)
//   content/pre-rendered/*.html → an already generated note document
//   output/*.html             → whatever `node src/main.js` just rendered
//
// The last one is what makes the original renderer usable for the site: run the
// module's own CLI and the produced document is imported on the next build.
//
// The original module is used strictly as a library: nothing in src/ is changed.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderNoteHtml } from "../src/main.js";
import { SITE_CONFIG } from "./config.js";
import { toAbsolute } from "./paths.js";
import { finalizeNoteHtml, rewriteNoteAssetPaths } from "./noteHtml.js";
import {
    buildNoteEntry,
    createSummary,
    extractPreRenderedMetadata,
    extractRenderedNoteMetadata
} from "./noteMetadata.js";
import {
    isNoteRemoved,
    lookupRegistryEntry,
    normalizeRegistryEntry
} from "./registry.js";
import { createNoteSlug, slugify, toSlugSource } from "./slug.js";

/**
 * Source directories, in build order (which also decides the default order of
 * the notes menu). `defaultSlug` is used for generic file names such as
 * index.html and `allowTitleSlug` allows a Latin title to supply the slug.
 */
const SOURCE_DIRECTORIES = [
    {
        kind: "markdown",
        directoryName: SITE_CONFIG.markdownNotesDirectoryName,
        filePattern: /\.md$/i
    },
    {
        kind: "pre-rendered",
        directoryName: SITE_CONFIG.preRenderedNotesDirectoryName,
        filePattern: /\.html?$/i
    },
    {
        kind: "pre-rendered",
        directoryName: SITE_CONFIG.rendererOutputDirectoryName,
        filePattern: /\.html?$/i,
        defaultSlug: SITE_CONFIG.rendererOutputDefaultSlug,
        isRendererOutput: true
    }
];

/** File names that carry no information and therefore make a poor slug. */
const GENERIC_FILE_SLUGS = new Set([
    "index",
    "page",
    "note",
    "notes",
    "output",
    "document",
    "main",
    "default",
    "new",
    "final",
    "test"
]);

/** Remove and recreate `notes/` so deleted sources never leave stale pages. */
export async function resetNotesDirectory() {
    const notesDirectory = toAbsolute(SITE_CONFIG.notesDirectoryName);

    await rm(notesDirectory, { recursive: true, force: true });
    await mkdir(notesDirectory, { recursive: true });
}

async function listSourceFiles(directoryName) {
    const directory = toAbsolute(directoryName);

    let entries;

    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }

        throw error;
    }

    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((fileName) => !fileName.startsWith("."))
        .sort();
}

function hashHtml(html) {
    return createHash("sha256").update(html).digest("hex");
}

/**
 * Decide the folder name of a note.
 *
 * Order of preference: registry override → a meaningful file name → the source
 * directory's default slug (the `output/index.html` render slot) → the note
 * title (only usable for Latin titles) → `note-N`.
 */
export function resolveSourceSlug({
    registryEntry,
    fileName,
    title,
    defaultSlug,
    takenSlugs: providedSlugs
}) {
    const takenSlugs =
        providedSlugs instanceof Set ? providedSlugs : new Set();

    if (registryEntry.slug) {
        return createNoteSlug({
            requestedSlug: registryEntry.slug,
            fileName,
            takenSlugs
        });
    }

    const fileSlug = slugify(toSlugSource(fileName));

    if (fileSlug && !GENERIC_FILE_SLUGS.has(fileSlug)) {
        return createNoteSlug({ fileName, takenSlugs });
    }

    if (defaultSlug) {
        return createNoteSlug({
            requestedSlug: defaultSlug,
            fileName: `${defaultSlug}.html`,
            takenSlugs
        });
    }

    const titleSlug = slugify(title);

    if (titleSlug) {
        return createNoteSlug({
            requestedSlug: titleSlug,
            fileName,
            takenSlugs
        });
    }

    return createNoteSlug({ fileName, takenSlugs });
}

async function writeNotePage(relativeOutputPath, html) {
    const absoluteOutputPath = toAbsolute(relativeOutputPath);

    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, html, "utf8");
}

/** Rough text extraction used only to build a card summary. */
function stripMarkup(html) {
    return String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/(p|li|h[1-6]|td|th|blockquote|div)>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** Build one Markdown note and write it to notes/<slug>/index.html. */
async function buildMarkdownNote({
    fileName,
    directory,
    template,
    rendererConfig,
    registryEntry,
    takenSlugs,
    enableStorageScoping
}) {
    const sourcePath = toAbsolute(`${directory}/${fileName}`);
    const sourceLabel = `${directory}/${fileName}`;

    const markdownContent = await readFile(sourcePath, "utf8");

    const slug = resolveSourceSlug({
        registryEntry,
        fileName,
        title: "",
        takenSlugs
    });

    const renderedNote = renderNoteHtml(markdownContent, {
        template,
        rendererConfig
    });

    const extracted = extractRenderedNoteMetadata(renderedNote);

    extracted.summarySource = createSummary(stripMarkup(renderedNote.html));

    // Identity of the note's *content*: hashed before the site layer injects the
    // slug-dependent assets, so the same note rendered twice is recognised even
    // when the two copies end up under different folder names.
    const contentHtml = rewriteNoteAssetPaths(renderedNote.html);

    const finalHtml = finalizeNoteHtml(renderedNote.html, {
        slug,
        enableStorageScoping
    });

    const relativeOutputPath = `${SITE_CONFIG.notesDirectoryName}/${slug}/index.html`;

    await writeNotePage(relativeOutputPath, finalHtml);

    return {
        entry: buildNoteEntry({
            slug,
            sourceKind: "markdown",
            sourceFile: sourceLabel,
            extracted,
            registryEntry,
            order: takenSlugs.size
        }),
        html: finalHtml,
        contentHash: hashHtml(contentHtml)
    };
}

/** Import one pre-rendered note document into notes/<slug>/index.html. */
async function buildPreRenderedNote({
    fileName,
    directory,
    defaultSlug,
    isRendererOutput,
    registryEntry,
    takenSlugs,
    enableStorageScoping
}) {
    const sourcePath = toAbsolute(`${directory}/${fileName}`);
    const sourceLabel = `${directory}/${fileName}`;

    const sourceHtml = await readFile(sourcePath, "utf8");

    const extracted = extractPreRenderedMetadata(sourceHtml);

    const slug = resolveSourceSlug({
        registryEntry,
        fileName,
        title: extracted.title,
        defaultSlug,
        takenSlugs
    });

    const contentHtml = rewriteNoteAssetPaths(sourceHtml);

    const finalHtml = finalizeNoteHtml(sourceHtml, {
        slug,
        enableStorageScoping
    });

    const relativeOutputPath = `${SITE_CONFIG.notesDirectoryName}/${slug}/index.html`;

    await writeNotePage(relativeOutputPath, finalHtml);

    return {
        entry: buildNoteEntry({
            slug,
            sourceKind: isRendererOutput ? "rendered" : "pre-rendered",
            sourceFile: sourceLabel,
            extracted: extractPreRenderedMetadata(finalHtml),
            registryEntry,
            order: takenSlugs.size
        }),
        html: finalHtml,
        contentHash: hashHtml(contentHtml),
        isRendererOutput
    };
}

/**
 * Build every note found in the source directories.
 *
 * @returns {Promise<{notes: Array, issues: Array}>}
 */
export async function buildAllNotes({
    template,
    rendererConfig,
    registry,
    enableStorageScoping = SITE_CONFIG.enableStorageScoping
} = {}) {
    if (typeof template !== "string") {
        throw new Error("buildAllNotes requires the note template string.");
    }

    const takenSlugs = new Set();
    const entries = [];
    const issues = [];

    // slug → content hash of what is currently published under that slug.
    const publishedContent = new Map();
    const titlesInUse = new Map();

    for (const directory of SOURCE_DIRECTORIES) {
        const fileNames = await listSourceFiles(directory.directoryName);

        for (const fileName of fileNames.filter((name) =>
            directory.filePattern.test(name)
        )) {
            const sourceLabel = `${directory.directoryName}/${fileName}`;
            const registryEntry = normalizeRegistryEntry(
                lookupRegistryEntry(registry, sourceLabel, fileName)
            );

            const isRemoved = isNoteRemoved(registry, {
                sourceFile: sourceLabel
            });

            if (isRemoved) {
                issues.push({
                    level: "info",
                    type: "removed",
                    source: sourceLabel,
                    message: "removed from the site — skipped (see site/notes.registry.json)"
                });

                continue;
            }

            const built =
                directory.kind === "markdown"
                    ? await buildMarkdownNote({
                          fileName,
                          directory: directory.directoryName,
                          template,
                          rendererConfig,
                          registryEntry,
                          takenSlugs,
                          enableStorageScoping
                      })
                    : await buildPreRenderedNote({
                          fileName,
                          directory: directory.directoryName,
                          defaultSlug: directory.defaultSlug,
                          isRendererOutput: Boolean(directory.isRendererOutput),
                          registryEntry,
                          takenSlugs,
                          enableStorageScoping
                      });

            const { entry, contentHash } = built;

            // Same content as an already published note: publishing it again
            // would only create a second URL for identical content.
            const identicalSlug = [...publishedContent.entries()].find(
                ([, hash]) => hash === contentHash
            );

            if (identicalSlug) {
                await rm(path.join(
                    toAbsolute(SITE_CONFIG.notesDirectoryName),
                    entry.slug
                ), { recursive: true, force: true });

                issues.push({
                    level: "warn",
                    type: "duplicate-content",
                    source: sourceLabel,
                    slug: entry.slug,
                    message: `identical to notes/${identicalSlug[0]}/ — not published again`
                });

                takenSlugs.delete(entry.slug);

                continue;
            }

            if (isNoteRemoved(registry, { slug: entry.slug })) {
                await rm(path.join(
                    toAbsolute(SITE_CONFIG.notesDirectoryName),
                    entry.slug
                ), { recursive: true, force: true });

                issues.push({
                    level: "info",
                    type: "removed",
                    source: sourceLabel,
                    slug: entry.slug,
                    message: "removed from the site — skipped"
                });

                continue;
            }

            const previousHash = publishedContent.get(entry.slug);

            if (previousHash && previousHash !== contentHash) {
                issues.push({
                    level: "warn",
                    type: "replaced",
                    source: sourceLabel,
                    slug: entry.slug,
                    message: `replaced the previous contents of notes/${entry.slug}/ (${titlesInUse.get(entry.slug) ?? "?"} → ${entry.title})`
                });
            }

            const sameTitleSlug = titlesInUse.get(entry.title);

            if (sameTitleSlug && sameTitleSlug !== entry.slug) {
                issues.push({
                    level: "warn",
                    type: "duplicate-title",
                    source: sourceLabel,
                    slug: entry.slug,
                    message: `another note already uses the title "${entry.title}" (notes/${sameTitleSlug}/) — give one of them a distinct slug in site/notes.registry.json`
                });
            }

            publishedContent.set(entry.slug, contentHash);
            titlesInUse.set(entry.title, entry.slug);

            entries.push(entry);
        }
    }

    return {
        notes: sortNoteEntries(entries),
        issues
    };
}

/** Featured first, then explicit order, then alphabetical for stability. */
export function sortNoteEntries(entries) {
    return [...entries].sort((first, second) => {
        if (first.featured !== second.featured) {
            return first.featured ? -1 : 1;
        }

        if (first.order !== second.order) {
            return first.order - second.order;
        }

        return first.title.localeCompare(second.title, "fa");
    });
}