// Builds the zip an editor receives for a finished note.
//
// Two modes:
//   review (default) — note.md + note.html + the images it uses. `note.html` is
//                      fully self-contained (styles, scripts, KaTeX fonts and
//                      images are embedded), so it opens offline with nothing
//                      to install and without shipping any Bashligh source.
//   editor           — the note plus the renderer and dashboard *runtime* files
//                      the editing dashboard needs — styles, the note fonts and
//                      scripts — so its preview and exports keep the note's
//                      typography (never node_modules, tests, logs, backups,
//                      other notes or generated outputs).
//
// Kept dependency-free because the bundle is produced by both the CLI
// (Bashligh/shareNote.js) and the dashboard's /api/share endpoint.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { renderNoteHtml } from "./main.js";
import { createZip } from "./zipArchive.js";

const FONT_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

const MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf"
};

const FONT_FORMATS = {
    ".woff2": "woff2",
    ".woff": "woff",
    ".ttf": "truetype",
    ".otf": "opentype"
};

const IMAGE_LINK_PATTERN = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+"[^"]*")?\s*\)/g;
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const SCRIPT_TAG_PATTERN = /<script\b[^>]*><\/script>/gi;
const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)(\s*format\(\s*(['"])([^'"]+)\4\s*\))?/g;

const EDITOR_RENDERER_FILES = ["package.json", "package-lock.json", "templates/note.html", "config/renderer_config.json"];
const EDITOR_DASHBOARD_FILES = ["package.json", "package-lock.json", "README.md", "server.js"];

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const WEB_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".svg", ".json", ".png", ".ico"]);

/* =========================================================
   Small helpers
   ========================================================= */

async function isFile(filePath) {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

function attributeValue(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
    return match ? match[1] : null;
}

function isExternalReference(reference) {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference);
}

function stripQueryAndHash(reference) {
    return reference.split("#")[0].split("?")[0];
}

/** Safe POSIX-ish relative path, or null when the reference escapes the note. */
function toSafeRelativePath(reference) {
    let decoded;
    try {
        decoded = decodeURIComponent(reference);
    } catch {
        decoded = reference;
    }

    const normalized = decoded.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
    if (!normalized) return null;

    const segments = normalized.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === "..")) return null;

    return segments.join("/");
}

function dataUriFor(filePath, buffer) {
    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * ASCII-only archive name.
 *
 * ZIP readers disagree on how to decode non-ASCII entry names (Info-ZIP on a
 * C locale mangles them even with the UTF-8 flag), so the archive and its
 * folder stick to [A-Za-z0-9._-]. The note title is still the HTML/README title.
 */
function createArchiveSlug(notePath) {
    const baseName = path.basename(notePath, path.extname(notePath));
    const slug = baseName
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, 40);

    return slug || "note";
}

function extractNoteTitle(markdown) {
    const match = String(markdown).match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : "";
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Recursively collect files under `root`, filtered to the given extensions. */
async function collectFiles(root, relativeDirectory = "", options = {}) {
    const { extensions = null, excludeSuffixes = [] } = options;
    const results = [];

    let entries;
    try {
        entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
            results.push(...(await collectFiles(root, relativePath, options)));
            continue;
        }
        if (!entry.isFile()) continue;
        if (excludeSuffixes.some((suffix) => entry.name.endsWith(suffix))) continue;

        const extension = path.extname(entry.name).toLowerCase();
        if (extensions && !extensions.has(extension)) continue;

        results.push({
            relativePath,
            absolutePath: path.join(root, relativePath)
        });
    }

    return results;
}

/* =========================================================
   Asset handling
   ========================================================= */

function isInside(directory, root) {
    const resolvedDirectory = path.resolve(directory);
    const resolvedRoot = path.resolve(root);
    return resolvedDirectory === resolvedRoot || resolvedDirectory.startsWith(resolvedRoot + path.sep);
}

function assetCandidates(reference, context) {
    const safeRelative = toSafeRelativePath(reference);
    if (!safeRelative) return [];

    const baseName = path.basename(safeRelative);
    const candidates = [path.resolve(context.noteDirectory, safeRelative)];

    // The renderer's shared asset folder only belongs to notes rendered from
    // `data/`; otherwise an unrelated image with the same name could be picked
    // up from a different note.
    if (isInside(context.noteDirectory, path.join(context.rendererRoot, "data"))) {
        candidates.push(
            path.resolve(context.rendererRoot, "data", "assets", safeRelative),
            path.resolve(context.rendererRoot, "data", "assets", baseName),
            path.resolve(context.rendererRoot, "data", "assets", "assets", baseName)
        );
    }

    candidates.push(
        path.resolve(context.repositoryRoot, "assets", baseName),
        path.resolve(context.repositoryRoot, safeRelative)
    );

    return candidates;
}

/** Resolve a Markdown image reference to a real file, honoring custom resolvers. */
async function resolveImageFile(reference, context) {
    const safeRelative = toSafeRelativePath(reference);
    if (!safeRelative) return null;

    if (typeof context.resolveAsset === "function") {
        const resolved = await context.resolveAsset(safeRelative, context);
        if (resolved) return resolved;
    }

    for (const candidate of new Set(assetCandidates(safeRelative, context))) {
        if (await isFile(candidate)) return candidate;
    }

    return null;
}

/**
 * Resolve every image the note references.
 *
 * @returns {Promise<{files: Array<{zipPath: string, buffer: Buffer}>, mapping: Map<string,string>, warnings: string[]}>}
 */
async function collectNoteAssets(markdown, context) {
    const mapping = new Map();
    const files = [];
    const warnings = [];
    const seenNames = new Set();

    const references = [];
    for (const match of String(markdown).matchAll(IMAGE_LINK_PATTERN)) {
        const rawReference = match[2].replace(/^<|>$/g, "");
        if (isExternalReference(rawReference)) continue;
        if (!references.includes(rawReference)) references.push(rawReference);
    }

    for (const reference of references) {
        const filePath = await resolveImageFile(reference, context);

        if (!filePath) {
            warnings.push(`Image "${reference}" was not found; the note keeps the original link.`);
            continue;
        }

        const baseName = path.basename(filePath);
        const zipPath = `assets/${baseName}`;

        if (seenNames.has(baseName)) {
            const existing = files.find((file) => file.zipPath === zipPath);
            const buffer = await readFile(filePath);
            if (!existing || !existing.buffer.equals(buffer)) {
                warnings.push(`Two different images share the name "${baseName}"; only the first one is bundled.`);
            }
            mapping.set(reference, zipPath);
            continue;
        }

        seenNames.add(baseName);
        files.push({ zipPath, buffer: await readFile(filePath) });
        mapping.set(reference, zipPath);
    }

    return { files, mapping, warnings };
}

/** Point Markdown image links at the bundle's `assets/` folder. */
function rewriteImageLinks(markdown, mapping) {
    return String(markdown).replace(IMAGE_LINK_PATTERN, (full, alt, reference, title) => {
        const rawReference = reference.replace(/^<|>$/g, "");
        const replacement = mapping.get(rawReference);
        if (!replacement) return full;
        return `![${alt}](${replacement}${title || ""})`;
    });
}

/* =========================================================
   Standalone HTML (inline styles, scripts, fonts and images)
   ========================================================= */

/** Resolve a URL that is relative to the rendered note (output/index.html). */
function resolveHtmlReference(reference, context) {
    if (isExternalReference(reference) || reference.startsWith("/")) return null;

    const cleaned = stripQueryAndHash(reference);
    if (!cleaned) return null;

    return path.resolve(context.htmlBaseDirectory, cleaned);
}

async function inlineCssUrls(css, cssDirectory) {
    const matches = [...css.matchAll(CSS_URL_PATTERN)];
    const rawUrls = new Set(matches.map((match) => match[2].trim()));
    const resolved = new Map();

    for (const match of matches) {
        const rawUrl = match[2].trim();
        if (resolved.has(rawUrl)) continue;
        if (isExternalReference(rawUrl) || rawUrl.startsWith("/")) continue;

        const cleaned = stripQueryAndHash(rawUrl);
        if (!cleaned) continue;

        const filePath = path.resolve(cssDirectory, cleaned);
        if (!(await isFile(filePath))) continue;

        const extension = path.extname(filePath).toLowerCase();
        if (!FONT_EXTENSIONS.has(extension)) {
            // Not a font (e.g. a background image): keep it embedded as well.
            resolved.set(rawUrl, { dataUri: dataUriFor(filePath, await readFile(filePath)) });
            continue;
        }

        // Only ship woff2 when the same font family lists a woff2 file; the
        // legacy woff/ttf entries are what make KaTeX bundles needlessly large.
        const woff2Url = rawUrl.replace(/\.(?:woff|ttf|otf)$/i, ".woff2");
        if (extension !== ".woff2" && rawUrls.has(woff2Url)) {
            resolved.set(rawUrl, { drop: true });
            continue;
        }

        resolved.set(rawUrl, {
            dataUri: dataUriFor(filePath, await readFile(filePath)),
            format: FONT_FORMATS[extension]
        });
    }

    return css
        .replace(CSS_URL_PATTERN, (full, quote, rawUrl, formatPart, quote2, formatName) => {
            const info = resolved.get(rawUrl.trim());
            if (!info) return full;
            if (info.drop) return "";
            const format = info.format || formatName;
            return `url("${info.dataUri}")${format ? ` format("${format}")` : ""}`;
        })
        .replace(/,\s*(?=[,;}])/g, "")
        .replace(/src:\s*;/g, "");
}

async function inlineStylesheets(html, context, warnings) {
    const replacements = new Map();

    for (const match of html.matchAll(LINK_TAG_PATTERN)) {
        const tag = match[0];
        const href = attributeValue(tag, "href");
        if (!href) continue;
        if (!/\bstylesheet\b/i.test(tag)) continue;

        if (isExternalReference(href)) continue;

        const filePath = resolveHtmlReference(href, context);
        if (!filePath || !(await isFile(filePath))) {
            warnings.push(`Stylesheet "${href}" was not found and is still linked.`);
            continue;
        }

        const css = await inlineCssUrls(await readFile(filePath, "utf8"), path.dirname(filePath));
        replacements.set(tag, `<style data-bundle-source="${path.basename(filePath)}">\n${css}\n</style>`);
    }

    let result = html;
    for (const [tag, replacement] of replacements) {
        result = result.split(tag).join(replacement);
    }
    return result;
}

async function inlineScripts(html, context, warnings) {
    const replacements = new Map();

    for (const match of html.matchAll(SCRIPT_TAG_PATTERN)) {
        const tag = match[0];
        const source = attributeValue(tag, "src");
        if (!source) continue;

        if (isExternalReference(source)) continue;

        const filePath = resolveHtmlReference(source, context);
        if (!filePath || !(await isFile(filePath))) {
            warnings.push(`Script "${source}" was not found and is still linked.`);
            continue;
        }

        // `lucide.js` ships with the full icon set; the minified build is the
        // same API with a fraction of the bytes.
        let target = filePath;
        if (/lucide\.js$/i.test(filePath)) {
            const minified = filePath.replace(/lucide\.js$/i, "lucide.min.js");
            if (await isFile(minified)) target = minified;
        }

        const content = (await readFile(target, "utf8")).replace(/<\/script/gi, "<\\/script");
        replacements.set(tag, `<script data-bundle-source="${path.basename(target)}">\n${content}\n</script>`);
    }

    let result = html;
    for (const [tag, replacement] of replacements) {
        result = result.split(tag).join(replacement);
    }
    return result;
}

async function inlineImages(html, context) {
    const replacements = new Map();
    const embedded = new Map();
    const warnings = [];

    for (const match of html.matchAll(IMAGE_TAG_PATTERN)) {
        const tag = match[0];
        const source = attributeValue(tag, "src");
        if (!source || isExternalReference(source)) continue;

        // The renderer rewrites note images to "../data/assets/<reference>".
        // When the note lives elsewhere (e.g. a generated note at the project
        // root), fall back to the Markdown reference itself. The HTML path is
        // only used when it exists: the renderer's own data/assets folder is not
        // always present, and returning a path for a missing file would skip the
        // Markdown fallback that *can* find the image.
        const markdownReference = source.replace(/^\.\.\/data\/assets\//, "");
        const htmlPath = resolveHtmlReference(source, context);

        const filePath =
            htmlPath && (await isFile(htmlPath))
                ? htmlPath
                : markdownReference !== source
                  ? await resolveImageFile(markdownReference, context)
                  : htmlPath;

        if (!filePath || !(await isFile(filePath))) {
            warnings.push(`Image "${source}" is missing from the export; it was left as a link.`);
            continue;
        }

        if (!embedded.has(filePath)) {
            embedded.set(filePath, dataUriFor(filePath, await readFile(filePath)));
        }

        const replacementTag = tag.replace(/\bsrc="[^"]*"/i, `src="${embedded.get(filePath)}"`);
        replacements.set(tag, replacementTag);
    }

    let result = html;
    for (const [tag, replacement] of replacements) {
        result = result.split(tag).join(replacement);
    }

    return { html: result, warnings };
}

/**
 * Render the note and inline everything it needs into a single HTML document.
 *
 * @returns {Promise<{html: string, title: string, warnings: string[]}>}
 */
export async function buildStandaloneHtml({ markdown, rendererRoot, noteDirectory, resolveAsset }) {
    const template = await readFile(path.join(rendererRoot, "templates", "note.html"), "utf8");
    const rendererConfig = JSON.parse(
        await readFile(path.join(rendererRoot, "config", "renderer_config.json"), "utf8")
    );

    const { html, title } = renderNoteHtml(markdown, { template, rendererConfig });

    const context = {
        rendererRoot,
        noteDirectory,
        // Same repository root the dashboard uses (dashboard/src/noteStore.js),
        // so a note anywhere in the tree can resolve the project-level assets/.
        repositoryRoot: path.resolve(rendererRoot, "..", ".."),
        htmlBaseDirectory: path.join(rendererRoot, "output"),
        resolveAsset
    };

    const warnings = [];
    let result = await inlineStylesheets(html, context, warnings);
    result = await inlineScripts(result, context, warnings);

    const images = await inlineImages(result, context);
    result = images.html;
    warnings.push(...images.warnings);

    return { html: result, title, warnings };
}

/* =========================================================
   Renderer + dashboard runtime files (editor mode)
   ========================================================= */

async function collectEditorFiles(rendererRoot, dashboardRoot) {
    // The bundle mirrors the project layout (Bashligh/note_renderer/dashboard)
    // so the dashboard's own relative imports and repository-root assumptions
    // keep working without a second, bundle-only code path.
    const rendererPrefix = "Bashligh/note_renderer";
    const files = [];

    const addRendererFile = async (relativePath) => {
        const absolutePath = path.join(rendererRoot, relativePath);
        if (!(await isFile(absolutePath))) return;
        files.push({ zipPath: `${rendererPrefix}/${relativePath}`, buffer: await readFile(absolutePath) });
    };

    for (const relativePath of EDITOR_RENDERER_FILES) {
        await addRendererFile(relativePath);
    }

    const rendererSource = await collectFiles(rendererRoot, "src", {
        extensions: SCRIPT_EXTENSIONS,
        excludeSuffixes: [".backup"]
    });
    for (const file of rendererSource) {
        files.push({ zipPath: `${rendererPrefix}/${file.relativePath}`, buffer: await readFile(file.absolutePath) });
    }

    const rendererStyles = await collectFiles(rendererRoot, "styles", { extensions: STYLE_EXTENSIONS });
    for (const file of rendererStyles) {
        files.push({ zipPath: `${rendererPrefix}/${file.relativePath}`, buffer: await readFile(file.absolutePath) });
    }

    // styles/base.css loads the note fonts from "../assets/fonts/…". Shipping
    // the styles without them leaves the extracted dashboard, its preview and
    // its exports on a system font, so the fonts travel with the bundle.
    const rendererFonts = await collectFiles(rendererRoot, "assets", {
        extensions: FONT_EXTENSIONS
    });
    for (const file of rendererFonts) {
        files.push({ zipPath: `${rendererPrefix}/${file.relativePath}`, buffer: await readFile(file.absolutePath) });
    }

    const dashboardPrefix = `${rendererPrefix}/dashboard`;

    for (const relativePath of EDITOR_DASHBOARD_FILES) {
        const absolutePath = path.join(dashboardRoot, relativePath);
        if (!(await isFile(absolutePath))) continue;
        files.push({ zipPath: `${dashboardPrefix}/${relativePath}`, buffer: await readFile(absolutePath) });
    }

    const dashboardSource = await collectFiles(dashboardRoot, "src", { extensions: SCRIPT_EXTENSIONS });
    for (const file of dashboardSource) {
        files.push({ zipPath: `${dashboardPrefix}/${file.relativePath}`, buffer: await readFile(file.absolutePath) });
    }

    const dashboardPublic = await collectFiles(dashboardRoot, "public", { extensions: WEB_EXTENSIONS });
    for (const file of dashboardPublic) {
        files.push({ zipPath: `${dashboardPrefix}/${file.relativePath}`, buffer: await readFile(file.absolutePath) });
    }

    return files;
}

/* =========================================================
   README files
   ========================================================= */

function reviewReadme({ title, generatedAt }) {
    return `Bashligh note bundle${title ? ` — ${title}` : ""}

What is inside
  note.html   The rendered note. Open it in any modern browser (double-click).
              Everything it needs is embedded, so it works offline and on its own.
  note.md     Markdown source of the note.
  assets/     Images used by note.md (and embedded in note.html).

This bundle deliberately contains only the note: no renderer/dashboard source,
no node_modules, no build or test files. Nothing needs to be installed.

Generated ${generatedAt} by Bashligh.
`;
}

function editorReadme({ title, generatedAt }) {
    return `Bashligh editable note bundle${title ? ` — ${title}` : ""}

What is inside
  Bashligh/note_renderer/            Renderer, styles and the note
                                    (data/input/note.md + data/assets/)
  Bashligh/note_renderer/dashboard/ Human editing dashboard

How to edit
  1. Install Node.js 20 or newer.
  2. cd Bashligh/note_renderer && npm install
  3. cd Bashligh/note_renderer/dashboard && npm start
  4. Open http://127.0.0.1:4600, click "Open" and choose
     Bashligh/note_renderer/data/input/note.md.
     Saving writes an edited copy next to it; Export writes output/<name>.html.

node_modules is intentionally not shipped: "npm install" fetches the renderer's
dependencies once. The dashboard has no separate runtime dependencies.

Generated ${generatedAt} by Bashligh.
`;
}

/* =========================================================
   Public entry point
   ========================================================= */

/**
 * Build the share bundle for a note.
 *
 * @param {Object} options
 * @param {string} options.markdown - note source to share
 * @param {string} options.notePath - path of the source .md file
 * @param {string} options.rendererRoot - Bashligh/note_renderer
 * @param {"review"|"editor"} [options.mode]
 * @param {Function} [options.resolveAsset] - custom async (reference) => absolute path
 * @returns {Promise<{fileName: string, buffer: Buffer, mode: string, files: Array, warnings: string[], stats: Object}>}
 */
export async function buildShareBundle(options) {
    const markdown = String(options.markdown ?? "");
    const mode = options.mode === "editor" ? "editor" : "review";
    const rendererRoot = path.resolve(options.rendererRoot);
    const notePath = path.resolve(options.notePath);
    const noteDirectory = path.dirname(notePath);

    const title = extractNoteTitle(markdown);
    const slug = createArchiveSlug(notePath);
    const generatedAt = new Date().toISOString();

    const context = {
        rendererRoot,
        noteDirectory,
        // Same repository root the dashboard uses (dashboard/src/noteStore.js),
        // so a note anywhere in the tree can resolve the project-level assets/.
        repositoryRoot: path.resolve(rendererRoot, "..", ".."),
        resolveAsset: options.resolveAsset
    };

    const warnings = [];
    const assets = await collectNoteAssets(markdown, context);
    warnings.push(...assets.warnings);

    const sharedMarkdown = rewriteImageLinks(markdown, assets.mapping);
    const entries = [];

    if (mode === "review") {
        const standalone = await buildStandaloneHtml({
            markdown,
            rendererRoot,
            noteDirectory,
            resolveAsset: options.resolveAsset
        });
        warnings.push(...standalone.warnings);

        entries.push(
            { name: `${slug}/note.md`, data: sharedMarkdown },
            { name: `${slug}/note.html`, data: standalone.html }
        );

        for (const asset of assets.files) {
            entries.push({ name: `${slug}/${asset.zipPath}`, data: asset.buffer });
        }

        entries.push({
            name: `${slug}/README.txt`,
            data: reviewReadme({ title: standalone.title || title, generatedAt })
        });
    } else {
        const dashboardRoot = path.join(rendererRoot, "dashboard");
        const editorFiles = await collectEditorFiles(rendererRoot, dashboardRoot);

        const editorRendererPrefix = `${slug}/Bashligh/note_renderer`;

        entries.push({
            name: `${editorRendererPrefix}/data/input/note.md`,
            data: sharedMarkdown
        });

        for (const file of editorFiles) {
            entries.push({ name: `${slug}/${file.zipPath}`, data: file.buffer });
        }

        // The dashboard resolves both "image.jpg" and "assets/image.jpg", so the
        // referenced images are shipped in both layouts it looks at.
        for (const asset of assets.files) {
            const baseName = path.basename(asset.zipPath);
            entries.push({ name: `${editorRendererPrefix}/data/${asset.zipPath}`, data: asset.buffer });
            entries.push({
                name: `${editorRendererPrefix}/data/assets/assets/${baseName}`,
                data: asset.buffer
            });
        }

        entries.push({
            name: `${slug}/README.txt`,
            data: editorReadme({ title, generatedAt })
        });
    }

    const buffer = createZip(entries);
    const looseSize = entries.reduce((total, entry) => total + Buffer.byteLength(entry.data), 0);

    return {
        fileName: `${slug}-${mode === "review" ? "share" : "editable"}.zip`,
        buffer,
        mode,
        title: title || slug,
        files: entries.map((entry) => entry.name),
        warnings,
        stats: {
            entries: entries.length,
            looseSize,
            zipSize: buffer.length,
            formattedLooseSize: formatBytes(looseSize),
            formattedZipSize: formatBytes(buffer.length)
        }
    };
}

export { formatBytes };

/** Attachment header that is safe for non-ASCII (e.g. Persian) file names. */
export function contentDispositionFor(fileName) {
    const asciiFallback = String(fileName)
        .normalize("NFKD")
        .replace(/[^\x20-\x7e]/g, "_")
        .replace(/["\\]/g, "_");

    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
