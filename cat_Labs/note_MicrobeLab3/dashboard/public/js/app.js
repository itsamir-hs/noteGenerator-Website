// Application bootstrap: wires the panels, shortcuts, saving, autosave and
// session recovery for the human editing dashboard.

import { api } from "./api.js";
import { state, countWords } from "./state.js";
import { on, emit } from "./bus.js";
import {
    loadNote,
    currentMarkdown,
    undoEdit,
    redoEdit,
    markSaved,
    setSaveState,
    isDirty,
    getUndoState,
    replaceDocumentFromMarkdown
} from "./documentController.js";
import { collectSections, collectImageBlocks } from "/dashboard/src/documentModel.js";

import { initEditorView, navigateToBlock } from "./editorView.js";
import { initOutlineView } from "./outlineView.js";
import { initAssetPanel } from "./assetPanel.js";
import { initReviewView } from "./reviewView.js";
import {
    initValidationView,
    setIssueJumpHandler
} from "./validationView.js";
import { initPreviewView, refreshPreview } from "./previewView.js";
import { initFindReplaceView, openFindDialog } from "./findReplaceView.js";
import { initExportDialog } from "./exportDialog.js";
import { initToolbar, runFormattingCommand } from "./toolbar.js";
import { initLayoutManager } from "./layoutManager.js";
import { toast, confirmAction, reportError, refreshIcons } from "./ui.js";

const LAST_NOTE_KEY = "noteEditingDashboard:lastNote";
const DRAFT_KEY = "noteEditingDashboard:draft";
const THEME_KEY = "noteTheme"; // same key Bashligh's note uses
const AUTOSAVE_INTERVAL_MS = 20000;
const DRAFT_DEBOUNCE_MS = 1500;

let openDialog = null;
let openPathInput = null;
let draftTimer = null;

/* =========================================================
   Panels, views and chrome
   ========================================================= */

function setPanel(panelName) {
    state.panel = panelName;
    document.body.dataset.panel = panelName;

    for (const tab of document.querySelectorAll(".dashTab")) {
        const isActive = tab.dataset.panel === panelName;
        tab.classList.toggle("isActive", isActive);
        tab.setAttribute("aria-selected", String(isActive));
    }

    for (const panel of document.querySelectorAll(".dashPanel")) {
        const isActive = panel.id === `panel-${panelName}`;
        panel.classList.toggle("is_active", isActive);
        panel.hidden = !isActive;
    }
}

function initPanels() {
    for (const tab of document.querySelectorAll(".dashTab")) {
        tab.addEventListener("click", () => setPanel(tab.dataset.panel));
    }

    // The sidebar toggle is owned by the layout manager (see layoutManager.js).

    setPanel("outline");
}

function initViewSwitcher() {
    // The old Edit/Preview/Structure switcher is superseded by the layout
    // manager's per-window controls; mode switching is owned by the layout
    // manager too. Kept as a no-op guard for the status-bar buttons.
}

function initThemeSwitcher() {
    const select = document.getElementById("themeSelect");
    if (!select) return;

    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored) {
        document.documentElement.dataset.theme = stored;
        select.value = stored;
    }

    select.addEventListener("change", () => {
        document.documentElement.dataset.theme = select.value;
        window.localStorage.setItem(THEME_KEY, select.value);
    });
}

/* =========================================================
   Status bar
   ========================================================= */

const SAVE_LABELS = {
    empty: "No note open",
    clean: "All changes saved",
    dirty: "Unsaved changes…",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed"
};

function renderSaveStatus() {
    const pill = document.getElementById("saveStatus");
    const savedStatus = document.getElementById("statusSaved");

    if (!pill) return;

    const saveState = state.saveState || "empty";
    pill.textContent = SAVE_LABELS[saveState] || saveState;
    pill.className = "saveStatus";

    if (saveState === "dirty" || saveState === "saving") pill.classList.add("is_dirty");
    if (saveState === "clean" || saveState === "saved") pill.classList.add("is_saved");
    if (saveState === "error") pill.classList.add("is_error");

    if (savedStatus) {
        savedStatus.textContent = state.savedAt
            ? `Last saved ${new Date(state.savedAt).toLocaleTimeString()}`
            : "Not saved yet";
    }
}

function renderCounts() {
    const element = document.getElementById("statusCounts");
    if (!element || !state.document) return;

    const markdown = currentMarkdown();
    const sections = collectSections(state.document).filter((section) => section.level === 2);
    const images = collectImageBlocks(state.document);

    element.textContent = `${countWords(markdown)} words · ${sections.length} sections · ${images.length} images`;
}

function renderHistoryButtons() {
    const { canUndo, canRedo } = getUndoState();

    const undoButton = document.getElementById("undoButton");
    const redoButton = document.getElementById("redoButton");

    if (undoButton) undoButton.disabled = !canUndo;
    if (redoButton) redoButton.disabled = !canRedo;
}

/* =========================================================
   Opening notes
   ========================================================= */

async function populateNoteCandidates() {
    try {
        const result = await api.listNotes();

        const list = document.getElementById("noteCandidateList");
        const datalist = document.getElementById("notePathList");

        if (list) {
            list.replaceChildren();

            for (const note of result.notes) {
                const item = document.createElement("li");

                const button = document.createElement("button");
                button.type = "button";
                button.className = "noteCandidate";

                const name = document.createElement("span");
                name.textContent = note.path;

                const kind = document.createElement("span");
                kind.className = "noteCandidateKind";
                kind.textContent = note.kind === "renderer" ? "renderer input" : "pipeline output";

                button.append(name, kind);
                button.addEventListener("click", () => {
                    openPathInput.value = note.path;
                    openNoteByPath(note.path);
                });

                item.appendChild(button);
                list.appendChild(item);
            }
        }

        if (datalist) {
            datalist.replaceChildren();
            for (const note of result.notes) {
                const option = document.createElement("option");
                option.value = note.path;
                datalist.appendChild(option);
            }
        }
    } catch (error) {
        reportError(error, "The note list could not be loaded.");
    }
}

function showOpenDialog() {
    if (!openDialog) return;
    populateNoteCandidates();
    if (!openDialog.open) openDialog.showModal();
    openPathInput.focus();
}

function storeDraft() {
    if (!state.noteId || !state.notePath) return;

    try {
        window.localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({
                path: state.notePath,
                markdown: currentMarkdown(),
                updatedAt: new Date().toISOString()
            })
        );
    } catch {
        // Storage may be full; drafts are a convenience, not a requirement.
    }
}

function clearDraft() {
    try {
        window.localStorage.removeItem(DRAFT_KEY);
    } catch {
        // Ignore storage errors.
    }
}

function readDraft() {
    try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function maybeRestoreDraft(notePath, openedMarkdown) {
    const draft = readDraft();
    if (!draft || draft.path !== notePath) return;
    if (draft.markdown === openedMarkdown) {
        clearDraft();
        return;
    }

    const restore = await confirmAction({
        title: "Restore unsaved changes?",
        message: `You have unsaved edits of this note from a previous session (${new Date(
            draft.updatedAt
        ).toLocaleString()}). Restore them?`,
        confirmLabel: "Restore"
    });

    if (restore) {
        emit("draft:restore", { markdown: draft.markdown });
    } else {
        clearDraft();
    }
}

async function openNoteByPath(path) {
    if (!path) return;

    if (isDirty()) {
        const proceed = await confirmAction({
            title: "Discard unsaved changes?",
            message: "The current note has unsaved changes. Opening another note keeps the last saved version only.",
            confirmLabel: "Open anyway"
        });
        if (!proceed) return;
    }

    try {
        const payload = await api.openNote(path);

        loadNote(payload);
        window.localStorage.setItem(LAST_NOTE_KEY, path);

        document.getElementById("noteName").textContent = payload.path;
        document.getElementById("noteName").title = payload.path;

        if (payload.editedExists) {
            toast(`Opened the saved edit of ${payload.path} (original kept).`, "success");
        }

        refreshPreview();
        await maybeRestoreDraft(payload.path, payload.markdown);
    } catch (error) {
        reportError(error, "Unable to open the note.");
    }
}

/* =========================================================
   Saving
   ========================================================= */

async function saveNote({ overwriteOriginal = false, quiet = false } = {}) {
    if (!state.noteId) {
        toast("Open a note first.");
        return false;
    }

    if (!isDirty() && !overwriteOriginal && quiet) return false;

    setSaveState("saving");
    const markdown = currentMarkdown();

    try {
        const result = await api.saveNote(state.noteId, markdown, overwriteOriginal);

        markSaved({
            savedMarkdown: markdown,
            savedAt: result.savedAt,
            savedPath: result.savedPath
        });

        clearDraft();

        if (!quiet) {
            toast(
                result.overwroteOriginal
                    ? `Saved and overwrote the original: ${result.savedPath}`
                    : `Saved to ${result.savedPath}`,
                "success"
            );
        }
        return true;
    } catch (error) {
        setSaveState("error");
        reportError(error, "Saving failed.");
        return false;
    }
}

async function requestSave() {
    if (!state.noteId) {
        showOpenDialog();
        return;
    }

    // Saves always target the safe edited/ copy unless the operator explicitly
    // asks to overwrite the generated original (Ctrl+Shift+S).
    await saveNote({});
}

function scheduleDraftPersist() {
    if (draftTimer) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
        draftTimer = null;
        storeDraft();
    }, DRAFT_DEBOUNCE_MS);
}

function initAutosave() {
    window.setInterval(() => {
        if (!state.noteId) return;
        if (!isDirty()) return;
        saveNote({ quiet: true });
    }, AUTOSAVE_INTERVAL_MS);
}

/* =========================================================
   Shortcuts
   ========================================================= */

function isTextEntry(target) {
    if (!target) return false;
    const tagName = target.tagName;
    // Inside raw text fields the browser's own undo is the right behaviour.
    return tagName === "TEXTAREA" || tagName === "INPUT";
}

function initShortcuts() {
    window.addEventListener("keydown", (event) => {
        const modifier = event.ctrlKey || event.metaKey;
        if (!modifier) return;

        const key = event.key.toLowerCase();

        if (key === "s") {
            event.preventDefault();
            if (event.shiftKey) {
                confirmAction({
                    title: "Overwrite the original note?",
                    message: "The generated source file will be replaced by your edited version. The safe default is saving to the edited/ copy.",
                    confirmLabel: "Overwrite original"
                }).then((confirmed) => {
                    if (confirmed) saveNote({ overwriteOriginal: true });
                });
            } else {
                requestSave();
            }
            return;
        }

        if (key === "z" && !isTextEntry(event.target)) {
            event.preventDefault();
            if (event.shiftKey) redoEdit();
            else undoEdit();
            return;
        }

        if (key === "y" && !isTextEntry(event.target)) {
            event.preventDefault();
            redoEdit();
            return;
        }

        if (key === "f") {
            event.preventDefault();
            openFindDialog(event.shiftKey);
            return;
        }

        // Inline formatting goes through the toolbar's command path so the
        // caret (which may no longer sit inside the block after clicking
        // elsewhere) is restored before the command runs.
        if (key === "b" || key === "i" || key === "k") {
            if (isTextEntry(event.target)) return;
            const command = key === "b" ? "bold" : key === "i" ? "italic" : "link";
            const applied = runFormattingCommand(command);
            if (applied) event.preventDefault();
            return;
        }

        if (key === "o") {
            event.preventDefault();
            showOpenDialog();
            return;
        }

        if (key === "enter") {
            event.preventDefault();
            refreshPreview();
        }
    });

    window.addEventListener("beforeunload", (event) => {
        if (!isDirty()) return;
        storeDraft();
        event.preventDefault();
        event.returnValue = "";
    });
}

/* =========================================================
   Wiring
   ========================================================= */

function initHeaderActions() {
    document.getElementById("openButton").addEventListener("click", showOpenDialog);
    document.getElementById("saveButton").addEventListener("click", requestSave);
    document.getElementById("undoButton").addEventListener("click", () => undoEdit());
    document.getElementById("redoButton").addEventListener("click", () => redoEdit());
    document.getElementById("findButton").addEventListener("click", () => openFindDialog(false));
    document
        .getElementById("validateButton")
        .addEventListener("click", () => setPanel("issues"));
    document
        .getElementById("helpButton")
        .addEventListener("click", () => document.getElementById("helpDialog").showModal());
    document
        .getElementById("helpCloseButton")
        .addEventListener("click", () => document.getElementById("helpDialog").close());
}

function initOpenDialog() {
    openDialog = document.getElementById("openDialog");
    openPathInput = document.getElementById("openPathInput");

    document.getElementById("openForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const path = openPathInput.value.trim();
        openDialog.close();
        openNoteByPath(path);
    });

    document.getElementById("openCancelButton").addEventListener("click", () => openDialog.close());
}

function initEvents() {
    on("save:state", renderSaveStatus);
    on("document:changed", () => {
        renderCounts();
        scheduleDraftPersist();
    });
    on("document:restored", renderCounts);
    on("note:loaded", () => {
        renderCounts();
        renderSaveStatus();
        renderHistoryButtons();
    });
    on("history:changed", renderHistoryButtons);
    on("save:request", (payload) => saveNote(payload || {}));
    on("panel:requested", ({ panel }) => {
        setPanel(panel);
    });

    setIssueJumpHandler((blockId) => {
        setPanel("issues");
        navigateToBlock(blockId);
    });

    on("draft:restore", ({ markdown }) => {
        replaceDocumentFromMarkdown(markdown);
        toast("Unsaved changes from your last session were restored.", "success");
    });
}

async function boot() {
    refreshIcons();

    initPanels();
    initViewSwitcher();
    initLayoutManager();
    initThemeSwitcher();
    initHeaderActions();
    initOpenDialog();
    initToolbar();
    initEditorView();
    initOutlineView();
    initAssetPanel();
    initReviewView();
    initValidationView();
    initPreviewView();
    initFindReplaceView();
    initExportDialog();
    initEvents();
    initShortcuts();
    initAutosave();

    renderSaveStatus();
    renderCounts();
    renderHistoryButtons();
    refreshIcons();

    const lastNote = window.localStorage.getItem(LAST_NOTE_KEY);
    if (lastNote) {
        await openNoteByPath(lastNote);
    } else {
        await populateNoteCandidates();
    }

    window.setInterval(() => refreshIcons(), 5000);
}

boot().catch((error) => reportError(error, "The dashboard failed to start:"));
