// Undo/redo history for the editing dashboard.
//
// History stores serialized Markdown snapshots instead of editor UI state, so
// every meaningful document operation (typing, images, block moves, boxes,
// tables, sections) is reversible with one representation and no chance of the
// UI and the document drifting apart.

const DEFAULT_LIMIT = 120;

/**
 * @param {string} initialMarkdown - state when the note was opened
 * @param {{limit?: number}} [options]
 */
export function createHistory(initialMarkdown, options = {}) {
    return {
        entries: [initialMarkdown],
        position: 0,
        limit: options.limit || DEFAULT_LIMIT
    };
}

/**
 * Record a new document state. Redo entries ahead of the cursor are dropped.
 */
export function pushHistory(history, markdown) {
    if (history.entries[history.position] === markdown) {
        return history; // nothing changed
    }

    history.entries = history.entries.slice(0, history.position + 1);
    history.entries.push(markdown);

    if (history.entries.length > history.limit) {
        const overflow = history.entries.length - history.limit;
        history.entries = history.entries.slice(overflow);
        history.position = Math.max(0, history.position - overflow + 1);
    } else {
        history.position = history.entries.length - 1;
    }

    return history;
}

export function canUndo(history) {
    return history.position > 0;
}

export function canRedo(history) {
    return history.position < history.entries.length - 1;
}

/**
 * Move the cursor back one step.
 * @returns {string|null} the previous Markdown state, or null when nothing can be undone
 */
export function undo(history) {
    if (!canUndo(history)) return null;
    history.position -= 1;
    return history.entries[history.position];
}

/**
 * Move the cursor forward one step.
 * @returns {string|null} the next Markdown state, or null when nothing can be redone
 */
export function redo(history) {
    if (!canRedo(history)) return null;
    history.position += 1;
    return history.entries[history.position];
}

/** Markdown currently pointed at by the history cursor. */
export function currentHistoryState(history) {
    return history.entries[history.position];
}

/**
 * Track the last saved Markdown separately so the UI can show an honest
 * unsaved-changes indicator (and warn before closing the tab).
 */
export function createSaveTracker(savedMarkdown) {
    return { savedMarkdown };
}

export function hasUnsavedChanges(tracker, currentMarkdown) {
    return tracker.savedMarkdown !== currentMarkdown;
}

export function markSaved(tracker, savedMarkdown) {
    tracker.savedMarkdown = savedMarkdown;
    return tracker;
}
