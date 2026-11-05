// Document controller: owns the parsed note, the undo history and the
// "unsaved changes" bookkeeping, and announces changes through the bus.

import {
    parseDocument,
    serializeDocument,
    collectReviewItems
} from "/dashboard/src/documentModel.js";
import {
    createHistory,
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    createSaveTracker,
    hasUnsavedChanges
} from "/dashboard/src/history.js";

import { state } from "./state.js";
import { emit } from "./bus.js";

// Typing coalesces into one undo entry; structural edits record immediately.
const HISTORY_DEBOUNCE_MS = 700;

let pendingHistoryMarkdown = null;
let historyTimer = null;

/** Replace the working document with freshly parsed Markdown. */
function restoreFromMarkdown(markdown) {
    state.document = parseDocument(markdown);
    state.selectedBlockId = null;
    state.focusRequest = null;
    refreshDerivedState();
    emit("document:restored", { markdown });
}

function refreshDerivedState() {
    state.reviewItems = state.document ? collectReviewItems(state.document) : [];
    emit("review:updated", { items: state.reviewItems });
}

/** Load a note into the session. */
export function loadNote(payload) {
    state.noteId = payload.noteId;
    state.notePath = payload.path;
    state.noteName = payload.path.split("/").pop();
    state.originalMarkdown = payload.originalMarkdown ?? payload.markdown;
    state.savedMarkdown = payload.markdown;
    state.savedAt = payload.savedAt ?? null;
    state.editedExists = Boolean(payload.editedExists);
    state.assets = payload.assets ?? [];
    state.manifestImages = payload.manifestImages ?? [];
    state.document = parseDocument(payload.markdown);
    state.history = createHistory(payload.markdown);
    state.saveTracker = createSaveTracker(payload.markdown);
    state.selectedBlockId = null;
    state.focusRequest = null;
    state.issues = [];

    pendingHistoryMarkdown = null;
    if (historyTimer) window.clearTimeout(historyTimer);

    refreshDerivedState();
    emit("note:loaded", payload);
    emit("assets:changed", { assets: state.assets });
    emit("document:restored", { markdown: payload.markdown });
    state.saveState = "clean";
    emit("save:state", { saveState: "clean", savedAt: state.savedAt });
}

/** Current Markdown of the document being edited. */
export function currentMarkdown() {
    return state.document ? serializeDocument(state.document) : "";
}

export function isDirty() {
    if (!state.saveTracker) return false;
    return hasUnsavedChanges(state.saveTracker, currentMarkdown());
}

export function getUndoState() {
    return {
        canUndo: state.history ? canUndo(state.history) : false,
        canRedo: state.history ? canRedo(state.history) : false
    };
}

function pushHistoryState(markdown, immediate) {
    if (!state.history) return;

    if (immediate) {
        if (historyTimer) {
            window.clearTimeout(historyTimer);
            historyTimer = null;
        }
        if (pendingHistoryMarkdown !== null) {
            pushHistory(state.history, pendingHistoryMarkdown);
            pendingHistoryMarkdown = null;
        }
        pushHistory(state.history, markdown);
        return;
    }

    pendingHistoryMarkdown = markdown;
    if (historyTimer) window.clearTimeout(historyTimer);

    historyTimer = window.setTimeout(() => {
        if (pendingHistoryMarkdown !== null) {
            pushHistory(state.history, pendingHistoryMarkdown);
            pendingHistoryMarkdown = null;
        }
        historyTimer = null;
        emit("history:changed", getUndoState());
    }, HISTORY_DEBOUNCE_MS);
}

/**
 * Record a change that has just been applied to the document.
 * @param {{immediate?: boolean, structural?: boolean}} [options]
 */
export function commitChange(options = {}) {
    const markdown = currentMarkdown();

    pushHistoryState(markdown, Boolean(options.immediate) || Boolean(options.structural));

    refreshDerivedState();
    updateSaveState();
    emit("document:changed", { markdown, structural: Boolean(options.structural) });
    emit("history:changed", getUndoState());
}

function updateSaveState() {
    const dirty = isDirty();
    const nextState = dirty ? "dirty" : "clean";

    if (state.saveState !== nextState) {
        state.saveState = nextState;
        emit("save:state", { saveState: nextState, savedAt: state.savedAt });
    }
}

/**
 * Apply a mutation to the document.
 * @param {(document: Object) => void} mutator
 * @param {{render?: boolean, structural?: boolean}} [options]
 */
export function mutate(mutator, options = {}) {
    if (!state.document) return;
    const render = options.render !== false;

    mutator(state.document);
    commitChange({ immediate: options.structural !== false });

    if (render) emit("render:required", {});
}

export function undoEdit() {
    if (!state.history) return false;

    if (historyTimer) {
        window.clearTimeout(historyTimer);
        historyTimer = null;
    }
    if (pendingHistoryMarkdown !== null) {
        pushHistory(state.history, pendingHistoryMarkdown);
        pendingHistoryMarkdown = null;
    }

    const markdown = undo(state.history);
    if (markdown === null) return false;

    restoreFromMarkdown(markdown);
    updateSaveState();
    emit("history:changed", getUndoState());
    return true;
}

export function redoEdit() {
    if (!state.history) return false;

    const markdown = redo(state.history);
    if (markdown === null) return false;

    restoreFromMarkdown(markdown);
    updateSaveState();
    emit("history:changed", getUndoState());
    return true;
}

/** Re-parse from a Markdown source (raw source mode / external edit). */
export function replaceDocumentFromMarkdown(markdown) {
    restoreFromMarkdown(markdown);
    if (state.history) pushHistory(state.history, markdown);
    updateSaveState();
    emit("document:changed", { markdown, structural: true });
    emit("history:changed", getUndoState());
}

export function selectBlock(blockId) {
    if (state.selectedBlockId === blockId) return;
    state.selectedBlockId = blockId;
    emit("selection:changed", { blockId });
}

/** Ask the editor to place the caret after the next render. */
export function requestFocus(blockId, caret = "start") {
    state.focusRequest = { blockId, caret };
}

/** Record a successful save. */
export function markSaved({ savedMarkdown, savedAt, savedPath }) {
    state.savedMarkdown = savedMarkdown;
    state.savedAt = savedAt;
    state.saveState = "saved";
    if (state.saveTracker) state.saveTracker.savedMarkdown = savedMarkdown;

    emit("save:state", { saveState: "saved", savedAt, savedPath });
}

export function setSaveState(saveState, detail = {}) {
    state.saveState = saveState;
    emit("save:state", { saveState, savedAt: state.savedAt, ...detail });
}

export function replaceAssets(assets) {
    state.assets = assets;
    emit("assets:changed", { assets });
}
