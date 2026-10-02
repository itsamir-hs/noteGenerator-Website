// Renders Markdown lecture notes into their final HTML documents.
//
// `renderNoteHtml` is the single reusable entry point for the renderer: the
// multi-note build below uses it, and external tools (e.g. the editing
// dashboard) import it so they produce byte-for-byte the same note format
// instead of a second, drifting HTML implementation.

import {
    copyFile,
    mkdir,
    readdir,
    readFile,
    rm,
    stat,
    writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { renderMarkdown } from "./renderer.js";
import { createTableOfContents } from "./tableOfContents.js";
import {
    claimNoteSlug,
    createNoteSlug,
    extractMetadata,
    extractNoteTitle,
    normalizeThemeName,
    resolveNoteSlug,
    stripByteOrderMark
} from "./noteIdentity.js";
import { resolveTemplateIncludes } from "./templateIncludes.js";

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

    // Strip any BOM once, here, so the title and metadata parsers and the
    // Markdown pipeline all see the same characters.
    const source = stripByteOrderMark(markdownContent);

    const noteTitle = extractNoteTitle(source);
    const metadata = extractMetadata(source);

    const renderedMarkdown = renderMarkdown(
        source,
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
        /\{\{\s*>?\s*[A-Za-z][A-Za-z0-9]*\s*\}\}|\{\{>\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/
    );

    if (unresolved) {
        throw new Error(
            `Template placeholder ${unresolved[0]} was not filled in.`
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
const unsafeSlugCharacters = /[\\/:*?"<>|\u0000-\u001F]/;

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

/**
 * List files in a directory by extension.
 *
 * The extension is matched without regard to case: a note saved as
 * `ANATOMY.HTML` on Windows or macOS would otherwise be ignored in silence,
 * leaving the operator to wonder why their note never appeared.
 */
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

    const wantedExtension = extension.toLowerCase();

    return entries
        .filter(
            (entry) =>
                entry.isFile() &&
                entry.name.toLowerCase().endsWith(
                    wantedExtension
                )
        )
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
function identifyImportedNote(source, html) {
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch
        ? toPlainText(titleMatch[1])
        : withoutExtension(basename(source));

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

    // A note inside a folder of its own is named after that folder, not after its
    // file: `data/imported/foldered/note.html` becomes `foldered`, which is also
    // where its assets live. A note kept flat is named after its file.
    const folder = dirname(source);
    const nameHint =
        folder === "." || folder === ""
            ? basename(source)
            : folder;

    const slug =
        metadata.slug ||
        createNoteSlug(withoutExtension(nameHint));

    return {
        kind: "imported",
        source: `${importedDirectory}/${source}`,
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

    for (const source of await listImportedNotes()) {
        const html = await readFile(
            join(importedDirectory, source),
            "utf8"
        );

        const identity = identifyImportedNote(source, html);

        identity.relativeSource = source;

        identities.push(claim(identity));
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

/**
 * Render one note and queue its output.
 *
 * Kept separate from the loop so a single unusable file can be reported
 * without taking every other note down with it.
 *
 * @throws When the note cannot be rendered or adopted.
 */
async function renderIdentity({
    identity, identities, index, template, rendererConfig,
    assetPrefix, rendered, notes
}) {
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

        const ownedAssets =
await collectImportedAssets(
                    identity.relativeSource
                );

        const { html: adopted, sharedReferences } =
            adoptImportedAssetReferences(
                importedHtml,
                ownedAssets
            );

        identity.ownedAssets = ownedAssets;
        identity.sharedAssetReferences = sharedReferences;

        html = adoptImportedNote(adopted, {
            identity,
            navigation
        });
    }

    // Held in memory until every note has rendered: a note that fails
    // halfway through must not leave the library half-rebuilt.
    rendered.push({ identity, html });

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
        ownsAssets: (identity.ownedAssets ?? []).length,
        sharedAssetReferences:
            identity.sharedAssetReferences ?? [],
        path: `${outputDirectory}/${identity.slug}/index.html`
    });
}

export async function renderAllNotes(options = {}) {
    const identities = await collectNoteIdentities();

    if (identities.length === 0) {
        throw new Error(
            `No notes found. Add a Markdown file to ${inputDirectory}/.`
        );
    }

    const template = await resolveTemplateIncludes(
        await readFile("templates/note.html", "utf8")
    );

    const rendererConfig = await readRendererConfig();

    const notes = [];

    // Sources that could not be rendered. The good notes are still written, and
    // the process exits non-zero at the end so this can never pass unnoticed.
    const failures = [];

    // Nothing is written until every note has rendered: a failure part way
    // through must leave the previous library intact rather than half-rebuilt.
    const rendered = [];

    const assetPrefix = options.assetPrefix ?? "../../";

    for (const [index, identity] of identities.entries()) {
        try {
            await renderIdentity({
                identity,
                identities,
                index,
                template,
                rendererConfig,
                assetPrefix,
                rendered,
                notes
            });
        } catch (error) {
            // One unusable file must not cost the operator every other note.
            // Record it, carry on, and fail loudly once the good ones are saved.
            failures.push({
                source: identity.source,
                message: error.message
            });
        }
    }

    /* =========================================================
       Everything rendered — now it is safe to touch the disk
       ========================================================= */

    await mkdir(outputDirectory, { recursive: true });
    await removeStaleNoteFolders(identities);

    for (const { identity, html } of rendered) {
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

        // A note that owns its assets keeps them, so its images travel with it
        // instead of depending on whatever shares their name.
        const ownedAssets = identity.ownedAssets ?? [];

        if (ownedAssets.length > 0) {
            const sourceAssets =
                await resolveImportedAssetsDirectory(
                    identity.relativeSource
                );
            const targetAssets = join(
                noteDirectory,
                "assets"
            );

            await mkdir(targetAssets, { recursive: true });

            for (const fileName of ownedAssets) {
                await copyFile(
                    join(sourceAssets, fileName),
                    join(targetAssets, fileName)
                );
            }
        }

        if (
            identity.sharedAssetReferences?.length > 0
        ) {
            console.warn(
                `  ${identity.slug}: ${identity.sharedAssetReferences.length} asset(s) ` +
                `still come from the shared data/assets library ` +
                `(${identity.sharedAssetReferences.join(", ")}). ` +
                "A name shared with another note may not be the same picture — " +
                `copy them into ${importedDirectory}/${identity.slug}/assets/ to be safe.`
            );
        }

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

    if (failures.length > 0) {
        const report = failures
            .map(
                (failure) =>
                    `  - ${failure.source}: ${failure.message}`
            )
            .join("\n");

        throw new Error(
            `${failures.length} note(s) could not be rendered. ` +
            `The other ${notes.length} were published.\n${report}`
        );
    }

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
/**
 * Local asset references a pre-rendered note makes, relative to the project root.
 *
 * A note rendered elsewhere points at `data/assets/...` in *its* repository. That
 * path means nothing here, and the names collide across projects: two different
 * courses both have an `image2.jpg`. Binding such a reference to this
 * repository's copy would show the wrong picture with no error anywhere, so a
 * note may ship its own copy in data/imported/<note>/assets/ and those
 * references are repointed at it. Anything it does not own still resolves through
 * the shared library, and is reported so the risk is visible rather than silent.
 *
 * Only `src` is matched. The note's own `<link rel="icon">` also points into
 * data/assets/, and treating that as note content would move the favicon.
 */
const localAssetPattern =
    /\bsrc="(?:\.\.\/)+data\/assets\/([^"]+)"/g;

function withoutExtension(fileName) {
    return fileName.replace(/\.html?$/i, "");
}


/**
 * Find imported notes under data/imported/, at any depth.
 *
 * Two layouts are supported, because a note may or may not have assets of its
 * own and either arrangement is natural:
 *
 *   data/imported/my-note.html  +  data/imported/my-note/assets/
 *   data/imported/my-note/my-note.html  +  data/imported/my-note/assets/
 *
 * `assets` directories are never scanned for notes, so a note's own images can
 * never be mistaken for a note of their own.
 *
 * @returns {Promise<string[]>} Paths relative to data/imported/.
 */
async function listImportedNotes() {
    const found = [];

    const walk = async (directory) => {
        let entries;

        try {
            entries = await readdir(directory, {
                withFileTypes: true
            });
        } catch (error) {
            if (error.code === "ENOENT") {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === "assets") {
                    continue;
                }

                await walk(join(directory, entry.name));
            } else if (
                entry.name.toLowerCase().endsWith(".html")
            ) {
                found.push(
                    relative(importedDirectory, join(directory, entry.name))
                );
            }
        }
    };

    await walk(importedDirectory);

    return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Where an imported note's own assets live, if it has any.
 *
 * Beside the note (`<note folder>/assets/`) first, then in a folder named after
 * the file (`data/imported/<name>/assets/`), which is how a note kept flat at
 * the top of data/imported/ stores its images.
 *
 * @param {string} source - Path relative to data/imported/.
 * @returns {Promise<string|null>} Absolute path, or null when it owns none.
 */
async function resolveImportedAssetsDirectory(source) {
    const candidates = [
        // Beside the note: data/imported/<note>/assets/ (and, for a note kept
        // flat, data/imported/assets/ — hence the explicit join rather than a
        // bare dirname).
        join(
            importedDirectory,
            dirname(source),
            "assets"
        ),
        // In a folder named after the file: data/imported/<name>/assets/.
        join(
            importedDirectory,
            withoutExtension(basename(source)),
            "assets"
        )
    ];

    for (const candidate of candidates) {
        try {
            await stat(candidate);
            return candidate;
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    return null;
}

/**
 * List the files an imported note owns.
 *
 * @param {string} source - Path relative to data/imported/.
 * @returns {Promise<string[]>} File names, flat.
 */
async function collectImportedAssets(source) {
    const assetsDirectory =
        await resolveImportedAssetsDirectory(source);

    if (assetsDirectory === null) {
        return [];
    }

    const entries = await readdir(assetsDirectory, {
        withFileTypes: true
    });

    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
}

/**
 * Repoint an imported note's local asset references at the copies it owns.
 *
 * @param {string} html - Imported note source.
 * @param {string[]} ownedAssets - File names in the note's own assets folder.
 * @returns {{html: string, sharedReferences: string[]}} The rewritten note, and
 *   the references that still fall through to the shared asset library.
 */
export function adoptImportedAssetReferences(html, ownedAssets) {
    const owned = new Set(ownedAssets);
    const sharedReferences = new Set();

    const rewritten = html.replace(
        localAssetPattern,
        (match, assetPath) => {
            const fileName = assetPath.split("/").at(-1);

            if (owned.has(fileName)) {
                return `src="assets/${fileName}"`;
            }

            sharedReferences.add(assetPath);
            return match;
        }
    );

    return { html: rewritten, sharedReferences: [...sharedReferences] };
}

/**
 * Bring a pre-rendered note into line with this site's conventions.
 *
 * Exported for tests: the patching is anchored to specific markup, so a
 * template change could silently stop applying one of the patches, and the only
 * way to notice is to run the importer against a document and look at it.
 *
 * @param {string} html - Imported note source.
 * @param {Object} params
 * @param {Object} params.identity - Note identity, including `metadata`.
 * @param {string} params.navigation - Home/prev/next markup.
 * @returns {string} The adopted note.
 */
export function adoptImportedNote(html, { identity, navigation }) {
    // A note may be imported more than once — including a page this project
    // published itself. Re-patching one that already carries our markup would
    // duplicate the storage helper, the note id and the navigation, so each
    // patch is applied only to a document that lacks it.
    const alreadyAdopted =
        /<body[^>]*\sdata-note-slug=/.test(html);

    const patches = [
        [
            /(<html\b[^>]*\sdata-theme=")([^"]*)(")/,
            (_, prefix, theme, suffix) =>
                `${prefix}${normalizeThemeName(theme)}${suffix}`
        ],
        [
            /<body(\s[^>]*)?>/,
            (match, attributes = "") => {
                if (alreadyAdopted) {
                    return match;
                }

                return (
                    `<body data-note-slug="${escapeHtml(identity.slug)}"${attributes}>`
                );
            }
        ],
        // No capture group on this pattern, so the replacer's first argument is
        // the whole match. Naming the second parameter `end` would silently
        // receive the match *offset* instead and drop the closing tag.
        [
            /<\/head>/,
            (closingHead) =>
                alreadyAdopted
                    ? closingHead
                    : `\n    <link\n` +
                      `        rel="icon"\n` +
                      `        href="../data/assets/favicon.svg"\n` +
                      `        type="image/svg+xml"\n` +
                      `    >\n\n` +
                      `${createNoteHead({
                          title: identity.title,
                          slug: identity.slug,
                          metadata: identity.metadata
                      })}\n${closingHead}`
        ],
        [
            /(<div class="headerControls">)/,
            (_, controls) =>
                alreadyAdopted
                    ? `${controls}`
                    : `${controls}\n\n${navigation}`
        ],
        // Imported notes predate per-note storage namespacing, and their
        // scripts call noteScopedStorageKey(). Load the helper ahead of them so
        // highlights, sticky notes and scroll position work here too.
        [
            /([ \t]*)<script src="([^"]*)themeSwitcher\.js"><\/script>/,
            (match, indent, prefix) =>
                alreadyAdopted || /noteStorage\.js/.test(html)
                    ? match
                    : `${indent}<script src="${prefix}noteStorage.js"></script>\n${match}`
        ],
        // The header title comes from the **درس:** field, which notes rendered
        // before the site existed often lack. Only fill a blank one: where the
        // original had a course name, that is better than the note title.
        [
            /(<div class="appTitle">)([\s\S]*?)(<\/div>)/,
            (match, open, content, close) => {
                if (toPlainText(content) !== "") {
                    return match;
                }

                return (
                    `${open}${escapeHtml(
                        identity.metadata.courseName ||
                            identity.metadata.topic ||
                            identity.title
                    )}${close}`
                );
            }
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