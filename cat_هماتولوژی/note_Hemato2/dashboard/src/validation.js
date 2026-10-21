// Checks an edited note for problems that would hurt the exported lecture note.
//
// Every check returns a plain-language issue the operator can act on; nothing
// here rewrites the document. The same module runs in the browser (live panel)
// and on the server (final gate before export).

import { extractInlineMath } from "./inlineMarkup.js";
import { BOX_TYPES } from "./documentModel.js";

// The ten fixed sections Bashligh's template maps onto (see src/main.js).
const REQUIRED_SECTION_TITLES = [
    "۱. مقدمه و کلیات",
    "۲. متن اصلی جزوه",
    "۳. تعاریف",
    "۴. نکات مهم",
    "۵. مثال‌ها",
    "۶. جداول مرور سریع",
    "۷. اصطلاحات و تعاریف کلیدی",
    "۸. موارد نیازمند بررسی",
    "۹. منابع و مراجع",
    "۱۰. گزارش تکمیل بودن محتوا"
];

const REMOTE_ASSET_PATTERN = /^(https?:)?\/\//i;

function createIssue(level, code, message, blockId, detail) {
    return { level, code, message, blockId: blockId || null, detail: detail || "" };
}

function countOccurrences(text, needle) {
    return String(text).split(needle).length - 1;
}

function isBraceBalanced(formula) {
    let depth = 0;
    for (const character of formula) {
        if (character === "{") depth += 1;
        if (character === "}") depth -= 1;
        if (depth < 0) return false;
    }
    return depth === 0;
}

function checkImages(document, context, issues) {
    const assets = new Set(context.assetNames || []);
    const knownPlaceholderIds = new Set(
        (context.manifestImages || []).map((image) => String(image.id))
    );

    const seenPlaceholderIds = new Map();

    document.blocks.forEach((block) => {
        if (block.type !== "paragraph") return;

        if (block.variant === "image") {
            const source = String(block.src || "").trim();
            if (!source) {
                issues.push(
                    createIssue("error", "imageMissingSource", "An image has no file reference.", block.id)
                );
                return;
            }

            if (REMOTE_ASSET_PATTERN.test(source)) return;

            const assetName = source.split("/").pop();
            const isKnown =
                assets.has(assetName) ||
                assets.has(source) ||
                (context.assetNames || []).includes(source);

            if (!isKnown) {
                issues.push(
                    createIssue(
                        "error",
                        "imageNotFound",
                        `Image "${assetName}" cannot be found in the note's assets.`,
                        block.id
                    )
                );
            }
        }

        if (block.variant === "placeholder") {
            const imageId = String(block.imageId);
            if (!knownPlaceholderIds.has(imageId)) {
                issues.push(
                    createIssue(
                        "error",
                        "placeholderUnknown",
                        `Placeholder [IMAGE_${imageId}] has no matching asset in the manifest.`,
                        block.id
                    )
                );
            }

            const seenAt = seenPlaceholderIds.get(imageId);
            if (seenAt) {
                issues.push(
                    createIssue(
                        "warning",
                        "placeholderDuplicated",
                        `Image ${imageId} is inserted twice; the same file will render in both places.`,
                        block.id
                    )
                );
            } else {
                seenPlaceholderIds.set(imageId, block.id);
            }
        }
    });
}

function checkHeadings(document, issues) {
    document.blocks.forEach((block, index) => {
        if (block.type !== "heading") return;

        if (block.text.trim() === "") {
            issues.push(
                createIssue("error", "emptyHeading", "A section heading is empty.", block.id)
            );
            return;
        }

        if (block.depth === 1 && index !== firstContentIndex(document)) {
            // Not fatal: Bashligh only reads the first H1 as the note title.
            const isFirstTitle = document.blocks.findIndex(
                (candidate) => candidate.type === "heading" && candidate.depth === 1
            );
            if (isFirstTitle !== index) {
                issues.push(
                    createIssue(
                        "warning",
                        "extraTitleHeading",
                        `Heading "${block.text.trim().slice(0, 40)}" uses H1; only the first H1 becomes the note title.`,
                        block.id
                    )
                );
            }
        }
    });
}

function firstContentIndex(document) {
    const index = document.blocks.findIndex((block) => block.type !== "space");
    return index === -1 ? 0 : index;
}

function checkSections(document, issues) {
    const sections = document.blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.type === "heading");

    sections.forEach(({ block, index }, position) => {
        const nextHeading = sections
            .slice(position + 1)
            .find((candidate) => candidate.block.depth <= block.depth);

        const sectionEnd = nextHeading ? nextHeading.index : document.blocks.length;
        const hasContent = document.blocks
            .slice(index + 1, sectionEnd)
            .some((candidate) => candidate.type !== "space");

        if (!hasContent) {
            issues.push(
                createIssue(
                    "warning",
                    "emptySection",
                    `Section "${block.text.trim() || "(untitled)"}" contains no content.`,
                    block.id
                )
            );
        }
    });

    const presentTitles = new Set(
        sections.map(({ block }) => block.text.trim().replace(/\s+/g, " "))
    );

    const missingSections = REQUIRED_SECTION_TITLES.filter(
        (title) => !presentTitles.has(title) && !hasLeadingNumber(presentTitles, title)
    );

    if (missingSections.length > 0 && presentTitles.size >= 5) {
        issues.push(
            createIssue(
                "warning",
                "missingRequiredSection",
                `Expected sections are missing: ${missingSections.join(", ")}.`,
                null,
                "Bashligh maps the ten standard sections into its template; a missing section exports as an empty block."
            )
        );
    }
}

function hasLeadingNumber(presentTitles, title) {
    const wantedNumber = title.match(/^(\d+)/)?.[1];
    if (!wantedNumber) return false;

    for (const present of presentTitles) {
        const number = present.match(/^(\d+)/)?.[1];
        if (number && Number(number) === Number(wantedNumber)) return true;
    }
    return false;
}

function checkMath(document, issues) {
    document.blocks.forEach((block) => {
        if (block.type === "paragraph" && block.variant === "formula") {
            const formula = block.latex || "";
            if (!formula.trim()) {
                issues.push(
                    createIssue("error", "emptyFormula", "A display formula is empty.", block.id)
                );
                return;
            }
            if (countOccurrences(formula, "$$") > 0) {
                issues.push(
                    createIssue(
                        "error",
                        "formulaDelimiter",
                        "A display formula contains extra $$ delimiters.",
                        block.id
                    )
                );
            }
            if (!isBraceBalanced(formula)) {
                issues.push(
                    createIssue(
                        "warning",
                        "formulaBraces",
                        "A formula has unbalanced { } braces; KaTeX may not render it.",
                        block.id
                    )
                );
            }
            return;
        }

        if (block.type === "space") return;

        const segments = collectRawText(block);
        const joined = segments.join("\n");

        if (countOccurrences(joined, "$$") % 2 !== 0) {
            issues.push(
                createIssue(
                    "warning",
                    "unclosedDisplayMath",
                    "A $$ display formula is not closed; KaTeX may not render it.",
                    block.id
                )
            );
        }

        for (const formula of extractInlineMath(joined)) {
            const inner = formula.slice(1, -1);
            if (!inner.trim()) {
                issues.push(
                    createIssue(
                        "warning",
                        "emptyInlineMath",
                        "An inline formula is empty ($ $).",
                        block.id
                    )
                );
            } else if (!isBraceBalanced(inner)) {
                issues.push(
                    createIssue(
                        "warning",
                        "formulaBraces",
                        "An inline formula has unbalanced { } braces; KaTeX may not render it.",
                        block.id
                    )
                );
            }
        }
    });
}

function collectRawText(block) {
    switch (block.type) {
        case "paragraph":
            if (block.variant === "formula") return [block.latex];
            if (block.variant === "text") return [block.text];
            if (block.variant === "metadata") return [block.value];
            if (block.variant === "image") return [block.alt, block.src];
            return [];
        case "heading":
            return [block.text];
        case "blockquote":
            return [block.title || "", ...block.lines];
        case "list":
            return block.items.map((item) => item.text);
        case "table":
            return [
                ...block.header.map((cell) => cell.text),
                ...block.rows.flat()
            ];
        case "code":
            return [block.text];
        default:
            return [block.raw];
    }
}

function checkRawBlocks(document, issues) {
    document.blocks.forEach((block) => {
        if (block.type === "unknown" || block.type === "html") {
            const fenceCount = countOccurrences(block.raw, "```");
            if (fenceCount % 2 !== 0) {
                issues.push(
                    createIssue(
                        "warning",
                        "unclosedCodeFence",
                        "A raw block opens a ``` code fence that is never closed.",
                        block.id
                    )
                );
            }

            issues.push(
                createIssue(
                    "info",
                    "rawBlock",
                    "This block uses syntax the visual editor does not model; edit it as Markdown source.",
                    block.id
                )
            );
        }

        if (block.type === "blockquote" && block.kind === "box") {
            if (!BOX_TYPES.includes(block.boxType)) {
                issues.push(
                    createIssue(
                        "warning",
                        "customCallout",
                        `Box type [BOX:${block.boxType.toUpperCase()}] is not one the renderer styles; it will fall back to a plain box.`,
                        block.id
                    )
                );
            }
            if (block.lines.every((line) => line.trim() === "") && !block.title.trim()) {
                issues.push(
                    createIssue(
                        "warning",
                        "emptyCallout",
                        "A box has neither a title nor content.",
                        block.id
                    )
                );
            }
        }

        if (block.type === "question") {
            if (block.promptLines.every((line) => line.trim() === "")) {
                issues.push(
                    createIssue(
                        "warning",
                        "emptyQuestion",
                        `Question ${block.questionNumber} has no prompt text.`,
                        block.id
                    )
                );
            }
            if (block.questionType === "mcq" && block.options.length === 0) {
                issues.push(
                    createIssue(
                        "warning",
                        "questionWithoutOptions",
                        `Multiple-choice question ${block.questionNumber} has no [OPTION:] entries.`,
                        block.id
                    )
                );
            }
            if (block.answerLines.length === 0 && !block.correctAnswer) {
                issues.push(
                    createIssue(
                        "warning",
                        "questionWithoutAnswer",
                        `Question ${block.questionNumber} has no [ANSWER] section.`,
                        block.id
                    )
                );
            }
        }

        if (block.type === "table") {
            if (block.header.some((cell) => !String(cell.text).trim())) {
                issues.push(
                    createIssue(
                        "warning",
                        "emptyTableCell",
                        "A table has an empty header cell.",
                        block.id
                    )
                );
            }
        }
    });
}

function checkTitle(document, issues) {
    const hasTitle = document.blocks.some(
        (block) => block.type === "heading" && block.depth === 1
    );

    if (!hasTitle) {
        issues.push(
            createIssue("warning", "missingTitle", "The note has no H1 title; the exported note will be called \"Untitled Note\".", null)
        );
    }
}

/**
 * Validate an edited note.
 * @param {Object} document - document model from parseDocument()
 * @param {Object} [context] - { assetNames: string[], manifestImages: Array<{id}> }
 * @returns {Array<{level: string, code: string, message: string, blockId: string|null, detail: string}>}
 */
export function validateDocument(document, context = {}) {
    const issues = [];

    checkTitle(document, issues);
    checkImages(document, context, issues);
    checkHeadings(document, issues);
    checkSections(document, issues);
    checkMath(document, issues);
    checkRawBlocks(document, issues);

    const order = { error: 0, warning: 1, info: 2 };
    return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/** Count issues that should be surfaced prominently (errors + warnings). */
export function countActionableIssues(issues) {
    return issues.filter((issue) => issue.level !== "info").length;
}
