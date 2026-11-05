// Contenteditable helpers: render inline Markdown for editing, read it back
// and implement the caret operations the block editor relies on.

import {
    renderInlineForEditing,
    serializeInlineHtml
} from "/dashboard/src/inlineMarkup.js";
import { assetUrlFor } from "./assetUrls.js";

/** Paint inline Markdown into an editable element. */
export function renderInline(element, inlineMarkdown) {
    element.innerHTML = renderInlineForEditing(inlineMarkdown || "");
    resolveEditorImages(element);
}

/**
 * Point images embedded in inline Markdown at the dashboard's asset URLs.
 *
 * `marked` paints them with the note-relative Markdown path
 * (`assets/photo.png`), which would 404 against the dashboard's origin — the
 * photo then shows as a broken placeholder in the editor while the preview
 * (which rewrites to `/data/<noteId>/…`) shows it fine. The Markdown path is
 * kept in `data-markdown-src`, so serialization writes the note's own image
 * reference back instead of the internal dashboard URL.
 */
function resolveEditorImages(element) {
    if (!element || !element.querySelectorAll) return;

    for (const image of element.querySelectorAll("img")) {
        const source = image.getAttribute("src") || "";
        // Already absolute (http(s):, data:, //, page-absolute) or empty:
        // nothing to resolve.
        if (!source || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(source)) continue;

        const resolved = assetUrlFor(source);
        if (!resolved) continue;

        image.setAttribute("data-markdown-src", source);
        image.setAttribute("src", resolved);
    }
}

/** Read inline Markdown back out of an editable element. */
export function readInline(element) {
    return serializeInlineHtml(element);
}

/** Convert a raw HTML fragment (the tail of a split) into inline Markdown. */
export function htmlToInlineMarkdown(html, ownerDocument = document) {
    const holder = ownerDocument.createElement("div");
    holder.innerHTML = html || "";
    return serializeInlineHtml(holder);
}

/* =========================================================
   Selection memory

   Clicking a toolbar button (or a shortcut landing on the document) moves the
   focus away from the block being edited, which normally destroys the caret
   inside it. Remembering the last selection inside a block editable lets the
   formatting commands put it back before they run.
   ========================================================= */

let rememberedSelection = null;

function editableFromNode(node) {
    if (!node) return null;
    const element = node.nodeType === 1 ? node : node.parentElement;
    return element && element.closest
        ? element.closest('.docBlock [contenteditable="true"]')
        : null;
}

/** Start remembering the caret inside block editables (called once at boot). */
export function watchSelection() {
    document.addEventListener("selectionchange", () => {
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const editable = editableFromNode(range.commonAncestorContainer);
        if (!editable || !editable.isConnected) return;

        rememberedSelection = { element: editable, range: range.cloneRange() };
    });
}

/** The editable whose caret was used last (null when it is gone). */
export function rememberedEditable() {
    if (!rememberedSelection) return null;
    if (!rememberedSelection.element.isConnected) {
        rememberedSelection = null;
        return null;
    }
    return rememberedSelection.element;
}

/** Focus `element` and put the remembered selection (or the end caret) back. */
export function restoreSelectionInto(element) {
    const target = element || rememberedEditable();
    if (!target) return null;

    const selection = target.ownerDocument.getSelection();

    // A live selection already inside the target is the operator's latest
    // intent — never replace it with a remembered (older) range.
    if (selection && selection.rangeCount > 0) {
        const live = selection.getRangeAt(0);
        const container = live.commonAncestorContainer;
        const node = container.nodeType === 1 ? container : container.parentElement;
        if (node && target.contains(node)) {
            if (document.activeElement !== target) target.focus();
            return target;
        }
    }

    target.focus();

    if (!selection) return target;

    const remembered =
        rememberedSelection && rememberedSelection.element === target
            ? rememberedSelection.range
            : null;

    if (remembered && target.contains(remembered.commonAncestorContainer)) {
        selection.removeAllRanges();
        selection.addRange(remembered);
        return target;
    }

    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return target;
}

/**
 * Pull the edges of a range inwards so it no longer covers leading/trailing
 * whitespace. A selection made by dragging often includes the space before
 * the next word; wrapping that space inside `**…**` produces `**text **`,
 * which Markdown does not treat as emphasis — the preview would then show
 * literal asterisks while the editor still looked bold.
 */
function trimRangeEdges(range) {
    const text = range.toString();
    const leading = text.match(/^\s*/)[0].length;
    const trailing = text.match(/\s*$/)[0].length;

    if (leading === 0 && trailing === 0) return;
    if (leading + trailing >= text.length) return; // all whitespace: leave it

    if (range.startContainer.nodeType === 3 && range.endContainer.nodeType === 3) {
        range.setStart(range.startContainer, range.startOffset + leading);
        range.setEnd(range.endContainer, range.endOffset - trailing);
    }
}

function getSelectionIn(element) {
    const selection = element.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const inside =
        element.contains(range.commonAncestorContainer) ||
        range.commonAncestorContainer === element;

    return inside ? range : null;
}

/** True when the caret sits before the first character of the element. */
export function isCaretAtStart(element) {
    const range = getSelectionIn(element);
    if (!range || !range.collapsed) return false;

    const probe = element.ownerDocument.createRange();
    probe.selectNodeContents(element);
    probe.setEnd(range.startContainer, range.startOffset);

    return probe.toString().length === 0;
}

/** True when the caret sits after the last character of the element. */
export function isCaretAtEnd(element) {
    const range = getSelectionIn(element);
    if (!range || !range.collapsed) return false;

    const probe = element.ownerDocument.createRange();
    probe.selectNodeContents(element);
    probe.setStart(range.endContainer, range.endOffset);

    return probe.toString().length === 0;
}

/** Place the caret at the start or end of an editable element. */
export function placeCaret(element, position = "start") {
    if (!element) return;

    // Form fields keep their own caret model.
    if (typeof element.setSelectionRange === "function" && element.tagName !== "DIV") {
        element.focus();
        const length = String(element.value ?? "").length;
        const offset = position === "end" ? length : 0;
        try {
            element.setSelectionRange(offset, offset);
        } catch {
            // Some input types do not support selection ranges.
        }
        return;
    }

    element.focus();
    const selection = element.ownerDocument.getSelection();
    if (!selection) return;

    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(position !== "end");

    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Remove everything after the caret and return it as inline Markdown.
 * Used by the Enter key to split one block into two.
 * @returns {string|null} Markdown for the new block, or null when no caret
 */
export function splitEditableAtCaret(element) {
    const range = getSelectionIn(element);
    if (!range) return null;

    if (!range.collapsed) {
        range.deleteContents();
    }

    try {
        const tailRange = range.cloneRange();
        tailRange.selectNodeContents(element);
        tailRange.setStart(range.endContainer, range.endOffset);

        const fragment = tailRange.extractContents();
        const holder = element.ownerDocument.createElement("div");
        holder.appendChild(fragment);

        return serializeInlineHtml(holder);
    } catch (error) {
        console.warn("Could not split the block at the caret:", error);
        return null;
    }
}

/**
 * Run a formatting command on the current selection inside `element`.
 * Returns the Markdown that resulted from the change.
 */
export function applyInlineCommand(element, command, value) {
    // Put the caret back first: the toolbar button took the focus away.
    restoreSelectionInto(element);

    const ownerDocument = element.ownerDocument;
    const selection = ownerDocument.getSelection();

    if (command === "bold" || command === "italic") {
        // Keep the spaces around the selection outside the emphasis markers.
        if (selection && selection.rangeCount > 0 && selection.getRangeAt(0).collapsed === false) {
            trimRangeEdges(selection.getRangeAt(0));
        }

        ownerDocument.execCommand(command, false);
        return readInline(element);
    }

    if (command === "link") {
        const url = value || window.prompt("Link address (https://…)", "https://");
        if (!url) return readInline(element);

        if (selection && selection.isCollapsed) {
            ownerDocument.execCommand("insertHTML", false, `<a href="${escapeAttribute(url)}">${escapeAttribute(url)}</a>`);
        } else {
            if (selection && selection.rangeCount > 0 && selection.getRangeAt(0).collapsed === false) {
                trimRangeEdges(selection.getRangeAt(0));
            }
            ownerDocument.execCommand("createLink", false, url);
        }
        return readInline(element);
    }

    if (command === "inlineCode") {
        if (!selection || selection.rangeCount === 0) return readInline(element);

        const range = selection.getRangeAt(0);
        const wrapper = ownerDocument.createElement("code");

        if (range.collapsed) {
            wrapper.textContent = "code";
            range.insertNode(wrapper);
            const innerRange = ownerDocument.createRange();
            innerRange.selectNodeContents(wrapper);
            selection.removeAllRanges();
            selection.addRange(innerRange);
        } else {
            trimRangeEdges(range);
            try {
                range.surroundContents(wrapper);
            } catch {
                wrapper.appendChild(range.extractContents());
                range.insertNode(wrapper);
            }
            const innerRange = ownerDocument.createRange();
            innerRange.selectNodeContents(wrapper);
            selection.removeAllRanges();
            selection.addRange(innerRange);
        }
        return readInline(element);
    }

    return readInline(element);
}

function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
}
