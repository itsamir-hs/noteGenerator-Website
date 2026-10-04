// Post-processing for note HTML produced (or imported) by the site layer.
//
// `templates/note.html` assumes it lives exactly one directory below the project
// root: it links `../styles/…`, `../src/…`, `../node_modules/…` and the renderer
// rewrites images to `../data/assets/…`.
//
// On this site every note lives in `notes/<slug>/index.html`, i.e. TWO levels
// below the root, so those references have to be re-pointed. The template and
// the renderer are never modified: this module rewrites the *generated output*
// only.

import { SITE_CONFIG } from "./config.js";

/**
 * Directories that live at the project root. Any attribute value that walks up
 * to the root and then enters one of them is re-anchored to the page's real
 * depth.
 */
const ROOT_RELATIVE_PREFIXES = [
    "styles/",
    "src/",
    "node_modules/",
    "templates/",
    "vendor/",
    "site/",
    "data/assets/"
];

/** node_modules paths are replaced by the vendored, self-contained copies. */
const NODE_MODULE_REPLACEMENTS = [
    {
        pattern: /^node_modules\/katex\/dist\/katex\.min\.css$/,
        replacement: "vendor/katex/katex.min.css"
    },
    {
        pattern: /^node_modules\/lucide\/dist\/umd\/lucide\.js$/,
        replacement: "vendor/lucide/lucide.min.js"
    }
];

const ATTRIBUTE_PATTERN = /(\s(?:href|src)\s*=\s*")([^"]*)(")/g;

/**
 * Re-anchor one root-relative reference to `depth` levels below the root.
 * Non-root-relative values (anchors, absolute URLs, data URIs) pass through.
 */
export function rewriteReferencePath(value, depth) {
    const match = String(value).match(/^((?:\.\.\/)+)(.+)$/);

    if (!match) {
        return value;
    }

    let target = match[2];

    if (!ROOT_RELATIVE_PREFIXES.some((prefix) => target.startsWith(prefix))) {
        return value;
    }

    for (const { pattern, replacement } of NODE_MODULE_REPLACEMENTS) {
        if (pattern.test(target)) {
            target = replacement;
            break;
        }
    }

    return "../".repeat(Math.max(1, depth)) + target;
}

/** Rewrite every `href`/`src` in a note document for its real nesting depth. */
export function rewriteNoteAssetPaths(html, { depth = 2 } = {}) {
    return String(html).replace(
        ATTRIBUTE_PATTERN,
        (_, prefix, value, suffix) =>
            `${prefix}${rewriteReferencePath(value, depth)}${suffix}`
    );
}

/** Every local href/src of a note document, for link checking and warnings. */
export function collectNoteAssetReferences(html) {
    const references = [];

    for (const match of String(html).matchAll(ATTRIBUTE_PATTERN)) {
        references.push(match[2]);
    }

    return references;
}

/** Insert `snippet` before the first `marker`, or append when it is missing. */
export function insertBefore(html, marker, snippet) {
    const index = String(html).indexOf(marker);

    if (index === -1) {
        return `${html}${snippet}`;
    }

    return `${String(html).slice(0, index)}${snippet}${String(html).slice(index)}`;
}

/** Insert `snippet` right after the first `marker`. */
export function insertAfter(html, marker, snippet) {
    const index = String(html).indexOf(marker);

    if (index === -1) {
        return `${html}${snippet}`;
    }

    return `${String(html).slice(0, index + marker.length)}${snippet}${String(html).slice(index + marker.length)}`;
}

/**
 * Add the site layer's own assets to a note page:
 *
 *  - `noteNav.css`          → styles for the injected "back to home" control
 *  - `noteStorageScope.js`  → per-note localStorage namespacing (see config)
 *  - `noteHomeLink.js`      → injects the "back to home" button at runtime
 *
 * The storage scope script MUST come before any of the original scripts because
 * it swaps the localStorage accessor they read from.
 */
export function injectNoteAssets(html, { slug, depth = 2, enableStorageScoping = true } = {}) {
    const prefix = "../".repeat(Math.max(1, depth));
    const assetDirectory = SITE_CONFIG.noteAssetDirectoryName;

    let output = String(html);

    if (enableStorageScoping) {
        const scopeScript = `\n    <script src="${prefix}${assetDirectory}/${SITE_CONFIG.noteStorageScopeScriptFileName}" data-note-scope="${slug}"></script>`;

        output = insertAfter(output, "<head>", scopeScript);
    }

    /*
     * The template hardcodes data-theme="light" on <html> and only applies the
     * stored theme at the end of <body>, which flashes white on every load for
     * anyone who picked a dark theme. themeBoot.js runs here, in <head>, i.e.
     * before the stylesheets and therefore before the first paint.
     */
    const themeBootScript = `\n    <script src="${prefix}${assetDirectory}/${SITE_CONFIG.noteThemeBootScriptFileName}"></script>`;

    output = insertAfter(output, "<head>", themeBootScript);

    const styleTag = `
    <link rel="stylesheet" href="${prefix}${assetDirectory}/${SITE_CONFIG.noteNavStyleFileName}">
`;

    output = insertBefore(output, "</head>", styleTag);

    const homeScript = `
    <script src="${prefix}${assetDirectory}/${SITE_CONFIG.noteHomeLinkScriptFileName}" defer></script>
`;

    output = insertBefore(output, "</body>", homeScript);

    return output;
}

/** Run every note-page transformation in the right order. */
export function finalizeNoteHtml(html, { slug, depth = 2, enableStorageScoping = true } = {}) {
    return injectNoteAssets(rewriteNoteAssetPaths(html, { depth }), {
        slug,
        depth,
        enableStorageScoping
    });
}