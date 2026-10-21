// Tests for the human editing dashboard: round-trip integrity, block edits,
// images, boxes, tables, LaTeX, undo/redo, validation and the export API.
//
// Run with: npm test   (from Bashligh/note_renderer/dashboard)

import { readdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import {
    parseDocument,
    serializeDocument,
    editBlock,
    getBlock,
    getBlockIndex,
    insertBlocksAfter,
    removeBlock,
    moveBlockByOffset,
    duplicateBlock,
    createNewBlock,
    collectSections,
    moveSection,
    collectImageBlocks,
    getImageReference,
    setPlaceholderTarget,
    searchDocument,
    replaceMatch,
    replaceAllInDocument,
    collectReviewItems,
    markReviewItemResolved
} from "../src/documentModel.js";
import { renderInlineForEditing, serializeInlineHtml } from "../src/inlineMarkup.js";
import { validateDocument, countActionableIssues } from "../src/validation.js";
import {
    createHistory,
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    createSaveTracker,
    hasUnsavedChanges
} from "../src/history.js";
import { renderMarkdown } from "../../src/renderer.js";
import { renderNoteHtml } from "../../src/main.js";
import { getTemplate, getRendererConfig, buildExportHtml } from "../src/exporter.js";
import { repositoryRoot, openNote, noteRendererRoot } from "../src/noteStore.js";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDirectory = path.join(dashboardRoot, "tests", "fixtures");
const fixturePath = "Bashligh/note_renderer/dashboard/tests/fixtures/completeNote.md";

let passedTests = 0;

function check(condition, label) {
    if (!condition) {
        throw new Error(`Test failed: ${label}`);
    }
    passedTests += 1;
    console.log(`\u2713 ${label}`);
}

function checkEqual(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(
            `Test failed: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
        );
    }
    check(true, label);
}

async function readIfExists(filePath) {
    try {
        return await readFile(filePath, "utf8");
    } catch {
        return null;
    }
}

/* =========================================================
   1. Round-trip integrity
   ========================================================= */

async function collectMarkdownFiles() {
    const files = [];

    const rootEntries = await readdir(repositoryRoot);
    for (const name of rootEntries) {
        if (name.endsWith(".md")) files.push(path.join(repositoryRoot, name));
    }

    const inputDirectory = path.join(repositoryRoot, "Bashligh/note_renderer/data/input");
    for (const name of await readdir(inputDirectory)) {
        if (name.endsWith(".md")) files.push(path.join(inputDirectory, name));
    }

    const sampleDirectory = path.join(
        repositoryRoot,
        "Bashligh/note_renderer/tests/sample_notes"
    );
    for (const name of await readdir(sampleDirectory)) {
        if (name.endsWith(".md")) files.push(path.join(sampleDirectory, name));
    }

    files.push(path.join(fixturesDirectory, "completeNote.md"));
    return files;
}

async function testRoundTrip() {
    const files = await collectMarkdownFiles();

    for (const filePath of files) {
        const original = await readFile(filePath, "utf8");
        const document = parseDocument(original);
        const serialized = serializeDocument(document);

        checkEqual(
            serialized,
            original,
            `round-trip is byte-exact: ${path.relative(repositoryRoot, filePath)}`
        );
    }

    // A round trip must also survive a second parse (idempotence).
    const fixture = await readFile(path.join(fixturesDirectory, "completeNote.md"), "utf8");
    const firstPass = serializeDocument(parseDocument(fixture));
    const secondPass = serializeDocument(parseDocument(firstPass));
    checkEqual(secondPass, firstPass, "round-trip is idempotent");
}

/* =========================================================
   2. Editing operations
   ========================================================= */

function loadFixtureDocument() {
    return parseDocument(loadFixtureText());
}

let fixtureTextCache = null;
function loadFixtureText() {
    if (fixtureTextCache === null) {
        throw new Error("Fixture text not loaded yet.");
    }
    return fixtureTextCache;
}

function firstBlockOfType(document, predicate) {
    return document.blocks.find((block) => block.type !== "space" && predicate(block));
}

async function testEditingOperations() {
    const original = loadFixtureText();

    // Paragraph edit keeps every other block intact.
    const document = loadFixtureDocument();
    const paragraph = firstBlockOfType(
        document,
        (block) =>
            block.type === "paragraph" &&
            typeof block.text === "string" &&
            block.text.includes("Opening paragraph")
    );
    editBlock(paragraph, { text: "Edited opening paragraph." });

    const output = serializeDocument(document);
    check(output.includes("Edited opening paragraph."), "paragraph edit is serialised");
    check(output.includes("# Fixture Lecture — Complete Note"), "untouched blocks are preserved");
    check(output.includes("| a1 | b1 | c1 |"), "table block is preserved after a text edit");

    // Heading level change.
    const heading = firstBlockOfType(document, (block) => block.type === "heading" && block.depth === 2);
    editBlock(heading, { depth: 3 });
    check(
        serializeDocument(document).includes("### ۱. مقدمه و کلیات"),
        "heading level change is serialised"
    );

    // Block movement.
    const moving = loadFixtureDocument();
    const target = firstBlockOfType(
        moving,
        (block) =>
            block.type === "paragraph" &&
            typeof block.text === "string" &&
            block.text.includes("Opening paragraph")
    );
    check(Boolean(target), "the opening paragraph is found for structural tests");
    const beforeIndex = getBlockIndex(moving, target.id);
    moveBlockByOffset(moving, target.id, 1);
    check(
        getBlockIndex(moving, target.id) > beforeIndex,
        "move block down changes its position"
    );

    // Duplicating and deleting.
    duplicateBlock(moving, target.id);
    const occurrences = serializeDocument(moving).split("Opening paragraph").length - 1;
    check(occurrences === 2, "duplicate block adds a copy");

    removeBlock(moving, target.id);
    check(
        serializeDocument(moving).split("Opening paragraph").length - 1 === 1,
        "delete block removes exactly one copy"
    );

    // Section move keeps the section body together.
    const sectioned = loadFixtureDocument();
    const sections = collectSections(sectioned);
    const secondSection = sections.find((section) => section.title.includes("متن اصلی"));
    const orderBefore = collectSections(sectioned).map((section) => section.blockId).join(",");

    moveSection(sectioned, secondSection.blockId, "up");
    const orderAfter = collectSections(sectioned).map((section) => section.blockId).join(",");

    check(orderBefore !== orderAfter, "section move reorders the outline");
    check(
        serializeDocument(sectioned).includes("### Subtopic"),
        "section body travels with its heading"
    );

    // Structural edits still round-trip through a fresh parse.
    const reparsed = parseDocument(serializeDocument(sectioned));
    check(
        collectSections(reparsed).length === collectSections(sectioned).length,
        "re-parsing a restructured note keeps all sections"
    );
    void original;
}

/* =========================================================
   3. Images
   ========================================================= */

async function testImageOperations() {
    const document = loadFixtureDocument();
    const imageBlock = collectImageBlocks(document).find(
        (block) => block.variant === "image"
    );

    check(Boolean(imageBlock), "image block is detected");

    const reference = getImageReference(imageBlock);
    checkEqual(reference.src, "assets/image10.jpg", "image reference is read from the model");

    // Replace keeps position and caption.
    const positionBefore = getBlockIndex(document, imageBlock.id);
    editBlock(imageBlock, { src: "assets/image11.jpg" });
    const serialized = serializeDocument(document);
    check(serialized.includes("![fixture image](assets/image11.jpg)"), "image replacement serialises");
    check(getBlockIndex(document, imageBlock.id) === positionBefore, "replacement keeps the position");
    check(serialized.includes("*تصویر 1 — اسلاید 4*"), "caption block survives replacement");

    // Insert a new image after the current one.
    const newImage = createNewBlock({
        type: "paragraph",
        variant: "image",
        alt: "added",
        src: "assets/image2.jpg",
        title: "",
        raw: "![added](assets/image2.jpg)",
        originalRaw: ""
    });
    insertBlocksAfter(document, imageBlock.id, [newImage]);

    const withInsertion = serializeDocument(document);
    check(withInsertion.includes("![added](assets/image2.jpg)"), "image insertion is serialised");

    const blockAfterReference = document.blocks
        .slice(positionBefore + 1)
        .find((block) => block.type !== "space");
    check(
        blockAfterReference && blockAfterReference.id === newImage.id,
        "inserted image sits directly after the reference block"
    );

    // Move then remove.
    moveBlockByOffset(document, newImage.id, -1);
    check(
        getBlockIndex(document, newImage.id) < getBlockIndex(document, imageBlock.id),
        "image block can be moved upwards"
    );

    removeBlock(document, newImage.id);
    check(
        !serializeDocument(document).includes("![added](assets/image2.jpg)"),
        "image removal only drops the reference"
    );

    // [IMAGE_n] placeholders can be resolved into real references.
    const placeholder = collectImageBlocks(document).find(
        (block) => block.variant === "placeholder"
    );
    check(Boolean(placeholder), "[IMAGE_n] placeholder is detected");

    setPlaceholderTarget(placeholder, "assets/image1.png", "1");
    check(
        serializeDocument(document).includes("![Image 1](assets/image1.png)"),
        "placeholder converts to an image reference"
    );
}

/* =========================================================
   4. Boxes, tables, lists and LaTeX
   ========================================================= */

async function testBoxesTablesMath() {
    const document = loadFixtureDocument();

    // Box editing serialises back into Bashligh's [BOX:type] syntax.
    const callout = firstBlockOfType(
        document,
        (block) => block.type === "blockquote" && block.kind === "box"
    );
    editBlock(callout, { boxType: "example" });

    const calloutMarkdown = serializeDocument(document);
    check(
        calloutMarkdown.includes("> [BOX:EXAMPLE]"),
        "box type is serialised into the renderer's [BOX:] syntax"
    );

    const calloutHtml = renderMarkdown(calloutMarkdown, {
        theme: "light",
        language: "fa",
        enableMath: true
    });
    check(
        calloutHtml.includes('class="calloutBox calloutBox--example"'),
        "Bashligh renders the edited box with the matching style"
    );

    // Question blocks keep their option/answer markers.
    const question = firstBlockOfType(document, (block) => block.type === "question");
    check(Boolean(question), "[QUESTION:*] blocks are parsed as question blocks");
    check(
        question.questionType === "essay" && question.correctAnswer === "",
        "essay questions parse without a correct answer"
    );

    const mcq = document.blocks.find(
        (block) => block.type === "question" && block.questionType === "mcq"
    );
    check(
        mcq && mcq.options.length === 4 && mcq.correctAnswer === "B",
        "MCQ questions parse their options and correct answer"
    );
    editBlock(question, { promptLines: ["Updated essay prompt."] });
    check(
        serializeDocument(document).includes("[ANSWER]"),
        "question markers survive an edit"
    );

    // Definition boxes keep their original convention.
    const definition = firstBlockOfType(
        document,
        (block) => block.type === "blockquote" && block.kind === "definition"
    );
    check(
        serializeDocument(document).includes("> **تعریف — Fixture Term**"),
        "definition box convention is preserved"
    );

    // Table editing.
    const table = firstBlockOfType(document, (block) => block.type === "table");
    table.rows.push(["a3", "b3", "c3"]);
    editBlock(table, {});

    const tableMarkdown = serializeDocument(document);
    check(tableMarkdown.includes("| a3 | b3 | c3 |"), "new table row is serialised");

    const tableHtml = renderMarkdown(tableMarkdown, {
        theme: "light",
        language: "fa",
        enableMath: true
    });
    check(tableHtml.includes("<table>") && tableHtml.includes("a3"), "renderer outputs the new row");

    table.header[0].text = "Renamed column";
    editBlock(table, {});
    check(
        serializeDocument(document).includes("| Renamed column |"),
        "table header edit is serialised"
    );

    // Lists.
    const list = firstBlockOfType(document, (block) => block.type === "list" && !block.ordered);
    editBlock(list, { __itemIndex: 0, text: "first bullet edited" });
    check(
        serializeDocument(document).includes("- first bullet edited"),
        "list item edit is serialised"
    );

    // LaTeX: display formula and inline formula survive editing.
    const formula = firstBlockOfType(
        document,
        (block) => block.type === "paragraph" && block.variant === "formula"
    );
    check(Boolean(formula), "display formula block is detected");

    editBlock(formula, { latex: "\n\\frac{a+b}{c}\n" });
    const formulaMarkdown = serializeDocument(document);
    check(
        formulaMarkdown.includes("$$\n\\frac{a+b}{c}\n$$"),
        "display formula edit is serialised"
    );

    const mathHtml = renderMarkdown(formulaMarkdown, {
        theme: "light",
        language: "fa",
        enableMath: true
    });
    check(mathHtml.includes("katex"), "KaTeX still renders the formulas");

    check(
        formulaMarkdown.includes("$E = mc^2$"),
        "inline LaTeX is untouched by block edits"
    );

    // Re-parsing the edited document keeps the formula type.
    const reparsed = parseDocument(formulaMarkdown);
    const formulaAgain = firstBlockOfType(
        reparsed,
        (block) => block.type === "paragraph" && block.variant === "formula"
    );
    check(Boolean(formulaAgain), "edited formula still parses as a formula block");
}

/* =========================================================
   5. Inline markup round-trip (browser contenteditable simulation)
   ========================================================= */

async function testInlineMarkup() {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    const ownerDocument = dom.window.document;

    const samples = [
        ["plain text", "plain text"],
        ["**bold text**", "<strong>bold text</strong>"],
        ["*italic text*", "<em>italic text</em>"],
        ["`code`", "<code>code</code>"],
        ["[label](https://example.com)", '<a href="https://example.com">label</a>'],
        ["$E = mc^2$", '<span class="inlineMathSource">$E = mc^2$</span>'],
        ["mixed **bold** and $x_1$", null],
        ["**بـلد** متن فارسی", null]
    ];

    for (const [markdown, expectedHtml] of samples) {
        const html = renderInlineForEditing(markdown);

        if (expectedHtml) {
            check(html.includes(expectedHtml), `inline rendering: ${markdown}`);
        }

        const holder = ownerDocument.createElement("div");
        holder.innerHTML = html;
        const roundTrip = serializeInlineHtml(holder);

        checkEqual(roundTrip, markdown, `inline round-trip: ${markdown}`);
    }

    // Editing the DOM and reading it back must produce Markdown again.
    const holder = ownerDocument.createElement("div");
    holder.innerHTML = "<strong>kept</strong> text";
    checkEqual(serializeInlineHtml(holder), "**kept** text", "DOM edit serialises to Markdown");
}

/* =========================================================
   6. Undo / redo
   ========================================================= */

async function testHistory() {
    const states = ["# One", "# Two", "# Three"];
    const history = createHistory(states[0]);

    pushHistory(history, states[1]);
    pushHistory(history, states[2]);

    check(canUndo(history) && !canRedo(history), "history starts at the newest state");
    checkEqual(undo(history), states[1], "undo returns the previous state");
    check(canRedo(history), "redo becomes available after undo");
    checkEqual(redo(history), states[2], "redo returns the newer state");
    checkEqual(undo(history), states[1], "undo works again after redo");

    // A push after undo discards the redo tail.
    pushHistory(history, "# Four");
    check(!canRedo(history), "redo tail is dropped after a new edit");

    // Identical states are ignored (typing does not spam the stack).
    const beforeLength = history.entries.length;
    pushHistory(history, "# Four");
    checkEqual(history.entries.length, beforeLength, "identical states do not create entries");

    const tracker = createSaveTracker("# One");
    check(hasUnsavedChanges(tracker, "# Two"), "unsaved changes are detected");
    tracker.savedMarkdown = "# Two";
    check(!hasUnsavedChanges(tracker, "# Two"), "saving clears the unsaved flag");
}

/* =========================================================
   7. Search and replace
   ========================================================= */

async function testSearchAndReplace() {
    const document = loadFixtureDocument();

    const matches = searchDocument(document, "Column A");
    check(matches.length === 1, "search reaches table headers");

    const listItemMatches = searchDocument(document, "second bullet");
    check(listItemMatches.length === 1, "search reaches list items");

    const insensitiveMatches = searchDocument(document, "alpha");
    const caseMatches = searchDocument(document, "alpha", { caseSensitive: true });
    check(
        insensitiveMatches.length >= 1 && caseMatches.length < insensitiveMatches.length,
        "case-sensitive search narrows the results"
    );

    const replaced = replaceMatch(document, matches[0], "Renamed header");
    check(replaced, "single replace reports success");
    check(serializeDocument(document).includes("Renamed header"), "single replace is serialised");

    const total = replaceAllInDocument(document, "Alpha", "Gamma");
    check(total >= 1, "replace-all reports the number of replacements");
    check(
        !serializeDocument(document).includes("**Alpha:**"),
        "replace-all updates the document"
    );

    const none = replaceAllInDocument(document, "text-that-does-not-exist", "x");
    checkEqual(none, 0, "replace-all on missing text changes nothing");
}

/* =========================================================
   8. Review markers
   ========================================================= */

async function testReviewMarkers() {
    const document = loadFixtureDocument();
    const items = collectReviewItems(document);

    check(items.length >= 2, "review markers are found");
    check(
        items.every((item) => !item.isResolved),
        "markers start unresolved"
    );

    const first = items[0];
    const changed = markReviewItemResolved(document, first.blockId);
    check(changed, "marking an item as reviewed changes the document");

    const afterItems = collectReviewItems(document);
    check(
        afterItems.some((item) => item.isResolved),
        "resolved markers are recognised"
    );
    check(
        serializeDocument(document).includes("بررسی‌شده"),
        "resolved status is written back to Markdown"
    );
}

/* =========================================================
   9. Validation
   ========================================================= */

async function testValidation() {
    const broken = parseDocument([
        "# Title",
        "",
        "## Empty section",
        "",
        "![missing](assets/does-not-exist.jpg)",
        "",
        "[IMAGE_99]",
        "",
        "## ۱. مقدمه و کلیات",
        "",
        "unclosed $$ formula",
        "",
        "### ",
        ""
    ].join("\n"));

    const issues = validateDocument(broken, {
        assetNames: ["image10.jpg"],
        manifestImages: [{ id: 1, relativePath: "assets/image1.png" }]
    });

    const codes = issues.map((issue) => issue.code);
    check(codes.includes("imageNotFound"), "validation reports a missing image");
    check(codes.includes("placeholderUnknown"), "validation reports an unknown placeholder");
    check(codes.includes("unclosedDisplayMath"), "validation reports unclosed display math");
    check(codes.includes("emptyHeading"), "validation reports an empty heading");
    check(codes.includes("missingTitle") || codes.includes("emptySection"), "validation checks structure");
    check(countActionableIssues(issues) >= 4, "issues are counted for the status bar");

    const clean = parseDocument(
        await readFile(path.join(fixturesDirectory, "completeNote.md"), "utf8")
    );
    const cleanIssues = validateDocument(clean, {
        assetNames: ["image10.jpg", "image1.png", "image1.jpg"],
        manifestImages: [{ id: 1, relativePath: "assets/image1.png" }]
    });
    check(
        cleanIssues.every((issue) => issue.level !== "error"),
        "the fixture note has no blocking errors"
    );
}

/* =========================================================
   10. Export through Bashligh's renderer
   ========================================================= */

async function testExportRendering() {
    const original = await readFile(path.join(fixturesDirectory, "completeNote.md"), "utf8");
    const template = await getTemplate();
    const rendererConfig = await getRendererConfig();

    const originalHtml = renderNoteHtml(original, { template, rendererConfig }).html;
    const roundTrippedHtml = renderNoteHtml(serializeDocument(parseDocument(original)), {
        template,
        rendererConfig
    }).html;

    checkEqual(roundTrippedHtml, originalHtml, "exported HTML is identical after a no-op round-trip");

    for (const marker of ["calloutBox", "katex", "definitionBox", "<table", "data-theme"]) {
        check(originalHtml.includes(marker), `exported HTML contains ${marker}`);
    }

    // Real repository notes must export identically as well.
    const repoNote = await readFile(path.join(repositoryRoot, "output.md"), "utf8");
    const repoOriginal = renderNoteHtml(repoNote, { template, rendererConfig }).html;
    const repoRoundTrip = renderNoteHtml(serializeDocument(parseDocument(repoNote)), {
        template,
        rendererConfig
    }).html;

    checkEqual(repoRoundTrip, repoOriginal, "pipeline note exports unchanged after a round-trip");

    // The dashboard export must be byte-identical to the Bashligh CLI for a
    // note that lives in the renderer's own input folder.
    const rendererNotePath = path.join(repositoryRoot, "Bashligh/note_renderer/data/input/note.md");
    const rendererNote = await openNote(
        "Bashligh/note_renderer/data/input/note.md"
    );
    const rendererSource = await readFile(rendererNotePath, "utf8");
    const cliHtml = renderNoteHtml(rendererSource, { template, rendererConfig }).html;
    const dashboardHtml = (
        await buildExportHtml(rendererSource, rendererNote, {
            exportPath: path.join(noteRendererRoot, "output", "note.html")
        })
    ).html;

    checkEqual(
        dashboardHtml,
        cliHtml,
        "dashboard export is byte-identical to the Bashligh CLI output"
    );
}

/* =========================================================
   11. Import graph (browser modules must agree on their exports)
   ========================================================= */

function collectExports(source) {
    const names = new Set();

    for (const match of source.matchAll(
        /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g
    )) {
        names.add(match[1]);
    }

    for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const part of match[1].split(",")) {
            const token = part.trim();
            if (!token) continue;
            const [imported] = token.split(/\s+as\s+/);
            names.add(imported.trim());
        }
    }

    return names;
}

function resolveSpecifier(fromFile, specifier) {
    if (specifier === "marked" || specifier === "jsdom" || specifier === "katex") {
        return path.join(repositoryRoot, "Bashligh/note_renderer/node_modules", specifier, "index.js");
    }
    if (specifier.startsWith("/dashboard/")) {
        return path.join(dashboardRoot, specifier.slice("/dashboard/".length));
    }
    if (specifier.startsWith("/src/")) {
        return path.join(repositoryRoot, "Bashligh/note_renderer", specifier.slice(1));
    }
    if (specifier.startsWith("/node_modules/")) {
        return path.join(repositoryRoot, "Bashligh/note_renderer", specifier.slice(1));
    }
    if (specifier.startsWith(".")) {
        return path.resolve(path.dirname(fromFile), specifier);
    }
    return null;
}

async function listJavaScriptFiles(directory) {
    const names = await readdir(directory);
    return names
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(directory, name));
}

async function testImportGraph() {
    const files = [
        ...(await listJavaScriptFiles(path.join(dashboardRoot, "public", "js"))),
        ...(await listJavaScriptFiles(path.join(dashboardRoot, "src")))
    ];
    let checkedImports = 0;

    for (const filePath of files) {
        const source = await readFile(filePath, "utf8");

        for (const match of source.matchAll(
            /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g
        )) {
            const specifier = match[2];
            const targetPath = resolveSpecifier(filePath, specifier);
            if (!targetPath) continue;

            // Package entry points are not source files we can inspect.
            if (specifier === "marked" || specifier === "jsdom" || specifier === "katex") continue;

            const targetSource = await readIfExists(targetPath);
            check(targetSource !== null, `import resolves: ${specifier} (from ${path.basename(filePath)})`);

            const exports = collectExports(targetSource);
            for (const part of match[1].split(",")) {
                const token = part.trim();
                if (!token) continue;
                const [imported] = token.split(/\s+as\s+/);
                const name = imported.trim();
                if (!name) continue;

                check(
                    exports.has(name),
                    `${path.basename(filePath)} imports "${name}" from ${path.basename(targetPath)}`
                );
            }

            checkedImports += 1;
        }
    }

    check(checkedImports > 0, `import graph inspected (${checkedImports} imports)`);
}

/* =========================================================
   12. Server API: open, save, render, validate, export
   ========================================================= */

async function waitForServer(port, attempts = 60) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (response.ok) return true;
        } catch {
            // server not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
}

async function collectAbsoluteUrls() {
    const urls = new Set();
    const files = [
        ...(await listJavaScriptFiles(path.join(dashboardRoot, "public", "js"))),
        ...(await listJavaScriptFiles(path.join(dashboardRoot, "src")))
    ];

    for (const filePath of files) {
        const source = await readFile(filePath, "utf8");
        for (const match of source.matchAll(/from\s+["'](\/[^"']+)["']/g)) {
            urls.add(match[1]);
        }
    }

    const html = await readFile(path.join(dashboardRoot, "public", "index.html"), "utf8");
    for (const match of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) {
        urls.add(match[1]);
    }
    for (const match of html.matchAll(/"(\/node_modules\/[^"\s]+)"/g)) {
        urls.add(match[1]);
    }

    return [...urls];
}

/** Every module and asset the page loads must be served by the server. */
async function testServedAssets(base) {
    const urls = await collectAbsoluteUrls();
    check(urls.length > 5, `collected ${urls.length} served assets to verify`);

    for (const url of urls) {
        const response = await fetch(`${base}${url}`);
        checkEqual(response.status, 200, `served: ${url}`);
    }
}

async function testServerApi() {
    const port = 4611;
    const server = spawn(process.execPath, ["server.js"], {
        cwd: dashboardRoot,
        env: { ...process.env, DASHBOARD_PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"]
    });

    let serverLog = "";
    server.stdout.on("data", (chunk) => {
        serverLog += chunk;
    });
    server.stderr.on("data", (chunk) => {
        serverLog += chunk;
    });

    const base = `http://127.0.0.1:${port}`;

    const post = async (action, body) => {
        const response = await fetch(`${base}/api/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return { status: response.status, payload: await response.json() };
    };

    try {
        const healthy = await waitForServer(port);
        check(healthy, "dashboard server starts");

        const health = await (await fetch(`${base}/api/health`)).json();
        check(health.ok === true, "health endpoint answers");

        // The bare origin must load the dashboard, not a JSON 404.
        const rootResponse = await fetch(`${base}/`);
        checkEqual(rootResponse.status, 200, "the root URL serves the dashboard shell");
        const rootHtml = await rootResponse.text();
        check(rootHtml.startsWith("<!DOCTYPE html>"), "the root URL returns index.html");

        // The browser's default icon request is answered, never a 404.
        const faviconResponse = await fetch(`${base}/favicon.ico`);
        checkEqual(faviconResponse.status, 200, "the default favicon request is answered");

        const notes = await (await fetch(`${base}/api/notes`)).json();
        check(
            Array.isArray(notes.notes) &&
                notes.notes.some((note) => note.path === "output.md"),
            "note candidates list the generated pipeline note"
        );

        const opened = await post("open", { path: fixturePath });
        checkEqual(opened.status, 200, "note opens through the API");
        check(opened.payload.assets.length > 0, "asset list is returned on open");
        check(
            Array.isArray(opened.payload.manifestImages),
            "image manifest field is always present"
        );

        const pipelineNote = await post("open", { path: "output.md" });
        checkEqual(pipelineNote.status, 200, "the generated pipeline note opens");
        check(
            pipelineNote.payload.manifestImages.length > 0,
            "the pipeline image manifest is returned on open"
        );

        const noteId = opened.payload.noteId;
        const markdown = opened.payload.markdown;

        // Preview through Bashligh's renderer.
        const rendered = await post("render", { noteId, markdown });
        check(rendered.payload.ok === true, "preview render succeeds");

        const previewResponse = await fetch(`${base}/preview/${noteId}.html`);
        checkEqual(previewResponse.status, 200, "preview document is served");
        const previewHtml = await previewResponse.text();
        check(previewHtml.includes("calloutBox"), "preview HTML comes from the Bashligh renderer");
        check(previewHtml.includes(`/data/${noteId}/`), "preview image URLs point at the dashboard assets route");

        const firstAsset = opened.payload.assets[0];
        const assetResponse = await fetch(`${base}${firstAsset.url}`);
        checkEqual(assetResponse.status, 200, "asset files are served");

        // Validation.
        const validation = await post("validate", { noteId, markdown });
        check(Array.isArray(validation.payload.issues), "validation returns issues");

        // Save (safe edited copy only).
        const editedMarkdown = `${markdown}\n\nEdited by the dashboard test.\n`;
        const saved = await post("save", { noteId, markdown: editedMarkdown });
        checkEqual(saved.status, 200, "note saves through the API");
        check(saved.payload.savedPath.includes("edited/"), "saving targets the edited/ copy");

        const originalOnDisk = await readFile(
            path.join(repositoryRoot, fixturePath),
            "utf8"
        );
        check(
            !originalOnDisk.includes("Edited by the dashboard test."),
            "the generated original is never overwritten by a normal save"
        );

        const reopened = await post("open", { path: fixturePath });
        check(
            reopened.payload.markdown.includes("Edited by the dashboard test."),
            "reopening loads the saved edited copy"
        );

        // Export.
        const exported = await post("export", { noteId, markdown: editedMarkdown });
        checkEqual(exported.payload.blocked, false, "export is not blocked for the fixture note");
        check(
            typeof exported.payload.exportPath === "string",
            "export returns the produced HTML path"
        );

        const exportFile = path.join(
            repositoryRoot,
            "Bashligh",
            "note_renderer",
            exported.payload.exportPath
        );
        const exportHtml = await readFile(exportFile, "utf8");
        check(exportHtml.includes("calloutBox"), "exported HTML keeps Bashligh's box markup");
        check(exportHtml.includes("katex"), "exported HTML keeps KaTeX rendering");
        check(
            exportHtml.includes("Edited by the dashboard test."),
            "exported HTML contains the edited content"
        );

        const exportResponse = await fetch(
            `${base}/exports/${path.basename(exportFile)}`
        );
        checkEqual(exportResponse.status, 200, "exported HTML can be opened from the dashboard");

        // A broken image reference blocks the export until forced.
        const brokenMarkdown = `${editedMarkdown}\n![broken](assets/definitely-missing.jpg)\n`;
        const blocked = await post("export", { noteId, markdown: brokenMarkdown });
        checkEqual(blocked.payload.blocked, true, "broken image references block the export");

        const forced = await post("export", { noteId, markdown: brokenMarkdown, force: true });
        checkEqual(forced.payload.blocked, false, "the operator can force an export anyway");

        // Path safety.
        const escapeAttempt = await post("open", { path: "../../etc/passwd" });
        check(escapeAttempt.status >= 400, "paths outside the project are rejected");

        // Everything the page imports must actually be served.
        await testServedAssets(base);
    } finally {
        server.kill("SIGTERM");
    }

    void serverLog;
}

/* =========================================================
   Runner
   ========================================================= */

async function main() {
    console.log("Running dashboard tests...\n");

    fixtureTextCache = await readFile(path.join(fixturesDirectory, "completeNote.md"), "utf8");

    await testRoundTrip();
    await testEditingOperations();
    await testImageOperations();
    await testBoxesTablesMath();
    await testInlineMarkup();
    await testHistory();
    await testSearchAndReplace();
    await testReviewMarkers();
    await testValidation();
    await testExportRendering();
    await testImportGraph();
    await testServerApi();

    // Clean the artefacts the server test produced.
    await rm(path.join(fixturesDirectory, "edited"), { recursive: true, force: true });
    await rm(path.join(repositoryRoot, "Bashligh/note_renderer/output/completeNote.html"), {
        force: true
    });

    console.log(`\n${passedTests} tests passed.`);
}

main().catch(async (error) => {
    console.error(`\n${error.message}`);
    await rm(path.join(fixturesDirectory, "edited"), { recursive: true, force: true });
    await rm(path.join(repositoryRoot, "Bashligh/note_renderer/output/completeNote.html"), {
        force: true
    });
    process.exit(1);
});
