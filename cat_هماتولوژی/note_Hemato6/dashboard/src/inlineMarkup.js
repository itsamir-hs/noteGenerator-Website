// Converts inline Markdown into display HTML for the visual editor and back.
//
// Editing happens on rendered HTML (so the operator never has to type Markdown
// markers) while the document model keeps Markdown as the source of truth.
// Inline LaTeX is replaced by a placeholder token before parsing so `marked`
// can never reinterpret characters such as `_` or `*` inside a formula.

import { marked } from "marked";

// Private-use characters survive marked untouched and cannot occur in notes.
const MATH_TOKEN_START = "\uE000";
const MATH_TOKEN_END = "\uE001";
const INLINE_MATH_PATTERN = /\$[^$\n]+?\$/g;
const MATH_TOKEN_PATTERN = new RegExp(`${MATH_TOKEN_START}(\\d+)${MATH_TOKEN_END}`, "g");

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Render inline Markdown to HTML the operator can edit directly.
 * @param {string} inlineMarkdown
 * @returns {string}
 */
export function renderInlineForEditing(inlineMarkdown) {
    const source = String(inlineMarkdown ?? "");
    const mathSources = [];

    const protectedSource = source.replace(INLINE_MATH_PATTERN, (match) => {
        const tokenIndex = mathSources.length;
        mathSources.push(match);
        return `${MATH_TOKEN_START}${tokenIndex}${MATH_TOKEN_END}`;
    });

    let html;
    try {
        html = marked.parseInline(protectedSource);
    } catch {
        // Never lose content: fall back to escaped plain text.
        html = escapeHtml(protectedSource);
    }

    html = html.replace(MATH_TOKEN_PATTERN, (_, tokenIndex) => {
        const mathSource = mathSources[Number(tokenIndex)] ?? "";
        return `<span class="inlineMathSource">${escapeHtml(mathSource)}</span>`;
    });

    return html;
}

function serializeElementNode(element) {
    const tagName = element.tagName;

    if (tagName === "BR") return "\n";

    if (tagName === "SPAN" && element.classList.contains("inlineMathSource")) {
        return element.textContent;
    }

    const innerContent = serializeChildren(element);

    switch (tagName) {
        case "STRONG":
        case "B":
            return wrapEmphasis(innerContent, "**");
        case "EM":
        case "I":
            return wrapEmphasis(innerContent, "*");
        case "DEL":
        case "S":
            return wrapEmphasis(innerContent, "~~");
        case "CODE":
            return wrapEmphasis(innerContent, "`");
        case "A": {
            const href = element.getAttribute("href") || "";
            const label = innerContent.trim() || escapeLinkText(href);
            return `[${label}](${escapeLinkTarget(href)})`;
        }
        case "IMG": {
            const alt = element.getAttribute("alt") || "";
            const src = element.getAttribute("src") || "";
            return `![${alt}](${src})`;
        }
        case "DIV":
        case "P":
            // Block-level nodes created by pasting become line breaks; their
            // content is kept as inline Markdown so nothing is dropped.
            return `${innerContent}\n`;
        default:
            // Pasted markup (`<span data-…>`, `<font style=…>`, editor residue…)
            // must never leak into the note as raw HTML: the renderer would
            // drop or mistrust those attributes and the preview would differ
            // from the editor. Keep the content as inline Markdown and drop
            // the wrapper. Real block structures and pasted math are kept
            // verbatim so nothing structural is lost.
            if (KEPT_HTML_TAGS.has(tagName) || containsKatex(element)) {
                return element.outerHTML;
            }
            return innerContent;
    }
}

// Semantic inline tags worth keeping as clean HTML (no attributes), plus
// block-level structures that must survive a paste unchanged.
const KEPT_HTML_TAGS = new Set([
    "U", "MARK", "SUB", "SUP",
    "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
    "UL", "OL", "LI", "PRE", "BLOCKQUOTE", "HR",
    "H1", "H2", "H3", "H4", "H5", "H6", "FIGURE", "FIGCAPTION"
]);

/** True when the element holds (or contains) rendered KaTeX markup. */
function containsKatex(element) {
    if (element.classList) {
        for (const name of element.classList) {
            if (name.startsWith("katex")) return true;
        }
    }
    return Boolean(element.querySelector && element.querySelector("[class*='katex']"));
}

/**
 * Wrap inline content in emphasis markers.
 * Markdown only honours `**bold**` when the delimiters hug the text: a
 * selection that happens to include a trailing space would otherwise produce
 * `**text **`, which the renderer shows as literal asterisks in the preview.
 */
function wrapEmphasis(content, marker) {
    const leading = content.match(/^\s*/)[0];
    const trailing = content.match(/\s*$/)[0];
    const core = content.slice(leading.length, content.length - trailing.length);

    // Empty emphasis (`****`) renders as literal asterisks; drop it.
    if (core === "") return leading + trailing;

    return `${leading}${marker}${core}${marker}${trailing}`;
}

/** Link labels must not contain unescaped brackets. */
function escapeLinkText(value) {
    return String(value ?? "").replace(/([\[\]])/g, "\\$1");
}

/** A link target may not contain spaces or unbalanced parentheses. */
function escapeLinkTarget(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, "%20")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
}

function serializeChildren(element) {
    return Array.from(element.childNodes)
        .map((childNode) => serializeNode(childNode))
        .join("");
}

function serializeNode(node) {
    if (node.nodeType === 3) return node.nodeValue; // TEXT_NODE
    if (node.nodeType === 1) return serializeElementNode(node); // ELEMENT_NODE
    return "";
}

/**
 * Convert an edited contenteditable element back into inline Markdown.
 * @param {Element} container
 * @returns {string}
 */
export function serializeInlineHtml(container) {
    if (!container) return "";
    return serializeChildren(container).replace(/\u00a0/g, " ").trim();
}

/** Plain text of an inline Markdown fragment (used by outline/search labels). */
export function inlineToPlainText(inlineMarkdown) {
    return renderInlineForEditing(inlineMarkdown)
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

/** Extract the inline LaTeX fragments of a text block (for math checks). */
export function extractInlineMath(inlineMarkdown) {
    const source = String(inlineMarkdown ?? "");
    const matches = [];
    let match;

    const pattern = new RegExp(INLINE_MATH_PATTERN.source, "g");
    while ((match = pattern.exec(source)) !== null) {
        matches.push(match[0]);
    }

    return matches;
}

