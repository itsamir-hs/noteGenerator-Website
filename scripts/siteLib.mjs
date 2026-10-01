// Shared pieces of the publish step: turning project-relative asset references
// into site-relative ones, rendering the home page from the note manifest, and
// verifying that the result would actually work in a browser.
//
// Asset references inside a rendered note are relative to the *project root*
// (e.g. `../../styles/base.css`, because the note lives two levels down in
// renderedNotes/<slug>/). The published site keeps the same shape — shared
// assets at the site root, notes under renderedNotes/ — so only the directory
// names change. Doing the mapping through an explicit table keeps that rename
// in one place instead of scattered find-and-replace rules.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** How many directories of `src/` (and only `src/`) are published as browser scripts. */
const scriptDirectories = new Set([
    "aboutModal.js",
    "backToTop.js",
    "fontSizeSwitcher.js",
    "highlight.js",
    "noteLibrary.js",
    "noteStorage.js",
    "print.js",
    "quickNavigation.js",
    "search.js",
    "stickyNotes.js",
    "themeSwitcher.js",
    "viewPersistence.js"
]);

/** Browser scripts, as `<name>.js` paths the notes can reference. */
export const browserScripts = Array.from(scriptDirectories);

/** Third-party bundles copied into vendor/ at publish time. */
const vendorFiles = new Map([
    ["node_modules/katex/dist/katex.min.css", "vendor/katex/katex.min.css"],
    [
        "node_modules/lucide/dist/umd/lucide.js",
        "vendor/lucide.min.js"
    ]
]);

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const relativeReferencePattern =
    /(?<attribute>\b(?:href|src)\s*=\s*")(?<value>[^"]*)(")/gi;

const externalReferencePattern =
    /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i;

/**
 * Map a project-root-relative path onto its published location.
 *
 * @param {string} target - Path relative to the project root.
 * @returns {string} Path relative to the site root.
 */
export function mapProjectPath(target) {
    const vendorTarget = vendorFiles.get(target);

    if (vendorTarget) {
        return vendorTarget;
    }

    if (target.startsWith("data/assets/")) {
        return `assets/${target.slice("data/assets/".length)}`;
    }

    if (target.startsWith("src/")) {
        const scriptName = target.slice("src/".length);

        return scriptDirectories.has(scriptName)
            ? `js/${scriptName}`
            : target;
    }

    return target;
}

/**
 * Split a reference into its leading `./`/`../` markers and the path that
 * follows, which is always relative to the project root.
 */
function splitReference(reference) {
    const match = reference.match(
        /^(?<markers>(?:\.\.\/)+|\.\/)?(?<target>.*)$/
    );

    return {
        markers: match.groups.markers ?? "",
        target: match.groups.target
    };
}

/**
 * True when a reference points at a project asset (a stylesheet, a browser
 * script, a vendored bundle or a note image) rather than at page content.
 * Only those need repointing at the published copy; links between notes and
 * heading anchors must be left exactly as the note author wrote them.
 */
function isProjectAssetPath(target) {
    return (
        target.startsWith("styles/") ||
        target.startsWith("data/assets/") ||
        vendorFiles.has(target) ||
        /^src\/[^/]+\.js$/.test(target)
    );
}

/**
 * Rewrite a page's project-asset references so they point at the published copy
 * of the same resource, keeping the page's position in the tree.
 *
 * A note at `renderedNotes/<slug>/index.html` sits two levels below the site
 * root, so `../../styles/base.css` stays two levels up; the home page sits at
 * the root and gets `styles/base.css`. A reference made only of `../` markers —
 * the "back to the library" link — means "up to the root" at either depth.
 *
 * @param {string} html - Page source.
 * @param {string} pagePath - Path of the page inside the site, e.g.
 *   `renderedNotes/my-note/index.html`.
 * @returns {string} Page with rewritten references.
 */
export function rewriteAssetReferences(html, pagePath) {
    const pageDirectory = pagePath.includes("/")
        ? pagePath.slice(0, pagePath.lastIndexOf("/"))
        : "";

    const depth =
        pageDirectory === ""
            ? 0
            : pageDirectory.split("/").length;

    const walkUp = "../".repeat(depth);

    return html.replace(
        relativeReferencePattern,
        (match, attribute, reference, suffix) => {
            if (externalReferencePattern.test(reference)) {
                return match;
            }

            const { target } = splitReference(reference);

            if (target === "") {
                // "Back to the root": re-express it at this page's depth.
                return `${attribute}${walkUp || "./"}${suffix}`;
            }

            if (!isProjectAssetPath(target)) {
                return match;
            }

            return `${attribute}${walkUp}${mapProjectPath(
                target
            )}${suffix}`;
        }
    );
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function toPersianDigits(value) {
    return String(value).replace(/\d/g, (digit) =>
        PERSIAN_DIGITS[Number(digit)]
    );
}

/** Shorten an ISO timestamp to a date the reader recognises. */
function formatDate(value) {
    const match = String(value ?? "").match(
        /^(\d{4})-(\d{2})-(\d{2})/
    );

    return match ? `${toPersianDigits(match[3])}/${toPersianDigits(match[2])}/${toPersianDigits(match[1])}` : "";
}

function createNoteCard(note) {
    const facts = [
        { label: "درس", value: note.course },
        { label: "مبحث", value: note.topic },
        { label: "تاریخ تولید", value: formatDate(note.generated) }
    ].filter((fact) => fact.value !== "");

    const factsHtml = facts
        .map(
            (fact) => `
                <span class="noteCardFact">
                    <span class="noteCardFactLabel">${escapeHtml(fact.label)}:</span>
                    <span class="noteCardFactValue">${escapeHtml(fact.value)}</span>
                </span>`
        )
        .join("");

    const searchText = [
        note.title,
        note.course,
        note.topic,
        note.instructor,
        note.slug
    ]
        .filter(Boolean)
        .join(" ");

    return `                <li>
                    <a
                        class="noteCard"
                        href="./renderedNotes/${encodeURIComponent(note.slug)}/"
                        data-search-text="${escapeHtml(searchText)}"
                    >
                        <h2 class="noteCardTitle">${escapeHtml(note.title)}</h2>

                        <span class="noteCardFacts">${factsHtml}</span>

                        <span class="noteCardSlug">${escapeHtml(note.slug)}</span>
                    </a>
                </li>`;
}

/**
 * Render the home page: the library of every note on the site.
 *
 * @param {Object} params
 * @param {string} params.template - Contents of templates/home.html.
 * @param {Array} params.notes - Manifest entries.
 * @returns {string} Home page HTML.
 */
export function renderHomePage({ template, notes }) {
    const replacements = {
        pageTitle: "جزوه‌ساز",
        pageDescription: `کتابخانهٔ جزوه‌های رندرشده — ${toPersianDigits(notes.length)} جزوه`,
        pageFooter: "ساخته‌شده با جزوه‌ساز",
        noteHead: `    <meta name="note-count" content="${notes.length}">`,
        noteList: notes.map(createNoteCard).join("\n")
    };

    return template.replace(
        /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g,
        (placeholder, key) => replacements[key] ?? ""
    );
}

/**
 * Everything a page must provide for the note features to work. Checked per
 * note so a template edit that drops a script fails the build instead of
 * shipping a quietly broken page.
 */
const requiredNoteFeatures = [
    { name: "note body container", pattern: /class="noteContainer"/ },
    { name: "theme stylesheet", pattern: /href="[^"]*styles\/dark\.css"/ },
    { name: "KaTeX stylesheet", pattern: /href="[^"]*katex\.min\.css"/ },
    { name: "lucide icons", pattern: /src="[^"]*lucide\.min\.js"/ },
    { name: "per-note storage id", pattern: /<body[^>]*data-note-slug="/ },
    { name: "search panel", pattern: /class="searchPanel"/ },
    { name: "sticky notes layer", pattern: /class="stickyNotesLayer"/ },
    { name: "highlight switcher", pattern: /class="highlightSwitcher"/ },
    { name: "back to top button", pattern: /class="backToTop"/ },
    { name: "table of contents nav", pattern: /class="sidebarContent"/ },
    { name: "storage helper", pattern: /src="[^"]*noteStorage\.js"/ },
    { name: "library link", pattern: /class="noteNavLink"/ }
];

async function pathExists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check the built site the way a browser would: follow every relative link and
 * assert the note pages still carry the features they advertise.
 *
 * @param {string} siteDirectory - Absolute path of the built site.
 * @returns {Promise<{errors: Array<string>, checkedFiles: number}>}
 */
export async function verifySite(siteDirectory) {
    const errors = [];
    let checkedFiles = 0;

    const htmlFiles = [];

    const walk = async (directory) => {
        for (const entry of await readdir(directory, {
            withFileTypes: true
        })) {
            const path = join(directory, entry.name);

            if (entry.isDirectory()) {
                await walk(path);
            } else if (entry.name.endsWith(".html")) {
                htmlFiles.push(path);
            }
        }
    };

    await walk(siteDirectory);

    for (const filePath of htmlFiles) {
        const html = await readFile(filePath, "utf8");
        const relativePath = filePath.slice(
            siteDirectory.length + 1
        );
        const directory = filePath.slice(
            0,
            filePath.lastIndexOf("/")
        );

        checkedFiles++;

        // Every relative reference must resolve to a real file in the site.
        for (const match of html.matchAll(
            /(?:href|src)\s*=\s*"([^"]*)"/gi
        )) {
            const reference = match[1];

            if (
                externalReferencePattern.test(reference) ||
                reference === ""
            ) {
                continue;
            }

            const resolved = join(
                directory,
                decodeURIComponent(reference.split(/[?#]/)[0])
            );

            if (!(await pathExists(resolved))) {
                errors.push(
                    `${relativePath}: broken reference "${reference}"`
                );
            }
        }

        if (!/<html\b[^>]*\sdata-theme="[^"]*"/.test(html)) {
            errors.push(
                `${relativePath}: <html> has no data-theme`
            );
        }

        if (relativePath.startsWith("renderedNotes/")) {
            for (const feature of requiredNoteFeatures) {
                if (!feature.pattern.test(html)) {
                    errors.push(
                        `${relativePath}: missing ${feature.name}`
                    );
                }
            }

            if (/\{\{[^}]*\}\}/.test(html)) {
                errors.push(
                    `${relativePath}: contains an unreplaced {{placeholder}}`
                );
            }
        }
    }

    return { errors, checkedFiles };
}