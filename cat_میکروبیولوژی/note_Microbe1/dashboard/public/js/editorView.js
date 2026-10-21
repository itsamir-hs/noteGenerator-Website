// The editing surface: renders the document model, keeps the selection in
// sync, implements keyboard behaviour and drag-and-drop block moves.

import {
    getBlock,
    getBlockIndex,
    editBlock,
    parseDocument,
    insertBlocksAfter,
    removeBlock,
    moveBlockByOffset,
    moveBlockTo,
    duplicateBlock,
    createNewBlock
} from "/dashboard/src/documentModel.js";

import { state } from "./state.js";
import { on, emit } from "./bus.js";
import { createBlockElement } from "./blockViews.js";
import {
    mutate,
    commitChange,
    selectBlock,
    requestFocus
} from "./documentController.js";
import {
    splitEditableAtCaret,
    isCaretAtStart,
    placeCaret,
    readInline
} from "./inlineEditor.js";
import { toast, reportError } from "./ui.js";

let surface = null;
let dragBlockId = null;

let markdownDialog = null;
let markdownSourceField = null;
let markdownDialogBlockId = null;

/* =========================================================
   Click-to-edit caret placement
   ========================================================= */

/**
 * Put the caret at a screen point inside a block.
 * The floating block toolbar overlaps the top of the block and the shell has
 * padding, so a plain click there would otherwise never reach the editable
 * text and the operator would have to aim for the very end of the block.
 */
function focusEditableAtPoint(shell, x, y) {
    const doc = surface.ownerDocument;
    let range = null;

    if (typeof doc.caretRangeFromPoint === "function") {
        range = doc.caretRangeFromPoint(x, y);
    } else if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(x, y);
        if (position) {
            range = doc.createRange();
            range.setStart(position.offsetNode, position.offset);
        }
    }

    if (!range) return false;

    const container = range.startContainer;
    const element = container.nodeType === 1 ? container : container.parentElement;
    const editable = element && element.closest
        ? element.closest('[contenteditable="true"]')
        : null;

    if (!editable || !shell.contains(editable)) return false;

    editable.focus();

    const selection = doc.getSelection();
    if (!selection) return true;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

/* =========================================================
   Edit a block as Markdown
   ========================================================= */

function openBlockMarkdownDialog(blockId) {
    const block = state.document ? getBlock(state.document, blockId) : null;
    if (!block || !markdownDialog || !markdownSourceField) return;

    markdownDialogBlockId = blockId;
    markdownSourceField.value = block.raw;

    if (!markdownDialog.open) markdownDialog.showModal();
    markdownSourceField.focus();
    markdownSourceField.select();
}

function applyBlockMarkdown() {
    const blockId = markdownDialogBlockId;
    markdownDialogBlockId = null;
    if (markdownDialog && markdownDialog.open) markdownDialog.close();

    if (!blockId || !state.document) return;
    const block = getBlock(state.document, blockId);
    if (!block) return;

    const source = markdownSourceField.value.replace(/\r\n/g, "\n");

    if (!source.trim()) {
        deleteBlockById(blockId);
        return;
    }

    let parsed;
    try {
        parsed = parseDocument(source);
    } catch (error) {
        reportError(error, "The Markdown could not be parsed:");
        return;
    }

    const newBlocks = parsed.blocks.filter((candidate) => candidate.type !== "space");
    if (newBlocks.length === 0) {
        toast("That Markdown contains no block to insert.");
        return;
    }

    // Keep a blank line between the freshly parsed blocks so the document
    // stays valid Markdown.
    const replacement = [];
    newBlocks.forEach((candidate, index) => {
        if (index > 0) {
            replacement.push(createNewBlock({ type: "space", raw: "\n\n", originalRaw: "" }));
        }
        replacement.push(candidate);
    });

    requestFocus(newBlocks[0].id, "start");

    mutate(
        (document) => {
            const index = getBlockIndex(document, blockId);
            if (index === -1) return;
            document.blocks.splice(index, 1, ...replacement);
        },
        { structural: true }
    );

    toast(
        newBlocks.length === 1
            ? "Block updated from Markdown."
            : `Block replaced by ${newBlocks.length} blocks.`,
        "success"
    );
}

/* =========================================================
   Rendering
   ========================================================= */

function renderEditor() {
    if (!surface) return;

    if (!state.document) {
        surface.innerHTML = '<p class="emptyState">Open a note to start editing.</p>';
        return;
    }

    const scrollOffset = surface.scrollTop;
    const fragment = document.createDocumentFragment();

    for (const block of state.document.blocks) {
        if (block.type === "space") continue;
        fragment.appendChild(createBlockElement(block));
    }

    surface.replaceChildren(fragment);
    surface.scrollTop = scrollOffset;

    applySelectionClass();
    applyFocusRequest();
}

function applySelectionClass() {
    for (const node of surface.querySelectorAll(".docBlock.is_selected")) {
        node.classList.remove("is_selected");
    }

    if (!state.selectedBlockId) return;

    const selected = surface.querySelector(
        `.docBlock[data-block-id="${cssEscape(state.selectedBlockId)}"]`
    );
    if (selected) selected.classList.add("is_selected");
}

function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
}

function applyFocusRequest() {
    const request = state.focusRequest;
    if (!request) return;

    state.focusRequest = null;

    const shell = surface.querySelector(
        `.docBlock[data-block-id="${cssEscape(request.blockId)}"]`
    );
    if (!shell) return;

    if (typeof request.caret === "string" && request.caret.startsWith("item:")) {
        const itemIndex = Number(request.caret.split(":")[1]);
        const items = shell.querySelectorAll(".blockList li .blockEditable, li .blockEditable");
        const target = items[itemIndex];
        if (target) placeCaret(target, "end");
        return;
    }

    const editable = shell.querySelector('[contenteditable="true"], textarea, input');
    if (editable) placeCaret(editable, request.caret === "end" ? "end" : "start");
}

/* =========================================================
   Block helpers
   ========================================================= */

function shellFor(element) {
    return element && element.closest ? element.closest(".docBlock") : null;
}

function blockFromElement(element) {
    const shell = shellFor(element);
    if (!shell || !state.document) return null;
    return getBlock(state.document, shell.dataset.blockId);
}

function findNeighbouringBlock(block, direction) {
    const index = getBlockIndex(state.document, block.id);
    let scan = index + direction;

    while (scan >= 0 && scan < state.document.blocks.length) {
        const candidate = state.document.blocks[scan];
        if (candidate.type !== "space") return candidate;
        scan += direction;
    }
    return null;
}

function createBlockLike(block, text) {
    if (block.type === "heading") {
        return createNewBlock({
            type: "paragraph",
            variant: "text",
            text,
            raw: text,
            originalRaw: ""
        });
    }

    return createNewBlock({
        type: "paragraph",
        variant: "text",
        text,
        raw: text,
        originalRaw: ""
    });
}

function isBlockEmpty(block) {
    if (block.type === "heading") return block.text.trim() === "";
    if (block.type === "paragraph") {
        if (block.variant === "text") return block.text.trim() === "";
        if (block.variant === "formula") return block.latex.trim() === "";
        return false;
    }
    if (block.type === "blockquote") {
        return !block.title.trim() && block.lines.every((line) => line.trim() === "");
    }
    if (block.type === "list") {
        return block.items.every((item) => item.text.trim() === "");
    }
    return false;
}

/* =========================================================
   Keyboard behaviour
   ========================================================= */

function insertPlainNewline(element) {
    const selection = element.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const textNode = element.ownerDocument.createTextNode("\n");
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
}

function splitCurrentBlock(editable, block) {
    const tail = splitEditableAtCaret(editable);
    if (tail === null) return;

    const head = readInline(editable);
    const nextBlock = createBlockLike(block, tail);

    requestFocus(nextBlock.id, "start");

    mutate(
        (document) => {
            editBlock(block, { text: head });
            insertBlocksAfter(document, block.id, [nextBlock]);
        },
        { structural: true }
    );
}

function addListItemBelow(editable, block) {
    const listItem = editable.closest("li");
    const listElement = editable.closest("ul, ol");
    if (!listItem || !listElement) return;

    const items = [...listElement.querySelectorAll(":scope > li")];
    const itemIndex = items.indexOf(listItem);
    if (itemIndex === -1) return;

    // Split the item at the caret: the tail becomes the new item.
    const after = splitEditableAtCaret(editable) ?? "";
    const before = readInline(editable);

    requestFocus(block.id, `item:${itemIndex + 1}`);

    mutate(
        () => {
            editBlock(block, { __itemIndex: itemIndex, text: before });
            block.items.splice(itemIndex + 1, 0, {
                raw: "",
                originalText: "",
                text: after,
                task: false,
                checked: null,
                dirty: true
            });
            editBlock(block, {});
        },
        { structural: true }
    );
}

function mergeWithPreviousBlock(block, editable) {
    const previous = findNeighbouringBlock(block, -1);
    if (!previous) return false;

    const canMergeText =
        (block.type === "paragraph" && block.variant === "text") ||
        block.type === "heading";

    const previousAcceptsText =
        (previous.type === "paragraph" && previous.variant === "text") ||
        previous.type === "heading";

    if (!canMergeText || !previousAcceptsText || previous.type === "heading") {
        if (isBlockEmpty(block)) {
            deleteBlockById(block.id, { silent: true });
            return true;
        }
        return false;
    }

    const currentText = readInline(editable);
    const separator = /\s$|[-–—(]$/.test(previous.text) || /^\s/.test(currentText) ? "" : " ";
    const mergedText = previous.text + separator + currentText;

    requestFocus(previous.id, "end");

    mutate(
        (document) => {
            editBlock(previous, { text: mergedText });
            removeBlock(document, block.id);
        },
        { structural: true }
    );

    return true;
}

function onSurfaceKeydown(event) {
    const editable = event.target.closest
        ? event.target.closest('[contenteditable="true"]')
        : null;

    // Alt + arrows move the current block (documented in the help dialog).
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const block = blockFromElement(event.target);
        if (!block) return;
        event.preventDefault();
        moveActiveBlock(block, event.key === "ArrowUp" ? -1 : 1);
        return;
    }

    if (event.key === "Enter" && !event.shiftKey && editable) {
        const block = blockFromElement(editable);
        if (!block) return;

        // Table cells keep their own navigation.
        if (editable.matches("td, th")) return;

        event.preventDefault();

        if (editable.classList.contains("calloutBody")) {
            insertPlainNewline(editable);
            commitChange({ immediate: false });
            return;
        }

        if (editable.closest("li")) {
            addListItemBelow(editable, block);
            return;
        }

        splitCurrentBlock(editable, block);
        return;
    }

    if (event.key === "Tab" && editable && editable.matches("td, th")) {
        event.preventDefault();
        moveToAdjacentCell(editable, event.shiftKey ? -1 : 1);
        return;
    }

    if (event.key === "Backspace" && !event.shiftKey && editable) {
        if (!isCaretAtStart(editable)) return;

        const block = blockFromElement(editable);
        if (!block) return;

        event.preventDefault();

        if (editable.closest("li")) {
            const listItem = editable.closest("li");
            const listElement = editable.closest("ul, ol");
            const items = listElement ? [...listElement.querySelectorAll(":scope > li")] : [];
            const itemIndex = items.indexOf(listItem);
            const isOnlyItem = items.length === 1;

            if (itemIndex === 0 && isOnlyItem) return;

            if (itemIndex === 0) {
                // Merge the first item into the previous block.
                mergeWithPreviousBlock(block, editable);
                return;
            }

            mutate(
                () => {
                    block.items.splice(itemIndex, 1);
                    editBlock(block, {});
                    requestFocus(block.id, `item:${itemIndex - 1}`);
                },
                { structural: true }
            );
            return;
        }

        if (editable.classList.contains("calloutBody")) {
            if (block.lines.every((line) => line.trim() === "") && !block.title.trim()) {
                removeBlockById(block.id, { silent: true });
            }
            return;
        }

        const merged = mergeWithPreviousBlock(block, editable);
        if (!merged && isBlockEmpty(block)) {
            removeBlockById(block.id, { silent: true });
        }
    }
}

function moveToAdjacentCell(cellElement, direction) {
    const table = cellElement.closest("table");
    if (!table) return;

    const cells = [...table.querySelectorAll("th, td")];
    const index = cells.indexOf(cellElement);
    const next = cells[index + direction];
    if (next) next.focus();
}

/* =========================================================
   Structural actions
   ========================================================= */

function moveActiveBlock(block, offset) {
    requestFocus(block.id, "end");
    mutate((document) => moveBlockByOffset(document, block.id, offset), {
        structural: true
    });
}

function deleteBlockById(blockId, options = {}) {
    mutate((document) => removeBlock(document, blockId), { structural: true });
    if (!options.silent) {
        toast("Block deleted. Press Ctrl+Z to restore it.");
    }
}

function handleBlockAction(blockId, action) {
    const block = getBlock(state.document, blockId);
    if (!block) return;

    switch (action) {
        case "moveUp":
            moveActiveBlock(block, -1);
            break;
        case "moveDown":
            moveActiveBlock(block, 1);
            break;
        case "duplicate":
            mutate((document) => duplicateBlock(document, blockId), {
                structural: true
            });
            toast("Block duplicated.");
            break;
        case "delete":
            deleteBlockById(blockId);
            break;
        case "editMarkdown":
            openBlockMarkdownDialog(blockId);
            break;
        default:
            break;
    }
}

/* =========================================================
   Drag and drop
   ========================================================= */

function onDragStart(event) {
    const handle = event.target.closest ? event.target.closest(".dragHandle") : null;
    const shell = shellFor(event.target);
    if (!handle || !shell) return;

    dragBlockId = shell.dataset.blockId;
    shell.classList.add("is_dragging");

    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", dragBlockId);
    }
}

function onDragOver(event) {
    if (!dragBlockId) return;

    const shell = shellFor(event.target);
    if (!shell || shell.dataset.blockId === dragBlockId) return;

    event.preventDefault();
    shell.classList.add("is_dropTarget");
}

function onDragLeave(event) {
    const shell = shellFor(event.target);
    if (shell) shell.classList.remove("is_dropTarget");
}

function onDrop(event) {
    if (!dragBlockId) return;

    const shell = shellFor(event.target);
    event.preventDefault();

    for (const node of surface.querySelectorAll(".is_dropTarget, .is_dragging")) {
        node.classList.remove("is_dropTarget", "is_dragging");
    }

    if (!shell || shell.dataset.blockId === dragBlockId) {
        dragBlockId = null;
        return;
    }

    const targetId = shell.dataset.blockId;
    const position = getBlockIndex(state.document, dragBlockId) <
        getBlockIndex(state.document, targetId)
        ? "after"
        : "before";

    mutate((document) => moveBlockTo(document, dragBlockId, targetId, position), {
        structural: true
    });

    dragBlockId = null;
}

function onDragEnd() {
    for (const node of surface.querySelectorAll(".is_dropTarget, .is_dragging")) {
        node.classList.remove("is_dropTarget", "is_dragging");
    }
    dragBlockId = null;
}

/* =========================================================
   Initialisation
   ========================================================= */

export function initEditorView() {
    surface = document.getElementById("editorSurface");
    if (!surface) return;

    surface.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-action]");
        if (actionButton && surface.contains(actionButton)) {
            const shell = shellFor(actionButton);
            if (!shell) return;
            const action = actionButton.dataset.action;
            if (action === "drag") return;
            event.preventDefault();
            handleBlockAction(shell.dataset.blockId, action);
            return;
        }

        const shell = shellFor(event.target);
        if (shell) selectBlock(shell.dataset.blockId);
    });

    // Clicking anywhere on a block places the caret there — including the
    // padding and the area covered by the floating block toolbar, which would
    // otherwise swallow the click without focusing anything.
    surface.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        const shell = shellFor(event.target);
        if (!shell) return;

        // Real controls and already-editable text keep their native behaviour.
        if (
            event.target.closest(
                'button, input, textarea, select, a, label, [contenteditable="true"]'
            )
        ) {
            return;
        }

        focusEditableAtPoint(shell, event.clientX, event.clientY);
    });

    surface.addEventListener("keydown", onSurfaceKeydown);

    surface.addEventListener("dragstart", onDragStart);
    surface.addEventListener("dragover", onDragOver);
    surface.addEventListener("dragleave", onDragLeave);
    surface.addEventListener("drop", onDrop);
    surface.addEventListener("dragend", onDragEnd);

    on("render:required", renderEditor);
    on("document:restored", renderEditor);
    on("note:loaded", renderEditor);
    on("selection:changed", applySelectionClass);

    // "Edit as Markdown" dialog (one dialog shared by every block).
    markdownDialog = document.getElementById("blockMarkdownDialog");
    markdownSourceField = document.getElementById("blockMarkdownSource");

    if (markdownDialog && markdownSourceField) {
        const cancelButton = document.getElementById("blockMarkdownCancel");
        const form = document.getElementById("blockMarkdownForm");

        if (cancelButton) {
            cancelButton.addEventListener("click", () => {
                markdownDialogBlockId = null;
                markdownDialog.close();
            });
        }

        if (form) {
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                applyBlockMarkdown();
            });
        }

        markdownSourceField.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                applyBlockMarkdown();
            }
        });

        // Esc / backdrop close must not leave a stale block id behind.
        markdownDialog.addEventListener("close", () => {
            markdownDialogBlockId = null;
        });
    }

    renderEditor();
}

/** Scroll the editor to a block and select it (used by outline/issues). */
export function navigateToBlock(blockId) {
    const shell = surface && surface.querySelector(
        `.docBlock[data-block-id="${cssEscape(blockId)}"]`
    );
    if (!shell) return;

    shell.scrollIntoView({ behavior: "smooth", block: "center" });
    selectBlock(blockId);

    const editable = shell.querySelector('[contenteditable="true"], textarea, input');
    if (editable && typeof editable.focus === "function") {
        window.setTimeout(() => editable.focus({ preventScroll: true }), 220);
    }
}
