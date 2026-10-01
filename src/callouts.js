// Transforms Markdown blockquotes into Bashligh callout boxes.
//
// Two conventions are recognised, both operating on already-rendered HTML so
// this module stays dependency-free and can be imported by the Node renderer
// and by the browser-based editing dashboard from the SAME source:
//
//   1. GitHub-style alerts —  > [!IMPORTANT] Title  →  <div class="calloutBox ...">
//   2. Definition boxes    —  > **تعریف ...**       →  <blockquote class="definitionBox">
//
// Keeping one implementation is what guarantees the dashboard preview and the
// exported note render identical markup.

const CALLOUT_LABELS = {
    note: "Note",
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    caution: "Caution",
    definition: "Definition",
    example: "Example",
    "exam-tip": "Exam Tip",
    "key-point": "Key Point",
    review: "Review",
    custom: "Custom"
};

/** Supported callout type keys, in a stable order (used by the editor UI). */
export const CALLOUT_TYPES = Object.keys(CALLOUT_LABELS);

/** Human-readable label for a callout type key. */
export function getCalloutLabel(type) {
    return CALLOUT_LABELS[type] || CALLOUT_LABELS.custom;
}

/** Fold an arbitrary alert marker ("Exam Tip", "KEY_POINT") into a type key. */
export function normalizeCalloutType(rawType) {
    const key = String(rawType || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_/]+/g, "-")
        .replace(/-+/g, "-");

    return Object.prototype.hasOwnProperty.call(CALLOUT_LABELS, key) ? key : "custom";
}

function toPlainText(htmlFragment) {
    return String(htmlFragment)
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Build the callout element for one converted blockquote.
 * `remainder` is the text that followed the [!TYPE] marker inside the first
 * paragraph; `restHtml` is every following paragraph of the blockquote.
 */
function buildCalloutBox(type, remainder, restHtml) {
    const label = getCalloutLabel(type);

    // Multi-paragraph alerts carry the title on its own line/paragraph, while a
    // single-paragraph alert may inline it: "[!TIP] Title\nbody line".
    const firstLineBreak = remainder.indexOf("\n");
    let titleSource;
    let inlineBody;

    if (restHtml.trim() !== "") {
        titleSource = remainder;
        inlineBody = "";
    } else if (firstLineBreak !== -1) {
        titleSource = remainder.slice(0, firstLineBreak);
        inlineBody = remainder.slice(firstLineBreak + 1).trim();
    } else {
        titleSource = remainder;
        inlineBody = "";
    }

    const title = toPlainText(titleSource) || label;

    const bodyParts = [];
    if (inlineBody) bodyParts.push(`<p>${escapeHtml(inlineBody)}</p>`);
    if (restHtml.trim() !== "") bodyParts.push(restHtml.trim());

    return (
        `<div class="calloutBox calloutBox--${type}" data-callout="${type}">` +
        `<p class="calloutBoxTitle">${escapeHtml(title)}</p>` +
        bodyParts.join("") +
        `</div>`
    );
}

/** Convert one blockquote's inner HTML, or return null to leave it untouched. */
function transformBlockquoteInner(innerHtml) {
    // Nested blockquotes are left alone — the non-greedy outer match would
    // otherwise mis-slice their content.
    if (/<blockquote\b/i.test(innerHtml)) return null;

    const paragraphMatch = innerHtml.match(/^\s*<p(?:\s[^>]*)?>([\s\S]*?)<\/p>([\s\S]*)$/);
    if (!paragraphMatch) return null;

    const firstParagraph = paragraphMatch[1];
    const restHtml = paragraphMatch[2] || "";

    const markerMatch = firstParagraph.match(/^\s*\[!([A-Za-z][A-Za-z0-9 _/-]*)\]\s*([\s\S]*)$/);
    if (markerMatch) {
        const type = normalizeCalloutType(markerMatch[1]);
        return buildCalloutBox(type, markerMatch[2].trim(), restHtml);
    }

    // Definition boxes reuse Bashligh's existing `.definitionBox` convention.
    const strongMatch = firstParagraph.match(/^\s*<strong>([\s\S]*?)<\/strong>/);
    if (strongMatch && /^تعریف/.test(toPlainText(strongMatch[1]))) {
        return `<blockquote class="definitionBox">${innerHtml}</blockquote>`;
    }

    return null;
}

/**
 * Apply both callout conventions to rendered HTML.
 * @param {string} htmlContent
 * @returns {string}
 */
export function applyCallouts(htmlContent) {
    if (typeof htmlContent !== "string" || htmlContent.indexOf("<blockquote") === -1) {
        return htmlContent;
    }

    return htmlContent.replace(
        /<blockquote>([\s\S]*?)<\/blockquote>/g,
        (match, innerHtml) => transformBlockquoteInner(innerHtml) ?? match
    );
}
