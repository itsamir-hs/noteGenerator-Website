// Renders Markdown lecture notes into their final HTML documents.
//
// `renderNoteHtml` is the single reusable entry point for the renderer: the
// multi-note build below uses it, and external tools (e.g. the editing
// dashboard) import it so they produce byte-for-byte the same note format
// instead of a second, drifting HTML implementation.

import {
    mkdir,
    readdir,
    readFile,
    rm,
    writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderMarkdown } from "./renderer.js";
import { createTableOfContents } from "./tableOfContents.js";
import {
    claimNoteSlug,
    createNoteSlug,
    extractMetadata,
    extractNoteTitle,
    normalizeThemeName,
    resolveNoteSlug
} from "./noteIdentity.js";

/**
 * Template placeholders, in the order they appear inside templates/note.html.
 * The reference/definition numbering intentionally follows the template
 * (section ۹ precedes ۸).
 */
const SECTION_DEFINITIONS = [
    { key: "introductionContent", title: "۱. مقدمه و کلیات" },
    { key: "mainContent", title: "۲. متن اصلی جزوه" },
    { key: "definitionsContent", title: "۳. تعاریف" },
    { key: "importantPointsContent", title: "۴. نکات مهم" },
    { key: "examplesContent", title: "۵. مثال‌ها" },
    { key: "quickTablesContent", title: "۶. جداول مرور سریع" },
    { key: "keyTermsContent", title: "۷. اصطلاحات و تعاریف کلیدی" },
    { key: "referencesContent", title: "۹. منابع و مراجع" },
    { key: "reviewContent", title: "۸. موارد نیازمند بررسی" },
    { key: "completionContent", title: "۱۰. گزارش تکمیل بودن محتوا" }
];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Placeholder style used by every template, e.g. `{{noteTitle}}`. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

function toPlainText(htmlFragment) {
    return String(htmlFragment)
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

/** Fold Persian/Latin digits and punctuation so "۱. متن اصلی" equals "1 متن اصلی". */
function normalizeTitle(title) {
    return toPlainText(title)
        .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
        .replace(/[.．۔،,،:؛;()\[\]{}«»"'\-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** Leading numeral of a heading ("۴. نکات مهم" → 4), or null when absent. */
function leadingNumeral(title) {
    const match = normalizeTitle(title).match(/^(\d+)/);
    return match ? Number(match[1]) : null;
}

/** Split rendered note HTML into top-level H2 sections, preserving order. */
function splitIntoSections(htmlContent) {
    const sections = [];
    const headingPattern = /<h2[^>]*>([\s\S]*?)<\/h2>/g;

    let match;
    let current = null;

    while ((match = headingPattern.exec(htmlContent)) !== null) {
        if (current) {
            current.html = htmlContent.slice(current.start, match.index).trim();
            sections.push(current);
        }

        current = {
            title: toPlainText(match[1]),
            start: match.index,
            html: ""
        };
    }

    if (current) {
        current.html = htmlContent.slice(current.start).trim();
        sections.push(current);
    } else if (htmlContent.trim() !== "") {
        // No H2 at all — keep the whole body so nothing is lost on export.
        sections.push({ title: "", start: 0, html: htmlContent.trim() });
    }

    return sections;
}

/**
 * Map rendered H2 sections onto the template's fixed placeholders.
 *
 * Matching is intentionally defensive because the operator may rename a
 * heading. Order of preference per placeholder: exact title, leading numeral,
 * then positional. Any leftover sections are appended to `mainContent` so an
 * edited note can never silently lose content during export.
 */
function mapSectionsToTemplate(htmlContent) {
    const sections = splitIntoSections(htmlContent);
    const used = new Array(sections.length).fill(false);
    const result = {};

    const takeSection = (index) => {
        used[index] = true;
        return sections[index].html;
    };

    const findIndex = (predicate) => {
        for (let i = 0; i < sections.length; i++) {
            if (!used[i] && predicate(sections[i])) return i;
        }
        return -1;
    };

    for (const definition of SECTION_DEFINITIONS) {
        const wanted = normalizeTitle(definition.title);

        let index = findIndex((section) => normalizeTitle(section.title) === wanted);
        if (index === -1) {
            const numeral = leadingNumeral(definition.title);
            index = findIndex((section) => numeral !== null && leadingNumeral(section.title) === numeral);
        }

        result[definition.key] = index === -1 ? "" : takeSection(index);
    }

    // Positional fallback for placeholders that are still empty.
    for (const definition of SECTION_DEFINITIONS) {
        if (result[definition.key] !== "") continue;
        const index = findIndex(() => true);
        if (index === -1) break;
        result[definition.key] = takeSection(index);
    }

    // Anything left over is appended to the main content section.
    const leftovers = sections.filter((_, i) => !used[i]).map((section) => section.html);
    if (leftovers.length > 0) {
        result.mainContent = [result.mainContent, ...leftovers].filter(Boolean).join("\n");
    }

    return result;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function createTableOfContentsHtml(tocItems) {
    if (tocItems.length === 0) {
        return "";
    }

    return tocItems
        .map((item) => {
            // Sub-headings reuse `.tocSubItem`, the class the stylesheets
            // actually style; `.tocItemPrimary` used to be emitted here and
            // matched no rule in any theme.
            const className =
                item.level === 2
                    ? "tocItem"
                    : "tocItem tocSubItem";

            return `
                <a
                    class="${className}"
                    href="#${item.headingId}"
                >
                    ${item.title}
                </a>
            `;
        })
        .join("");
}

/**
 * Render Markdown into the final note HTML document.
 *
 * @param {string} markdownContent - Note source in Markdown.
 * @param {Object} options
 * @param {string} options.template - Contents of templates/note.html.
 * @param {Object} [options.rendererConfig] - { theme, language, enableMath }.
 * @param {string} [options.assetPrefix="../"] - Prefix for asset references,
 *   relative to where the note will be written (`../../` when the note lives
 *   in a folder inside the rendered-notes directory).
 * @param {string} [options.noteSlug] - Identity of the note on the site; also
 *   namespaces its browser storage.
 * @param {string} [options.noteNavigation] - Home/prev/next markup, already
 *   rendered to the correct relative hrefs.
 * @returns {{html: string, title: string, metadata: Object, tocItems: Array}}
 */
export function renderNoteHtml(markdownContent, options = {}) {
    const rendererConfig = options.rendererConfig || {
        theme: "light",
        language: "fa",
        enableMath: true
    };

    const template = options.template;
    if (typeof template !== "string") {
        throw new Error("renderNoteHtml requires options.template (string).");
    }

    const assetPrefix = options.assetPrefix ?? "../";
    const noteSlug = options.noteSlug ?? "note";

    const noteTitle = extractNoteTitle(markdownContent);
    const metadata = extractMetadata(markdownContent);

    const renderedMarkdown = renderMarkdown(
        markdownContent,
        rendererConfig,
        { assetPrefix }
    );

    const { htmlContent, tocItems } = createTableOfContents(
        renderedMarkdown
    );

    // Metadata comes from the note's header block rather than from parsed
    // Markdown, so it is escaped here before it reaches the template.
    const headerLabel = escapeHtml(
        metadata.courseName || metadata.topic || noteTitle
    );

    const replacements = {
        noteTitle: escapeHtml(noteTitle),
        noteSlug: escapeHtml(noteSlug),
        assetPrefix,
        noteHead: createNoteHead({
            title: noteTitle,
            slug: noteSlug,
            metadata
        }),
        noteNavigation: options.noteNavigation ?? "",
        headerLabel,
        courseName: escapeHtml(metadata.courseName),
        topic: escapeHtml(metadata.topic),
        instructor: escapeHtml(metadata.instructor),
        sessionDate: escapeHtml(metadata.sessionDate),
        generatedDate: escapeHtml(metadata.generatedDate),
        tableOfContents: createTableOfContentsHtml(tocItems),
        ...mapSectionsToTemplate(htmlContent)
    };

    // Function replacement: note content is full of `$` sequences that
    // String.replace would otherwise interpret as backreferences.
    let finalHtml = template.replace(
        PLACEHOLDER_PATTERN,
        (placeholder, key) => replacements[key] ?? ""
    );

    // A key that was added to the template but not to `replacements` would be
    // blanked by the loop above, so fail here rather than shipping a hole.
    const unresolved = finalHtml.match(
        /\{\{\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/
    );

    if (unresolved) {
        throw new Error(
            `Template placeholder ${unresolved[0]} has no replacement value.`
        );
    }

    // The template ships with data-theme="light"; honour the configured theme so
    // the exported note opens in the theme the operator chose.
    const theme = normalizeThemeName(rendererConfig.theme);
    if (/<html[^>]*\sdata-theme="[^"]*"/.test(finalHtml)) {
        return finalHtml.replace(
            /(<html[^>]*\sdata-theme=")[^"]*(")/,
            `$1${theme}$2`
        );
    }

    return finalHtml.replace(
        /<html\b([^>]*)>/,
        `<html$1 data-theme="${theme}">`
    );
}

/**
 * Document metadata for a note: canonical link plus the fields the site
 * builder reads back when it assembles the home page.
 */
function createNoteHead({ title, slug, metadata }) {
    const tags = [
        `<meta name="note-slug" content="${escapeHtml(slug)}">`,
        `<meta name="note-course" content="${escapeHtml(metadata.courseName)}">`,
        `<meta name="note-topic" content="${escapeHtml(metadata.topic)}">`,
        `<meta name="note-instructor" content="${escapeHtml(metadata.instructor)}">`,
        `<meta name="note-session-date" content="${escapeHtml(metadata.sessionDate)}">`,
        `<meta name="note-generated" content="${escapeHtml(metadata.generatedDate)}">`
    ];

    return tags.map((tag) => `    ${tag}`).join("\n");
}

/**
 * Home / previous / next controls for one note.
 *
 * @param {Object} params
 * @param {string} params.homeHref - Relative link back to the home page.
 * @param {Object|null} params.previous - `{ title, href }` or null.
 * @param {Object|null} params.next - `{ title, href }` or null.
 * @returns {string} Markup for the header, or "" when there is nowhere to go.
 */
export function createNoteNavigation({ homeHref, previous, next }) {
    const escapeAttribute = (value) => escapeHtml(value).replace(/`/g, "&#096;");

    const homeButton = `<a
    class="noteNavLink"
    href="${escapeAttribute(homeHref)}"
    aria-label="فهرست جزوه‌ها"
    title="فهرست جزوه‌ها"
>
    <i data-lucide="library"></i>
</a>`;

    const navButton = (target, icon, label) => {
        if (!target) {
            return `<button
    class="noteNavButton"
    type="button"
    disabled
    aria-label="بدون ${label}"
>
    <i data-lucide="${icon}"></i>
</button>`;
        }

        return `<a
    class="noteNavLink noteNavButton"
    href="${escapeAttribute(target.href)}"
    aria-label="${label}: ${escapeHtml(target.title)}"
    title="${escapeHtml(target.title)}"
>
    <i data-lucide="${icon}"></i>
</a>`;
    };

    return `<div class="noteNavigation">
${homeButton}
${navButton(previous, "chevron-right", "جزوه قبلی")}
${navButton(next, "chevron-left", "جزوه بعدی")}
</div>`;
}

/* =========================================================
   Multi-note build
   ========================================================= */

const inputDirectory = "data/input";
const importedDirectory = "data/imported";
const outputDirectory = "renderedNotes";
const notesManifestName = "notes.json";

/**
 * Folder names may contain letters of any script — the notes are Persian, so a
 * Persian slug is the readable one — but must stay safe as a directory name and
 * as one URL path segment.
 */
const unsafeSlugCharacters = /[\\/:*?"<>| -]/;

function assertPublishableSlug(slug, source) {
    const problem =
        slug === "." ||
        slug === ".." ||
        slug.startsWith(".") ||
        slug.endsWith(".") ||
        unsafeSlugCharacters.test(slug);

    if (problem) {
        throw new Error(
            `Refusing to publish unsafe folder name "${slug}" from ${source}. ` +
            "Set an explicit `**نامک:**` slug in the note."
        );
    }
}

async function listFiles(directory, extension) {
    let entries;

    try {
        entries = await readdir(directory, {
            withFileTypes: true
        });
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }

    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Read identity out of a Markdown source: title, metadata and candidate slug.
 */
function identifyMarkdownSource(fileName, markdownContent) {
    const title = extractNoteTitle(markdownContent);
    const metadata = extractMetadata(markdownContent);

    return {
        kind: "markdown",
        source: `${inputDirectory}/${fileName}`,
        title,
        metadata,
        slug: resolveNoteSlug({ title, metadata })
    };
}

/**
 * Read identity out of a note that was rendered elsewhere and dropped into
 * data/imported. Only the facts a folder name needs are recovered.
 *
 * When the document carries no `note-slug` meta tag — which is the case for
 * notes produced before the site existed — the file name is the slug, so
 * renaming the file is how an operator claims a URL for it.
 */
function identifyImportedNote(fileName, html) {
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch
        ? toPlainText(titleMatch[1])
        : fileName.replace(/\.html?$/i, "");

    const metaOf = (name) => {
        const match = html.match(
            new RegExp(
                `<meta\\s+name="${name}"\\s+content="([^"]*)"`,
                "i"
            )
        );
        return match ? match[1] : "";
    };

    const metadata = {
        courseName: metaOf("note-course"),
        topic: metaOf("note-topic"),
        instructor: metaOf("note-instructor"),
        sessionDate: metaOf("note-session-date"),
        generatedDate: metaOf("note-generated"),
        slug: metaOf("note-slug")
    };

    const slug =
        metadata.slug ||
        createNoteSlug(fileName.replace(/\.html?$/i, ""));

    return {
        kind: "imported",
        source: `${importedDirectory}/${fileName}`,
        title,
        metadata,
        slug
    };
}

/**
 * Turn every available source into a note identity, then give each one a
 * unique folder name.
 */
async function collectNoteIdentities() {
    const identities = [];
    const takenSlugs = new Map();

    const claim = (identity) => {
        assertPublishableSlug(
            identity.slug,
            identity.source
        );

        identity.slug = claimNoteSlug(
            identity.slug,
            takenSlugs,
            identity.source
        );

        return identity;
    };

    for (const fileName of await listFiles(inputDirectory, ".md")) {
        const markdownContent = await readFile(
            join(inputDirectory, fileName),
            "utf8"
        );

        identities.push(
            claim(identifyMarkdownSource(fileName, markdownContent))
        );
    }

    for (const fileName of await listFiles(importedDirectory, ".html")) {
        const html = await readFile(
            join(importedDirectory, fileName),
            "utf8"
        );

        identities.push(
            claim(identifyImportedNote(fileName, html))
        );
    }

    // Library order: course first, then topic, then title, with the slug as a
    // final tiebreaker so the order never depends on the filesystem.
    identities.sort((a, b) => {
        const key = (note) =>
            [
                note.metadata.courseName,
                note.metadata.topic,
                note.title,
                note.slug
            ]
                .join(" ")
                .toLowerCase();

        return key(a).localeCompare(key(b), "fa");
    });

    return identities;
}

async function readRendererConfig() {
    return JSON.parse(
        await readFile(
            "config/renderer_config.json",
            "utf8"
        )
    );
}

/**
 * Render every discovered note into renderedNotes/<slug>/index.html.
 *
 * Notes imported from elsewhere are already rendered, so they are carried over
 * and only re-pointed at this site's assets, note identity and navigation.
 */
/**
 * Remove note folders left over from an earlier build.
 *
 * Without this, renaming or deleting a source file would leave its old folder
 * behind and the repository would keep two copies of the library.
 */
async function removeStaleNoteFolders(identities) {
    const keep = new Set(
        identities.map((identity) => identity.slug)
    );

    const entries = await readdir(outputDirectory, {
        withFileTypes: true
    });

    for (const entry of entries) {
        if (!entry.isDirectory() || keep.has(entry.name)) {
            continue;
        }

        const staleDirectory = join(
            outputDirectory,
            entry.name
        );

        await rm(staleDirectory, {
            recursive: true,
            force: true
        });

        console.log(`Removed stale note folder ${entry.name}`);
    }
}

export async function renderAllNotes(options = {}) {
    const identities = await collectNoteIdentities();

    if (identities.length === 0) {
        throw new Error(
            `No notes found. Add a Markdown file to ${inputDirectory}/.`
        );
    }

    const template = await readFile(
        "templates/note.html",
        "utf8"
    );

    const rendererConfig = await readRendererConfig();

    await mkdir(outputDirectory, { recursive: true });
    await removeStaleNoteFolders(identities);

    const notes = [];

    const assetPrefix = options.assetPrefix ?? "../../";

    for (const [index, identity] of identities.entries()) {
        const previousNote = identities[index - 1] ?? null;
        const nextNote = identities[index + 1] ?? null;

        const navigation = createNoteNavigation({
            // "Up to the library root": the same prefix that reaches the shared
            // assets from this note's folder.
            homeHref: assetPrefix,
            previous: previousNote && {
                title: previousNote.title,
                // Notes are siblings, so leave the current folder first.
                href: `../${previousNote.slug}/`
            },
            next: nextNote && {
                title: nextNote.title,
                href: `../${nextNote.slug}/`
            }
        });

        let html;

        if (identity.kind === "markdown") {
            const markdownContent = await readFile(
                identity.source,
                "utf8"
            );

            html = renderNoteHtml(markdownContent, {
                template,
                rendererConfig,
                assetPrefix,
                noteSlug: identity.slug,
                noteNavigation: navigation
            });
        } else {
            const importedHtml = await readFile(
                identity.source,
                "utf8"
            );

            html = adoptImportedNote(importedHtml, {
                identity,
                navigation
            });
        }

        const noteDirectory = join(
            outputDirectory,
            identity.slug
        );

        await mkdir(noteDirectory, { recursive: true });
        await writeFile(
            join(noteDirectory, "index.html"),
            html,
            "utf8"
        );

        notes.push({
            slug: identity.slug,
            title: identity.title,
            course: identity.metadata.courseName,
            topic: identity.metadata.topic,
            instructor: identity.metadata.instructor,
            sessionDate: identity.metadata.sessionDate,
            generated: identity.metadata.generatedDate,
            origin: identity.kind,
            source: identity.source,
            path: `${outputDirectory}/${identity.slug}/index.html`
        });

        console.log(
            `Rendered ${identity.slug}  (${identity.source})`
        );
    }

    await writeFile(
        join(outputDirectory, notesManifestName),
        `${JSON.stringify(
            {
                noteCount: notes.length,
                notes
            },
            null,
            4
        )}\n`,
        "utf8"
    );

    return notes;
}

/**
 * Re-point an externally rendered note at this site's conventions.
 *
 * The document is not re-rendered: its content is authoritative and may come
 * from a toolchain this repository does not contain. Only the four things that
 * make it a page of *this* site are patched, each one anchored so a structure
 * change fails loudly instead of silently skipping the note.
 */
function adoptImportedNote(html, { identity, navigation }) {
    const patches = [
        [
            /(<html\b[^>]*\sdata-theme=")([^"]*)(")/,
            (_, prefix, theme, suffix) =>
                `${prefix}${normalizeThemeName(theme)}${suffix}`
        ],
        [
            /<body(\s[^>]*)?>/,
            (match, attributes = "") =>
                `<body data-note-slug="${escapeHtml(identity.slug)}"${attributes}>`
        ],
        [
            /<\/head>/,
            (_, end) =>
                `\n    <link\n` +
                `        rel="icon"\n` +
                `        href="../data/assets/favicon.svg"\n` +
                `        type="image/svg+xml"\n` +
                `    >\n\n` +
                `${createNoteHead({
                    title: identity.title,
                    slug: identity.slug,
                    metadata: identity.metadata
                })}\n${end}`
        ],
        [
            /(<div class="headerControls">)/,
            (_, controls) => `${controls}\n\n${navigation}`
        ],
        // Imported notes predate per-note storage namespacing, and their
        // scripts call noteScopedStorageKey(). Load the helper ahead of them so
        // highlights, sticky notes and scroll position work here too.
        [
            /([ \t]*)<script src="([^"]*)themeSwitcher\.js"><\/script>/,
            (match, indent, prefix) =>
                `${indent}<script src="${prefix}noteStorage.js"></script>\n` +
                `${match}`
        ],
        // The header title comes from the **درس:** field, which notes rendered
        // before the site existed often lack. Fall back to the note's own
        // title rather than leaving the header blank.
        [
            /<div class="appTitle">(\s*)<\/div>/,
            (_, whitespace) =>
                `<div class="appTitle">${whitespace}${escapeHtml(
                    identity.metadata.courseName ||
                        identity.metadata.topic ||
                        identity.title
                )}${whitespace}</div>`
        ]
    ];

    for (const [pattern, replacement] of patches) {
        if (!pattern.test(html)) {
            throw new Error(
                `Cannot adopt ${identity.source}: expected to find ${pattern} in the document.`
            );
        }

        html = html.replace(pattern, replacement);
    }

    return html;
}

// Only run the CLI when this file is executed directly (`node src/main.js`),
// so importing renderNoteHtml from another tool has no side effects.
const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
    renderAllNotes().catch((error) => {
        console.error("Rendering failed:");
        console.error(error);
        process.exit(1);
    });
}