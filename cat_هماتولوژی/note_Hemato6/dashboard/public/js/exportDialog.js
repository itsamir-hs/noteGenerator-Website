// Final review dialog: summarises the note, shows the validation results and
// runs the export through Bashligh's renderer.

import { state, countWords } from "./state.js";
import { on, emit } from "./bus.js";
import { currentMarkdown } from "./documentController.js";
import {
    collectSections,
    collectImageBlocks,
    serializeDocument
} from "/dashboard/src/documentModel.js";
import { computeIssues, renderIssueList } from "./validationView.js";
import { api } from "./api.js";
import { toast, confirmAction, reportError } from "./ui.js";

let dialog = null;
let summaryElement = null;
let issueListElement = null;
let targetElement = null;
let confirmButton = null;

function card(label, value, warning = false) {
    const wrapper = document.createElement("div");
    wrapper.className = "summaryCard";

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = value;
    if (warning) description.className = "is_warning";

    wrapper.append(term, description);
    return wrapper;
}

function pendingReviewCount() {
    return (state.reviewItems || []).filter((item) => !item.isResolved).length;
}

function renderSummary() {
    if (!summaryElement || !state.document) return;

    const markdown = currentMarkdown();
    const sections = collectSections(state.document).filter(
        (section) => section.level === 2
    );
    const images = collectImageBlocks(state.document);
    const pendingReview = pendingReviewCount();
    const words = countWords(markdown);

    summaryElement.replaceChildren(
        card("Title", documentTitle()),
        card("Sections", String(sections.length)),
        card("Words", String(words)),
        card("Images", String(images.length)),
        card("Review pending", String(pendingReview), pendingReview > 0),
        card(
            "Last saved",
            state.savedAt ? new Date(state.savedAt).toLocaleString() : "Not saved yet",
            !state.savedAt
        )
    );

    const unsaved = serializeDocument(state.document) !== state.savedMarkdown;
    if (unsaved) {
        summaryElement.appendChild(
            card("Changes", "Unsaved changes", true)
        );
    }
}

function documentTitle() {
    const heading = state.document.blocks.find(
        (block) => block.type === "heading" && block.depth === 1
    );
    if (heading && heading.text.trim()) return heading.text.trim();

    const firstHeading = state.document.blocks.find((block) => block.type === "heading");
    return firstHeading ? firstHeading.text.trim() : "Untitled note";
}

function exportTargetPath() {
    const baseName = (state.noteName || "note").replace(/\.md$/i, "");
    return `Bashligh/note_renderer/output/${baseName}.html`;
}

function renderTarget() {
    if (targetElement) {
        targetElement.textContent = `Export target: ${exportTargetPath()}`;
    }
}

/** Open the final review dialog. */
export function openExportDialog() {
    if (!dialog || !state.document) return;

    renderSummary();
    renderTarget();
    renderIssueList(issueListElement, computeIssues());

    if (!dialog.open) dialog.showModal();
}

async function performExport(force) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Exporting…";

    try {
        const result = await api.exportNote(state.noteId, currentMarkdown(), force);

        if (result.blocked) {
            const blocking = (result.issues || []).filter(
                (issue) => issue.level === "error"
            );
            const confirmed = await confirmAction({
                title: "Export with problems?",
                message: `${blocking.length} error(s) were found, for example: ${blocking[0]?.message ?? "unknown problem"} Exporting anyway may produce a note with missing images or empty sections.`,
                confirmLabel: "Export anyway"
            });

            if (confirmed) return performExport(true);
            renderIssueList(issueListElement, result.issues || []);
            return;
        }

        renderIssueList(issueListElement, result.issues || []);

        const fileName = String(result.exportPath).split("/").pop();
        const exportUrl = `/exports/${encodeURIComponent(fileName)}`;

        toast(`Exported through Bashligh: ${result.exportPath}`, "success");

        if (dialog.open) dialog.close();
        window.open(exportUrl, "_blank", "noopener");

        emit("note:exported", { exportPath: result.exportPath, exportUrl });
    } catch (error) {
        reportError(error, "Export failed.");
    } finally {
        confirmButton.disabled = false;
        confirmButton.textContent = "Export through Bashligh";
    }
}

export function initExportDialog() {
    dialog = document.getElementById("exportDialog");
    summaryElement = document.getElementById("exportSummary");
    issueListElement = document.getElementById("exportIssueList");
    targetElement = document.getElementById("exportTarget");
    confirmButton = document.getElementById("exportConfirmButton");

    if (!dialog) return;

    document.getElementById("exportButton").addEventListener("click", openExportDialog);
    document.getElementById("exportCancelButton").addEventListener("click", () => dialog.close());

    document
        .getElementById("exportSaveButton")
        .addEventListener("click", () => emit("save:request", { overwriteOriginal: false }));

    confirmButton.addEventListener("click", () => performExport(false));

    on("save:state", () => {
        if (dialog.open) renderSummary();
    });
}
