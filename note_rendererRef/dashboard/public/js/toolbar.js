// Formatting toolbar: inline formatting, block style changes and insertion of
// the note constructs Bashligh already supports (boxes, tables, formulas…).

import {
    getBlock,
    editBlock,
    insertBlocksAfter,
    createNewBlock,
    getBlockIndex
} from "/dashboard/src/documentModel.js";
import { getBoxLabel } from "/dashboard/src/documentModel.js";

import { state } from "./state.js";
import { on, emit } from "./bus.js";
import { mutate, selectBlock, requestFocus } from "./documentController.js";
import { applyInlineCommand, rememberedEditable, restoreSelectionInto, watchSelection } from "./inlineEditor.js";
import { openInsertPicker } from "./assetPicker.js";
import { toast } from "./ui.js";

function activeEditable() {
    const active = document.activeElement;
    const focused = active && active.closest
        ? active.closest('.docBlock [contenteditable="true"]')
        : null;

    // When the caret's block lost focus (to a toolbar button, a dialog…),
    // fall back to the editable whose caret was used last.
    const editable = focused || rememberedEditable();
    if (!editable || !editable.isConnected || !state.document) return null;

    const shell = editable.closest(".docBlock");
    const block = shell ? getBlock(state.document, shell.dataset.blockId) : null;
    if (!block) return null;

    return { element: editable, block };
}

function lastContentBlockId() {
    if (!state.document) return null;

    for (let index = state.document.blocks.length - 1; index >= 0; index--) {
        const block = state.document.blocks[index];
        if (block.type !== "space") return block.id;
    }
    return null;
}

function selectedBlock() {
    if (!state.document || !state.selectedBlockId) return null;
    return getBlock(state.document, state.selectedBlockId);
}

function insertBlockAfterSelection(newBlock) {
    const referenceId = state.selectedBlockId || lastContentBlockId();

    mutate((document) => insertBlocksAfter(document, referenceId, [newBlock]), {
        structural: true
    });

    selectBlock(newBlock.id);
    requestFocus(newBlock.id, "end");
    return newBlock;
}

/* =========================================================
   Inline formatting
   ========================================================= */

function runInlineCommand(command) {
    const target = activeEditable();

    if (!target) {
        toast("Click inside the text you want to format first.");
        return;
    }

    // A selection that spans outside the editable would break the command.
    restoreSelectionInto(target.element);

    if (target.element.matches("td, th")) {
        // Cell text is plain by convention; formatting is applied as Markdown.
        const cellText = target.element.textContent;
        const wrapped =
            command === "bold"
                ? `**${cellText}**`
                : command === "italic"
                  ? `*${cellText}*`
                  : command === "inlineCode"
                    ? `\`${cellText}\``
                    : cellText;
        target.element.textContent = wrapped;
        target.element.dispatchEvent(new Event("input", { bubbles: true }));
        return;
    }

    const markdown = applyInlineCommand(target.element, command);

    // execCommand (and the direct DOM surgery behind inline code) does not
    // always fire the `input` event the block views listen to, so the model
    // is updated explicitly — otherwise the formatting is silently dropped on
    // the next render.
    target.element.dispatchEvent(new Event("input", { bubbles: true }));

    return markdown;
}

/**
 * Formatting entry point shared by the toolbar buttons and the Ctrl+B / Ctrl+I
 * / Ctrl+K shortcuts.
 * @returns {boolean} true when a command ran (the caller should prevent the
 * browser default).
 */
export function runFormattingCommand(command) {
    const handler = COMMAND_HANDLERS[command];
    const inlineCommands = ["bold", "italic", "inlineCode", "link"];
    if (!handler || !inlineCommands.includes(command)) return false;

    handler();
    return true;
}

/* =========================================================
   Block style
   ========================================================= */

function applyBlockStyle(style) {
    const block = selectedBlock();
    if (!block) {
        toast("Select a block first.");
        return;
    }

    if (style === "paragraph") {
        if (block.type === "heading") {
            mutate(() => {
                editBlock(block, {
                    type: "paragraph",
                    variant: "text",
                    text: block.text
                });
            });
            return;
        }
        toast("This block is already a paragraph.");
        return;
    }

    const depth = Number(style);
    if (!Number.isFinite(depth)) return;

    if (block.type === "heading") {
        mutate(() => editBlock(block, { depth }));
        return;
    }

    if (block.type === "paragraph" && block.variant === "text") {
        mutate(() => {
            editBlock(block, { type: "heading", depth, text: block.text });
        });
        return;
    }

    toast("Only text blocks can become headings.");
}

function applyListStyle(ordered) {
    const block = selectedBlock();

    if (block && block.type === "list") {
        mutate(() => editBlock(block, { ordered, start: ordered ? "1" : "" }));
        return;
    }

    if (block && block.type === "paragraph" && block.variant === "text") {
        const listBlock = createNewBlock({
            type: "list",
            ordered,
            start: ordered ? "1" : "",
            loose: false,
            items: [
                {
                    raw: "",
                    originalText: "",
                    text: block.text,
                    task: false,
                    checked: null,
                    dirty: true
                }
            ],
            raw: `${ordered ? "1." : "-"} ${block.text}`,
            originalRaw: ""
        });

        mutate((document) => {
            const index = getBlockIndex(document, block.id);
            document.blocks.splice(index, 1, listBlock);
            editBlock(listBlock, {});
        });

        selectBlock(listBlock.id);
        requestFocus(listBlock.id, "item:0");
        return;
    }

    toast("Select a paragraph or an existing list first.");
}

function applyQuoteStyle() {
    const block = selectedBlock();

    if (block && block.type === "blockquote" && block.kind === "quote") {
        return;
    }

    if (!block || block.type !== "paragraph" || block.variant !== "text") {
        toast("Select a paragraph to turn it into a quotation.");
        return;
    }

    const quoteBlock = createNewBlock({
        type: "blockquote",
        kind: "quote",
        calloutType: "",
        title: "",
        lines: block.text.split("\n"),
        raw: `> ${block.text.split("\n").join("\n> ")}`,
        originalRaw: ""
    });

    mutate((document) => {
        const index = getBlockIndex(document, block.id);
        document.blocks.splice(index, 1, quoteBlock);
        editBlock(quoteBlock, {});
    });

    selectBlock(quoteBlock.id);
    requestFocus(quoteBlock.id, "end");
}

/* =========================================================
   Insertions
   ========================================================= */

function insertCallout() {
    const calloutBlock = createNewBlock({
        type: "blockquote",
        kind: "box",
        boxType: "important",
        title: "",
        lines: ["متن جعبه را اینجا بنویسید."],
        raw: "> [BOX:IMPORTANT]\n> متن جعبه را اینجا بنویسید.",
        originalRaw: ""
    });

    insertBlockAfterSelection(calloutBlock);
    toast("Box inserted — pick its type in the box header.");
}

function insertTable() {
    const tableBlock = createNewBlock({
        type: "table",
        header: [
            { text: "Column 1", align: "" },
            { text: "Column 2", align: "" },
            { text: "Column 3", align: "" }
        ],
        rows: [
            ["", "", ""],
            ["", "", ""]
        ],
        raw: "",
        originalRaw: ""
    });

    insertBlockAfterSelection(tableBlock);
    editBlock(tableBlock, {});
}

function insertFormula() {
    const formulaBlock = createNewBlock({
        type: "paragraph",
        variant: "formula",
        latex: "E = mc^2",
        raw: "$$E = mc^2$$",
        originalRaw: ""
    });

    insertBlockAfterSelection(formulaBlock);
}

function insertCodeBlock() {
    const codeBlock = createNewBlock({
        type: "code",
        lang: "",
        text: "// code",
        raw: "```\n// code\n```",
        originalRaw: ""
    });

    insertBlockAfterSelection(codeBlock);
}

function insertRawBlock() {
    const rawBlock = createNewBlock({
        type: "unknown",
        raw: "<!-- raw Markdown or HTML block -->",
        originalRaw: ""
    });

    insertBlockAfterSelection(rawBlock);
    toast("Raw block inserted. Edit it through the block's </> source button.");
}

function insertImage() {
    openInsertPicker();
    emit("panel:requested", { panel: "assets" });
    toast("Choose an image in the Images panel.");
}

/* =========================================================
   Wiring
   ========================================================= */

const COMMAND_HANDLERS = {
    bold: () => runInlineCommand("bold"),
    italic: () => runInlineCommand("italic"),
    inlineCode: () => runInlineCommand("inlineCode"),
    link: () => runInlineCommand("link"),
    bulletList: () => applyListStyle(false),
    numberList: () => applyListStyle(true),
    quote: applyQuoteStyle,
    callout: insertCallout,
    table: insertTable,
    formula: insertFormula,
    image: insertImage,
    codeBlock: insertCodeBlock,
    rawBlock: insertRawBlock
};

function syncHeadingSelect() {
    const select = document.getElementById("headingSelect");
    const block = selectedBlock();
    if (!select) return;

    if (block && block.type === "heading") {
        select.value = String(Math.min(block.depth, 4));
    } else if (block && block.type === "paragraph") {
        select.value = "paragraph";
    } else {
        select.value = "paragraph";
    }
}

export function initToolbar() {
    // Keep the caret alive while toolbar buttons are clicked.
    watchSelection();

    for (const button of document.querySelectorAll(".toolButton[data-command]")) {
        const handler = COMMAND_HANDLERS[button.dataset.command];
        if (!handler) continue;

        // Clicking a button would otherwise move the focus out of the block
        // and collapse the selection; formatting then has nothing to act on.
        button.addEventListener("mousedown", (event) => event.preventDefault());

        button.addEventListener("click", (event) => {
            event.preventDefault();
            handler();
        });
    }

    const headingSelect = document.getElementById("headingSelect");
    if (headingSelect) {
        headingSelect.addEventListener("change", () => {
            applyBlockStyle(headingSelect.value);
            syncHeadingSelect();
        });
    }

    on("selection:changed", syncHeadingSelect);
    on("document:restored", syncHeadingSelect);
    on("note:loaded", syncHeadingSelect);
}
