// Builds the final note HTML by handing the edited Markdown to Bashligh's own
// renderer (`src/main.js → renderNoteHtml`), then points the generated image
// references at the note's real asset folder relative to the export location.
//
// Reusing renderNoteHtml guarantees the dashboard can never produce a second,
// drifting HTML format: templates, CSS/JS bundles, KaTeX, callouts, table of
// contents and sanitization all come from the renderer itself.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { renderNoteHtml } from "../../src/main.js";
import { noteRendererRoot, resolveAssetFile } from "./noteStore.js";

const IMAGE_SOURCE_PATTERN = /(<img\b[^>]*\bsrc=")([^"]+)(")/gi;
const ASSET_PREFIX = "../data/assets/";

let templateCache = null;
let rendererConfigCache = null;

export async function getTemplate() {
    if (!templateCache) {
        templateCache = await readFile(path.join(noteRendererRoot, "templates", "note.html"), "utf8");
    }
    return templateCache;
}

export async function getRendererConfig() {
    if (!rendererConfigCache) {
        const raw = await readFile(
            path.join(noteRendererRoot, "config", "renderer_config.json"),
            "utf8"
        );
        rendererConfigCache = JSON.parse(raw);
    }
    return rendererConfigCache;
}

/** Where Bashligh itself writes rendered notes (output/ next to the template). */
export function getExportPath(note) {
    const baseName = path.basename(note.baseName, path.extname(note.baseName)) || "index";
    return path.join(noteRendererRoot, "output", `${baseName}.html`);
}

/**
 * Run the edited Markdown through the Bashligh renderer.
 *
 * @param {string} markdown
 * @param {Object} note - entry from noteStore (used to resolve assets)
 * @param {Object} [options]
 * @param {string} [options.exportPath] - target file, used to relativize images
 * @returns {Promise<{html: string, title: string, metadata: Object, tocItems: Array, missingImages: string[]}>}
 */
export async function buildExportHtml(markdown, note, options = {}) {
    const template = await getTemplate();
    const rendererConfig = await getRendererConfig();

    const { html, title, metadata, tocItems } = renderNoteHtml(markdown, {
        template,
        rendererConfig
    });

    const exportPath = options.exportPath || getExportPath(note);
    const missingImages = [];

    // Resolution is async, so sources are collected first and substituted in a
    // second synchronous pass over the rendered HTML.
    const resolvedSources = new Map();

    const collectPattern = /(<img\b[^>]*\bsrc=")([^"]+)(")/gi;
    let match;

    while ((match = collectPattern.exec(html)) !== null) {
        const source = match[2];
        if (resolvedSources.has(source)) continue;

        const reference = source.startsWith(ASSET_PREFIX)
            ? source.slice(ASSET_PREFIX.length)
            : source;

        if (/^(https?:)?\/\//i.test(source) || source.startsWith("data:")) {
            resolvedSources.set(source, source);
            continue;
        }

        const file = await resolveAssetFile(note, reference);
        if (!file) {
            missingImages.push(reference);
            resolvedSources.set(source, source);
            continue;
        }

        const relative = path
            .relative(path.dirname(exportPath), file)
            .split(path.sep)
            .join("/");

        resolvedSources.set(source, relative.startsWith(".") ? relative : `./${relative}`);
    }

    const finalHtml = html.replace(
        IMAGE_SOURCE_PATTERN,
        (fullMatch, prefix, source, suffix) =>
            `${prefix}${resolvedSources.get(source) ?? source}${suffix}`
    );

    return { html: finalHtml, title, metadata, tocItems, missingImages };
}

/**
 * Render and write the final HTML next to Bashligh's own output files.
 * @returns {Promise<{exportPath: string, relativePath: string, missingImages: string[]}>}
 */
export async function exportNote(note, markdown) {
    const exportPath = getExportPath(note);
    const { html, missingImages } = await buildExportHtml(markdown, note, { exportPath });

    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(exportPath, html, "utf8");

    return {
        exportPath,
        relativePath: path.relative(noteRendererRoot, exportPath).split(path.sep).join("/"),
        missingImages
    };
}

/** Preview HTML: same renderer, but asset URLs rewritten to dashboard routes. */
export async function buildPreviewHtml(markdown, note, previewPath) {
    const template = await getTemplate();
    const rendererConfig = await getRendererConfig();

    const { html } = renderNoteHtml(markdown, { template, rendererConfig });

    const previewHtml = html.replace(IMAGE_SOURCE_PATTERN, (fullMatch, prefix, source, suffix) => {
        if (!source.startsWith(ASSET_PREFIX)) return fullMatch;
        const reference = source.slice(ASSET_PREFIX.length);
        const encoded = reference.split("/").map(encodeURIComponent).join("/");
        return `${prefix}/data/${note.id}/${encoded}${suffix}`;
    });

    void previewPath;
    return previewHtml;
}
