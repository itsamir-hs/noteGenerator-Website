// Parses lecture-note Markdown into an editable block model and serializes it back.
//
// Data-integrity rule: every block keeps the exact source slice it was parsed
// from (`raw`). Editing a block rebuilds only that block's source, everything
// else is emitted verbatim, so a document that is opened and saved without
// changes round-trips byte-for-byte and unknown/unsupported Markdown survives.

import { marked } from "marked";

// Box vocabulary the Bashligh renderer actually understands (see the renderer's
// src/callouts.js): blockquotes whose first line is [BOX:TYPE] render as
// calloutBox calloutBox--<type>, and [QUESTION:ESSAY:n] / [QUESTION:MCQ:n]
// render as question boxes. This module is the single source of that syntax on
// the dashboard side; the renderer stays untouched.
export const BOX_TYPES = ["definition", "example", "important", "review"];

const BOX_LABELS = {
    definition: "تعریف",
    example: "مثال",
    important: "نکته مهم",
    review: "نیازمند بررسی"
};

/** Human-readable label for a box type (the renderer's own fixed titles). */
export function getBoxLabel(boxType) {
    return BOX_LABELS[boxType] || boxType;
}

export const QUESTION_TYPES = ["essay", "mcq"];

let blockSequence = 0;

/** Fresh unique id for a block (new blocks must not collide with parsed ones). */
function createBlockId() {
    blockSequence += 1;
    return `block-${blockSequence}`;
}

function createBlock(fields) {
    return {
        id: createBlockId(),
        dirty: false,
        originalRaw: "",
        raw: "",
        ...fields
    };
}

/** Create a brand-new block (used by the editor when content is added). */
export function createNewBlock(fields) {
    return createBlock(fields);
}

function isImageOnlyParagraph(token) {
    return (
        token.type === "paragraph" &&
        Array.isArray(token.tokens) &&
        token.tokens.length === 1 &&
        token.tokens[0].type === "image"
    );
}

const PLACEHOLDER_PATTERN = /^\[IMAGE_([^\]]+)\]$/;
const METADATA_PATTERN = /^\*\*(.+?):\*\*\s*(.*)$/;
const BLOCK_FORMULA_PATTERN = /^\$\$([\s\S]*)\$\$$/;

function createParagraphFromToken(token) {
    const trimmedRaw = token.raw.trim();

    const formulaMatch = trimmedRaw.match(BLOCK_FORMULA_PATTERN);
    if (formulaMatch && token.raw.trimStart().startsWith("$$")) {
        return createBlock({
            type: "paragraph",
            variant: "formula",
            latex: formulaMatch[1],
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    const placeholderMatch = trimmedRaw.match(PLACEHOLDER_PATTERN);
    if (placeholderMatch) {
        return createBlock({
            type: "paragraph",
            variant: "placeholder",
            imageId: placeholderMatch[1],
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    if (isImageOnlyParagraph(token)) {
        const imageToken = token.tokens[0];
        return createBlock({
            type: "paragraph",
            variant: "image",
            alt: imageToken.text || "",
            src: imageToken.href || "",
            title: imageToken.title || "",
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    const text = token.text ?? "";

    const metadataMatch = text.match(METADATA_PATTERN);
    if (metadataMatch) {
        return createBlock({
            type: "paragraph",
            variant: "metadata",
            label: metadataMatch[1].trim(),
            value: metadataMatch[2].trim(),
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    return createBlock({
        type: "paragraph",
        variant: "text",
        text,
        raw: token.raw,
        originalRaw: token.raw
    });
}

const BOX_MARKER_PATTERN = /^\[BOX:(DEFINITION|EXAMPLE|IMPORTANT|REVIEW)\]\s*(.*)$/i;
const QUESTION_MARKER_PATTERN = /^\[QUESTION:(ESSAY|MCQ):(\d+)\]\s*(.*)$/i;

function stripBlockquoteMarker(line) {
    return line.replace(/^>( ?)/, "");
}

function createBlockquoteFromToken(token) {
    const lines = token.raw.split("\n").map(stripBlockquoteMarker);
    const firstLine = (lines[0] ?? "").trim();
    const bodyLines = lines.slice(1);

    const boxMatch = firstLine.match(BOX_MARKER_PATTERN);
    if (boxMatch) {
        return createBlock({
            type: "blockquote",
            kind: "box",
            boxType: boxMatch[1].toLowerCase(),
            // The renderer gives boxes a fixed Persian title per type; extra
            // text after the marker (if the generator wrote any) is preserved.
            title: (boxMatch[2] || "").trim(),
            lines: bodyLines,
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    const questionMatch = firstLine.match(QUESTION_MARKER_PATTERN);
    if (questionMatch) {
        const questionLines = bodyLines;
        const answerIndex = questionLines.findIndex((line) => line.trim() === "[ANSWER]");
        const optionPattern = /^\[OPTION:([A-D])\]\s*(.*)$/i;
        const correctPattern = /^\[CORRECT:([A-D])\]\s*$/i;

        const promptLines = [];
        const options = [];
        let answerLines = [];
        let correctAnswer = "";

        const promptEnd = answerIndex === -1 ? questionLines.length : answerIndex;
        for (let lineIndex = 0; lineIndex < promptEnd; lineIndex += 1) {
            const line = questionLines[lineIndex];
            const optionMatch = line.match(optionPattern);
            if (optionMatch) {
                options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2] });
            } else {
                promptLines.push(line);
            }
        }

        if (answerIndex !== -1) {
            for (let lineIndex = answerIndex + 1; lineIndex < questionLines.length; lineIndex += 1) {
                const line = questionLines[lineIndex];
                const correctMatch = line.match(correctPattern);
                if (correctMatch) {
                    correctAnswer = correctMatch[1].toUpperCase();
                } else {
                    answerLines.push(line);
                }
            }
        }

        return createBlock({
            type: "question",
            questionType: questionMatch[1].toLowerCase(),
            questionNumber: questionMatch[2],
            promptLines,
            options,
            answerLines,
            correctAnswer,
            // `lines` keeps the uninterpreted body so serialization of an
            // untouched question is byte-identical to the source.
            lines: questionLines,
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    // Bashligh's pre-existing definition box convention: > **تعریف — Term**
    const definitionMatch = firstLine.match(/^\*\*(.+?)\*\*/);
    if (definitionMatch && /^تعریف/.test(definitionMatch[1].trim())) {
        return createBlock({
            type: "blockquote",
            kind: "definition",
            calloutType: "definition",
            title: firstLine,
            lines: bodyLines,
            raw: token.raw,
            originalRaw: token.raw
        });
    }

    return createBlock({
        type: "blockquote",
        kind: "quote",
        calloutType: "",
        title: "",
        lines,
        raw: token.raw,
        originalRaw: token.raw
    });
}

function createListFromToken(token) {
    return createBlock({
        type: "list",
        ordered: Boolean(token.ordered),
        start: token.start || "",
        loose: Boolean(token.loose),
        items: token.items.map((item) => ({
            raw: item.raw,
            originalText: item.text,
            text: item.text,
            task: Boolean(item.task),
            checked: item.checked ?? null,
            dirty: false
        })),
        raw: token.raw,
        originalRaw: token.raw
    });
}

function createTableFromToken(token) {
    const headerCells = (token.header || []).map((cell) => ({
        text: typeof cell === "string" ? cell : cell.text,
        align: (typeof cell === "object" && cell.align) || ""
    }));

    if (headerCells.length > 0 && Array.isArray(token.align)) {
        token.align.forEach((align, index) => {
            if (headerCells[index]) headerCells[index].align = align || "";
        });
    }

    return createBlock({
        type: "table",
        header: headerCells,
        rows: (token.rows || []).map((row) =>
            row.map((cell) => (typeof cell === "string" ? cell : cell.text))
        ),
        raw: token.raw,
        originalRaw: token.raw
    });
}

function createBlockFromToken(token) {
    switch (token.type) {
        case "space":
            return createBlock({ type: "space", raw: token.raw, originalRaw: token.raw });
        case "heading":
            return createBlock({
                type: "heading",
                depth: token.depth,
                text: token.text,
                raw: token.raw,
                originalRaw: token.raw
            });
        case "paragraph":
        case "text":
            return createParagraphFromToken(token);
        case "blockquote":
            return createBlockquoteFromToken(token);
        case "list":
            return createListFromToken(token);
        case "table":
            return createTableFromToken(token);
        case "code":
            return createBlock({
                type: "code",
                lang: token.lang || "",
                text: token.text ?? "",
                raw: token.raw,
                originalRaw: token.raw
            });
        case "hr":
            return createBlock({ type: "hr", raw: token.raw, originalRaw: token.raw });
        default:
            // html, def and anything marked does not model stay raw-only so the
            // visual editor can never silently rewrite them.
            return createBlock({
                type: token.type === "html" ? "html" : "unknown",
                raw: token.raw,
                originalRaw: token.raw
            });
    }
}

/**
 * Parse a Markdown note into the editable document model.
 * @param {string} markdown
 * @returns {{blocks: Array<Object>}}
 */
export function parseDocument(markdown) {
    const source = typeof markdown === "string" ? markdown : "";
    const tokens = marked.lexer(source);

    return {
        blocks: tokens.map(createBlockFromToken)
    };
}

/* =========================================================
   Serialization
   ========================================================= */

function escapeTableCell(cellText) {
    return String(cellText ?? "").replace(/\|/g, "\\|");
}

function alignmentSeparator(align) {
    if (align === "left") return ":---";
    if (align === "right") return "---:";
    if (align === "center") return ":---:";
    return "---";
}

function listItemMarker(list, itemIndex) {
    if (!list.ordered) return "- ";
    const startNumber = Number(list.start) || 1;
    return `${startNumber + itemIndex}. `;
}

function buildListItemSource(list, item, itemIndex) {
    const marker = listItemMarker(list, itemIndex);
    const textLines = String(item.text ?? "").split("\n");
    const indent = " ".repeat(marker.length);

    const taskPrefix = item.task ? `[${item.checked ? "x" : " "}] ` : "";

    return (
        marker +
        taskPrefix +
        textLines
            .map((line, index) => (index === 0 ? line : indent + line))
            .join("\n")
    );
}

/**
 * Rebuild a block's Markdown source from its structured fields.
 * @param {Object} block
 * @returns {string}
 */
export function buildBlockRaw(block) {
    switch (block.type) {
        case "heading":
            return `${"#".repeat(Math.min(Math.max(block.depth, 1), 6))} ${block.text}`;
        case "paragraph": {
            if (block.variant === "formula") return `$$${block.latex}$$`;
            if (block.variant === "placeholder") return `[IMAGE_${block.imageId}]`;
            if (block.variant === "image") {
                const titleSuffix = block.title ? ` "${block.title}"` : "";
                return `![${block.alt}](${block.src}${titleSuffix})`;
            }
            if (block.variant === "metadata") {
                return block.value ? `**${block.label}:** ${block.value}` : `**${block.label}:**`;
            }
            return block.text;
        }
        case "blockquote": {
            if (block.kind === "box") {
                const marker = `[BOX:${block.boxType.toUpperCase()}]`;
                const firstLine = block.title ? `> ${marker} ${block.title}` : `> ${marker}`;
                const body = block.lines.map((line) => (line === "" ? ">" : `> ${line}`));
                return [firstLine, ...body].join("\n");
            }
            if (block.kind === "definition") {
                const body = block.lines.map((line) => (line === "" ? ">" : `> ${line}`));
                return [`> ${block.title}`, ...body].join("\n");
            }
            return block.lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
        }
        case "question": {
            // Questions are rebuilt from the raw body lines so option/answer
            // markers the editor does not model survive untouched.
            const marker = `[QUESTION:${block.questionType.toUpperCase()}:${block.questionNumber}]`;
            const firstLine = `> ${marker}`;
            const body = block.lines.map((line) => (line === "" ? ">" : `> ${line}`));
            return [firstLine, ...body].join("\n");
        }
        case "list": {
            const separator = block.loose ? "\n\n" : "\n";
            const itemSources = block.items.map((item, index) =>
                item.dirty
                    ? buildListItemSource(block, item, index)
                    : item.raw.replace(/\n+$/, "")
            );
            return itemSources
                .map((source, index) => source.replace(/\n+$/, ""))
                .join(separator);
        }
        case "table": {
            const headerLine = `| ${block.header.map((cell) => escapeTableCell(cell.text)).join(" | ")} |`;
            const separatorLine = `| ${block.header.map((cell) => alignmentSeparator(cell.align)).join(" | ")} |`;
            const rowLines = block.rows.map(
                (row) => `| ${row.map(escapeTableCell).join(" | ")} |`
            );
            return [headerLine, separatorLine, ...rowLines].join("\n");
        }
        case "code":
            return `\`\`\`${block.lang || ""}\n${block.text}\n\`\`\``;
        case "space":
        case "hr":
        case "html":
        case "unknown":
        case "def":
        default:
            return block.raw;
    }
}

/**
 * Recompute a block's source after its fields changed.
 * When the rebuilt source matches the loaded source the block counts as
 * unedited again, which keeps change tracking honest.
 */
export function refreshBlock(block) {
    const nextRaw = buildBlockRaw(block);

    block.raw = nextRaw;
    block.dirty = true;

    if (block.type === "list") {
        for (const item of block.items) {
            if (item.dirty && item.text === item.originalText) item.dirty = false;
        }
        if (block.items.every((item) => !item.dirty) && nextRaw === block.originalRaw) {
            block.raw = block.originalRaw;
            block.dirty = false;
        }
    }

    if (block.raw === block.originalRaw) block.dirty = false;

    return block;
}

/**
 * Apply field changes to a block and rebuild its Markdown source.
 * @param {Object} block
 * @param {Object} patch - fields to assign before rebuilding
 */
export function editBlock(block, patch) {
    if (block.type === "space") {
        // Spacing blocks only ever change when a structural edit rewrites them.
        if (typeof patch.raw === "string") {
            block.raw = patch.raw;
            block.dirty = block.raw !== block.originalRaw;
        }
        return block;
    }

    // Question blocks: any edit to prompt/options/answer must first be folded
    // back into `lines`, which is what the serializer actually writes out.
    if (block.type === "question") {
        const questionPatch = { ...patch };
        delete questionPatch.raw;
        if (Object.keys(questionPatch).length > 0) {
            Object.assign(block, questionPatch);
            rebuildQuestionLines(block);
            return block;
        }
    }

    if (patch.__itemIndex !== undefined && block.type === "list") {
        const itemIndex = patch.__itemIndex;
        const itemPatch = { ...patch };
        delete itemPatch.__itemIndex;

        const item = block.items[itemIndex];
        if (item) {
            Object.assign(item, itemPatch);
            item.dirty = true;
            block.dirty = true;
            block.raw = buildBlockRaw(block);
            if (block.raw === block.originalRaw) block.dirty = false;
        }
        return block;
    }

    Object.assign(block, patch);
    return refreshBlock(block);
}

/* =========================================================
   Document-level operations
   ========================================================= */

/**
 * Fold a question block's structured fields (prompt, options, answer) back
 * into its raw body `lines`, which is what the serializer writes out.
 * Editing a field always goes through here so the editor and the Markdown
 * can never disagree about a question's content.
 */
function rebuildQuestionLines(block) {
    const lines = [...(block.promptLines || [])];
    for (const option of block.options || []) {
        lines.push(`[OPTION:${option.letter}] ${option.text}`);
    }
    if ((block.answerLines && block.answerLines.length > 0) || block.correctAnswer) {
        lines.push("[ANSWER]");
        lines.push(...(block.answerLines || []));
        if (block.correctAnswer) lines.push(`[CORRECT:${block.correctAnswer}]`);
    }
    block.lines = lines;
    refreshBlock(block);
}

export function getBlock(document, blockId) {
    return document.blocks.find((block) => block.id === blockId) || null;
}

export function getBlockIndex(document, blockId) {
    return document.blocks.findIndex((block) => block.id === blockId);
}

/** Full document Markdown. */
export function serializeDocument(document) {
    return document.blocks.map((block) => block.raw).join("");
}

function isContentBlock(block) {
    return block && block.type !== "space";
}

/** Guarantee a blank line between two adjacent content blocks. */
function ensureSeparationAt(document, index) {
    const before = document.blocks[index - 1];
    const after = document.blocks[index];

    if (!before || !after) return;
    if (!isContentBlock(before) || !isContentBlock(after)) return;

    document.blocks.splice(index, 0, createBlock({ type: "space", raw: "\n\n", originalRaw: "" }));
}

/**
 * Insert freshly created blocks after the block with `referenceId`
 * (or at the very start when `referenceId` is null).
 */
export function insertBlocksAfter(document, referenceId, newBlocks) {
    const insertIndex =
        referenceId === null || referenceId === undefined
            ? 0
            : getBlockIndex(document, referenceId) + 1;

    if (insertIndex < 0) {
        throw new Error(`Cannot insert after unknown block: ${referenceId}`);
    }

    document.blocks.splice(insertIndex, 0, ...newBlocks);

    // Blank line after the inserted group when it now touches a content block.
    const afterIndex = insertIndex + newBlocks.length;
    const following = document.blocks[afterIndex];
    const lastInserted = document.blocks[afterIndex - 1];

    if (isContentBlock(following) && isContentBlock(lastInserted)) {
        document.blocks.splice(afterIndex, 0, createBlock({ type: "space", raw: "\n\n", originalRaw: "" }));
    }

    // Blank line before the inserted group when it touches a content block.
    const preceding = document.blocks[insertIndex - 1];
    const firstInserted = document.blocks[insertIndex];
    if (isContentBlock(preceding) && isContentBlock(firstInserted)) {
        document.blocks.splice(insertIndex, 0, createBlock({ type: "space", raw: "\n\n", originalRaw: "" }));
    }

    return document;
}

/** Remove a block (and tidy the blank lines it leaves behind). */
export function removeBlock(document, blockId) {
    const index = getBlockIndex(document, blockId);
    if (index === -1) return document;

    document.blocks.splice(index, 1);
    normalizeSpacing(document);
    return document;
}

/** Move a block by a signed offset among content blocks. */
export function moveBlockByOffset(document, blockId, offset) {
    const index = getBlockIndex(document, blockId);
    if (index === -1 || offset === 0) return document;

    const block = document.blocks[index];
    const direction = offset > 0 ? 1 : -1;
    let steps = Math.abs(offset);

    // Locate the content block we will jump across (separators do not count).
    let scanIndex = index;
    let targetIndex = -1;
    while (steps > 0) {
        scanIndex += direction;
        if (scanIndex < 0 || scanIndex >= document.blocks.length) break;
        if (document.blocks[scanIndex].type === "space") continue;
        targetIndex = scanIndex;
        steps -= 1;
    }

    if (targetIndex === -1) return document;

    document.blocks.splice(index, 1);

    // `targetIndex` refers to the pre-splice array; adjust for the removal.
    const anchorIndex = targetIndex > index ? targetIndex - 1 : targetIndex;
    const anchorBlock = document.blocks[anchorIndex];
    if (!anchorBlock) return document;

    document.blocks.splice(direction > 0 ? anchorIndex + 1 : anchorIndex, 0, block);

    normalizeSpacing(document);
    return document;
}

/** Move a block directly before or after another block. */
export function moveBlockTo(document, blockId, targetId, position) {
    const sourceIndex = getBlockIndex(document, blockId);
    const targetIndex = getBlockIndex(document, targetId);
    if (sourceIndex === -1 || targetIndex === -1) return document;

    const [block] = document.blocks.splice(sourceIndex, 1);
    const adjustedTargetIndex = getBlockIndex(document, targetId);

    document.blocks.splice(
        position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1,
        0,
        block
    );

    normalizeSpacing(document);
    return document;
}

/**
 * Re-establish exactly one blank line between adjacent content blocks.
 * Structural edits may drag a block across a separator; this repairs the
 * result without touching any block source.
 */
function normalizeSpacing(document) {
    const blocks = document.blocks.filter(
        (block, index) => !(block.type === "space" && index === document.blocks.length - 1)
    );

    const result = [];
    for (const block of blocks) {
        const previous = result[result.length - 1];

        if (block.type === "space") {
            if (!previous) continue; // no leading blank line
            if (result.length && !isContentBlock(previous)) continue;
            result.push(block);
            continue;
        }

        if (previous && previous.type === "space") {
            result.push(block);
            continue;
        }

        if (previous) {
            result.push(createBlock({ type: "space", raw: "\n\n", originalRaw: "" }));
        }
        result.push(block);
    }

    while (result.length && result[result.length - 1].type === "space") {
        result.pop();
    }

    document.blocks = result;
}

export function duplicateBlock(document, blockId) {
    const index = getBlockIndex(document, blockId);
    if (index === -1) return document;

    const source = document.blocks[index];
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = createBlockId();

    if (clone.type === "list") {
        clone.items = clone.items.map((item) => ({ ...item }));
    }

    document.blocks.splice(index + 1, 0, clone);
    const following = document.blocks[index + 2];
    if (isContentBlock(following) && isContentBlock(clone)) {
        document.blocks.splice(index + 2, 0, createBlock({ type: "space", raw: "\n\n", originalRaw: "" }));
    }

    normalizeSpacing(document);
    return document;
}

/* =========================================================
   Structure helpers (outline / sections)
   ========================================================= */

/**
 * Build the heading outline of the note.
 * @returns {Array<{blockId: string, level: number, title: string, index: number}>}
 */
export function collectSections(document) {
    return document.blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.type === "heading")
        .map(({ block, index }) => ({
            blockId: block.id,
            level: block.depth,
            title: block.text.replace(/[*_`]/g, "").trim(),
            index
        }));
}

/**
 * Index range (inclusive) covered by a heading and its sub-content.
 * Returns null when the block id is not a heading.
 */
export function getSectionRange(document, blockId) {
    const startIndex = getBlockIndex(document, blockId);
    if (startIndex === -1) return null;

    const heading = document.blocks[startIndex];
    if (!heading || heading.type !== "heading") return null;

    let endIndex = startIndex + 1;
    while (endIndex < document.blocks.length) {
        const block = document.blocks[endIndex];
        if (block.type === "heading" && block.depth <= heading.depth) break;
        endIndex += 1;
    }

    return { startIndex, endIndex: endIndex - 1 };
}

function findSectionRangeByHeadingIndex(document, headingIndex) {
    const heading = document.blocks[headingIndex];
    let endIndex = headingIndex + 1;
    while (endIndex < document.blocks.length) {
        const block = document.blocks[endIndex];
        if (block.type === "heading" && block.depth <= heading.depth) break;
        endIndex += 1;
    }
    return { startIndex: headingIndex, endIndex: endIndex - 1 };
}

/**
 * Move an entire section (heading plus everything nested under it) one
 * sibling position up or down. Sections keep their internal order.
 */
export function moveSection(document, blockId, direction) {
    const range = getSectionRange(document, blockId);
    if (!range) return document;

    const heading = document.blocks[range.startIndex];
    const level = heading.depth;

    let siblingIndex = -1;

    if (direction === "up") {
        for (let index = range.startIndex - 1; index >= 0; index--) {
            const block = document.blocks[index];
            if (block.type !== "heading") continue;
            if (block.depth === level) {
                siblingIndex = index;
                break;
            }
            if (block.depth < level) break; // moved outside the parent section
        }
    } else {
        for (let index = range.endIndex + 1; index < document.blocks.length; index++) {
            const block = document.blocks[index];
            if (block.type !== "heading") continue;
            if (block.depth === level) {
                siblingIndex = index;
                break;
            }
            if (block.depth < level) break;
        }
    }

    if (siblingIndex === -1) return document;

    const siblingRange = findSectionRangeByHeadingIndex(document, siblingIndex);
    const removedLength = range.endIndex - range.startIndex + 1;
    const moved = document.blocks.splice(range.startIndex, removedLength);

    const insertAt = direction === "up"
        ? siblingRange.startIndex
        : siblingRange.endIndex + 1 - (siblingRange.startIndex > range.startIndex ? removedLength : 0);

    document.blocks.splice(insertAt, 0, ...moved);
    normalizeSpacing(document);
    return document;
}

/* =========================================================
   Images
   ========================================================= */

const IMAGE_REFERENCE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/;

/** All image blocks of the document, in document order. */
export function collectImageBlocks(document) {
    return document.blocks.filter(
        (block) =>
            (block.type === "paragraph" && block.variant === "image") ||
            (block.type === "paragraph" && block.variant === "placeholder")
    );
}

/** Resolve the asset path referenced by an image block (placeholder aware). */
export function getImageReference(block) {
    if (!block) return { alt: "", src: "", isPlaceholder: false, imageId: "" };

    if (block.variant === "placeholder") {
        return {
            alt: `Image ${block.imageId}`,
            src: "",
            isPlaceholder: true,
            imageId: block.imageId
        };
    }

    return {
        alt: block.alt || "",
        src: block.src || "",
        title: block.title || "",
        isPlaceholder: false,
        imageId: ""
    };
}

/** Convert a `[IMAGE_n]` placeholder block into a normal image reference. */
export function setPlaceholderTarget(block, relativePath, imageId) {
    if (block.type !== "paragraph") return block;
    editBlock(block, {
        variant: "image",
        alt: `Image ${imageId}`,
        src: relativePath,
        title: ""
    });
    delete block.imageId;
    return block;
}

/** Parse `![alt](src)` markdown into image fields (used by insert flows). */
export function parseImageMarkdown(markdownText) {
    const match = String(markdownText || "").trim().match(IMAGE_REFERENCE_PATTERN);
    if (!match) return null;
    return { alt: match[1], src: match[2], title: match[3] || "" };
}

/* =========================================================
   Search & replace
   ========================================================= */

function createTextSegment(text, apply) {
    return { text: String(text ?? ""), apply };
}

/**
 * Text segments of a block that search/replace may touch.
 * Each segment knows how to write its text back, so replacements can never
 * cross a structural boundary (a table cell, a list item, a callout title…).
 */
export function getTextSegments(block) {
    switch (block.type) {
        case "heading":
            return [createTextSegment(block.text, (value) => editBlock(block, { text: value }))];
        case "paragraph":
            if (block.variant === "formula") {
                return [createTextSegment(block.latex, (value) => editBlock(block, { latex: value }))];
            }
            if (block.variant === "placeholder") {
                return [createTextSegment(`[IMAGE_${block.imageId}]`, () => {})];
            }
            if (block.variant === "image") {
                return [
                    createTextSegment(block.alt, (value) => editBlock(block, { alt: value })),
                    createTextSegment(block.src, (value) => editBlock(block, { src: value }))
                ];
            }
            if (block.variant === "metadata") {
                return [
                    createTextSegment(block.label, (value) => editBlock(block, { label: value })),
                    createTextSegment(block.value, (value) => editBlock(block, { value: value }))
                ];
            }
            return [createTextSegment(block.text, (value) => editBlock(block, { text: value }))];
        case "blockquote":
            return [
                createTextSegment(block.title || "", (value) => editBlock(block, { title: value })),
                createTextSegment(block.lines.join("\n"), (value) =>
                    editBlock(block, { lines: String(value).split("\n") })
                )
            ];
        case "question":
            return [
                ...block.promptLines.map((line, lineIndex) =>
                    createTextSegment(line, (value) => {
                        block.promptLines[lineIndex] = value;
                        rebuildQuestionLines(block);
                    })
                ),
                ...block.options.map((option, optionIndex) =>
                    createTextSegment(option.text, (value) => {
                        option.text = value;
                        rebuildQuestionLines(block);
                    })
                ),
                ...block.answerLines.map((line, lineIndex) =>
                    createTextSegment(line, (value) => {
                        block.answerLines[lineIndex] = value;
                        rebuildQuestionLines(block);
                    })
                )
            ];
        case "list":
            return block.items.map((item, itemIndex) =>
                createTextSegment(item.text, (value) =>
                    editBlock(block, { __itemIndex: itemIndex, text: value })
                )
            );
        case "table":
            return [
                ...block.header.map((cell, cellIndex) =>
                    createTextSegment(cell.text, (value) => {
                        cell.text = value;
                        refreshBlock(block);
                    })
                ),
                ...block.rows.flatMap((row, rowIndex) =>
                    row.map((cellText, cellIndex) =>
                        createTextSegment(cellText, (value) => {
                            block.rows[rowIndex][cellIndex] = value;
                            refreshBlock(block);
                        })
                    )
                )
            ];
        case "code":
            return [createTextSegment(block.text, (value) => editBlock(block, { text: value }))];
        case "html":
        case "unknown":
        case "def":
            return [createTextSegment(block.raw, (value) => editBlock(block, { raw: value }))];
        default:
            return [];
    }
}

/**
 * Find every occurrence of `query` in the document.
 * @returns {Array<{blockId: string, segmentIndex: number, start: number, end: number, preview: string}>}
 */
export function searchDocument(document, query, options = {}) {
    const caseSensitive = Boolean(options.caseSensitive);
    if (!query) return [];

    const needle = caseSensitive ? query : query.toLowerCase();
    const matches = [];

    for (const block of document.blocks) {
        if (block.type === "space") continue;

        const segments = getTextSegments(block);
        segments.forEach((segment, segmentIndex) => {
            const haystack = caseSensitive ? segment.text : segment.text.toLowerCase();
            let fromIndex = 0;

            for (;;) {
                const start = haystack.indexOf(needle, fromIndex);
                if (start === -1) break;

                const end = start + needle.length;
                matches.push({
                    blockId: block.id,
                    segmentIndex,
                    start,
                    end,
                    preview: segment.text.slice(Math.max(0, start - 24), end + 24)
                });
                fromIndex = end;
            }
        });
    }

    return matches;
}

/** Replace one specific match; returns true when something changed. */
export function replaceMatch(document, match, replacement) {
    const block = getBlock(document, match.blockId);
    if (!block) return false;

    const segments = getTextSegments(block);
    const segment = segments[match.segmentIndex];
    if (!segment) return false;

    const nextText =
        segment.text.slice(0, match.start) + replacement + segment.text.slice(match.end);

    if (nextText === segment.text) return false;
    segment.apply(nextText);
    return true;
}

/** Replace every occurrence of `query`; returns how many were replaced. */
export function replaceAllInDocument(document, query, replacement, options = {}) {
    const matches = searchDocument(document, query, options);
    let replacedCount = 0;

    // Replace per block, from the end of each segment backwards so earlier
    // offsets stay valid inside the same segment.
    const bySegment = new Map();
    for (const match of matches) {
        const key = `${match.blockId}:${match.segmentIndex}`;
        if (!bySegment.has(key)) bySegment.set(key, []);
        bySegment.get(key).push(match);
    }

    for (const group of bySegment.values()) {
        const sorted = group.sort((a, b) => b.start - a.start);
        const first = sorted[0];
        const block = getBlock(document, first.blockId);
        if (!block) continue;

        const segments = getTextSegments(block);
        const segment = segments[first.segmentIndex];
        if (!segment) continue;

        let text = segment.text;
        for (const match of sorted) {
            text = text.slice(0, match.start) + replacement + text.slice(match.end);
            replacedCount += 1;
        }
        segment.apply(text);
    }

    return replacedCount;
}

/* =========================================================
   Review markers (content the generator flagged for a human)
   ========================================================= */

const REVIEW_STATUS_PATTERN = /\*\*وضعیت:\*\*\s*(.+)/;
const PENDING_REVIEW_TEXT = "نیازمند بررسی";
const RESOLVED_REVIEW_TEXT = "بررسی‌شده";

/**
 * Locate blocks that carry a human-review marker (⚠ or an explicit status
 * line). Markers are preserved on load and only change on explicit action.
 */
export function collectReviewItems(document) {
    const items = [];

    document.blocks.forEach((block, index) => {
        if (block.type === "space") return;

        const segments = getTextSegments(block);
        const text = segments.map((segment) => segment.text).join("\n");

        const statusMatch = text.match(REVIEW_STATUS_PATTERN);
        const hasWarning = text.includes("⚠");
        const hasStatus = Boolean(statusMatch);

        if (!hasWarning && !hasStatus) return;

        items.push({
            blockId: block.id,
            index,
            status: statusMatch ? statusMatch[1].trim() : "",
            isResolved: statusMatch ? statusMatch[1].includes(RESOLVED_REVIEW_TEXT) : false,
            preview: text.replace(/\n/g, " ").slice(0, 140)
        });
    });

    return items;
}

/** Mark a review item as reviewed by editing its status line in place. */
export function markReviewItemResolved(document, blockId) {
    const block = getBlock(document, blockId);
    if (!block) return false;

    const segments = getTextSegments(block);
    let changed = false;

    for (const segment of segments) {
        if (segment.text.includes(PENDING_REVIEW_TEXT)) {
            segment.apply(segment.text.split(PENDING_REVIEW_TEXT).join(RESOLVED_REVIEW_TEXT));
            changed = true;
        }
    }

    return changed;
}

