// Find & replace: searches the whole document through the model (so it also
// reaches table cells, list items and box titles) and can replace matches.

import {
    searchDocument,
    replaceMatch,
    replaceAllInDocument
} from "/dashboard/src/documentModel.js";
import { state } from "./state.js";
import { commitChange } from "./documentController.js";
import { navigateToBlock } from "./editorView.js";
import { emit } from "./bus.js";
import { toast } from "./ui.js";

let dialog = null;
let findInput = null;
let replaceInput = null;
let caseCheckbox = null;
let countElement = null;

let matches = [];
let matchIndex = -1;

function searchOptions() {
    return { caseSensitive: Boolean(caseCheckbox && caseCheckbox.checked) };
}

function updateCount() {
    if (!countElement) return;

    if (!findInput.value) {
        countElement.textContent = "0 results";
        return;
    }

    countElement.textContent =
        matches.length === 0
            ? "No results"
            : `${matchIndex + 1} of ${matches.length}`;
}

function highlightMatch(match) {
    navigateToBlock(match.blockId);
    highlightTextInBlock(match.blockId, findInput.value, searchOptions().caseSensitive);
}

/**
 * Best-effort visible highlight: select the matching text inside the block so
 * the operator can see exactly where the match sits.
 */
function highlightTextInBlock(blockId, query, caseSensitive) {
    if (!query) return;

    const shell = document.querySelector(
        `.docBlock[data-block-id="${cssEscape(blockId)}"]`
    );
    if (!shell) return;

    const needle = caseSensitive ? query : query.toLowerCase();
    const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);

    let node;
    while ((node = walker.nextNode())) {
        const haystack = caseSensitive ? node.nodeValue : node.nodeValue.toLowerCase();
        const start = haystack.indexOf(needle);
        if (start === -1) continue;

        try {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + query.length);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } catch {
            // Selection is cosmetic; navigation already happened.
        }
        return;
    }
}

function runSearch(options = {}) {
    if (!state.document) return;

    const query = findInput.value;
    matches = query ? searchDocument(state.document, query, searchOptions()) : [];
    matchIndex = matches.length > 0 ? 0 : -1;

    updateCount();

    // Typing does not teleport the operator through the document; explicit
    // navigation (open, next, previous) still jumps to the first match.
    if (options.navigate !== false && matchIndex >= 0) highlightMatch(matches[matchIndex]);
}

function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
}

function stepMatch(delta) {
    if (matches.length === 0) {
        runSearch();
        if (matches.length === 0) {
            toast("Nothing found.");
            return;
        }
        return;
    }

    matchIndex = (matchIndex + delta + matches.length) % matches.length;
    updateCount();
    highlightMatch(matches[matchIndex]);
}

function replaceCurrent() {
    if (matchIndex < 0 || matches.length === 0) {
        toast("Nothing to replace.");
        return;
    }

    const previous = matches[matchIndex];

    // Re-resolve the match against the current document: the note may have
    // been edited since the search ran, and replacing at a stale offset could
    // corrupt the block.
    const currentMatches = searchDocument(state.document, findInput.value, searchOptions());
    const fresh = currentMatches.find(
        (match) =>
            match.blockId === previous.blockId &&
            match.segmentIndex === previous.segmentIndex &&
            match.start === previous.start
    );

    if (!fresh) {
        matches = currentMatches;
        matchIndex = matches.length > 0 ? 0 : -1;
        updateCount();
        toast("The text changed under the dialog — the search was refreshed.", "info");
        return;
    }

    const changed = replaceMatch(state.document, fresh, replaceInput.value);

    if (changed) {
        commitChange({ immediate: true });
        // commitChange keeps the DOM as it was; show the replacement now.
        emit("render:required", {});
        toast("Replaced 1 match.");
    }

    // Stay in place: with the replaced match gone, the same index now points
    // at the following occurrence instead of jumping back to the first one.
    matches = searchDocument(state.document, findInput.value, searchOptions());
    matchIndex = Math.min(matchIndex, matches.length - 1);
    updateCount();
    if (matchIndex >= 0) highlightMatch(matches[matchIndex]);
}

function replaceEverything() {
    const query = findInput.value;
    if (!query) return;

    const count = replaceAllInDocument(
        state.document,
        query,
        replaceInput.value,
        searchOptions()
    );

    if (count === 0) {
        toast("Nothing found.");
        return;
    }

    commitChange({ immediate: true });
    emit("render:required", {});
    runSearch();
    updateCount();
    toast(`Replaced ${count} match${count === 1 ? "" : "es"}.`, "success");
}

/** Open the find dialog (optionally with the replace field focused). */
export function openFindDialog(showReplace = false) {
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();

    findInput.focus();
    findInput.select();

    if (showReplace) replaceInput.focus();

    if (findInput.value) runSearch();
}

export function initFindReplaceView() {
    dialog = document.getElementById("findDialog");
    findInput = document.getElementById("findInput");
    replaceInput = document.getElementById("replaceInput");
    caseCheckbox = document.getElementById("findCaseSensitive");
    countElement = document.getElementById("findCount");

    if (!dialog) return;

    document.getElementById("findNextButton").addEventListener("click", () => stepMatch(1));
    document.getElementById("findPreviousButton").addEventListener("click", () => stepMatch(-1));
    document.getElementById("replaceButton").addEventListener("click", replaceCurrent);
    document.getElementById("replaceAllButton").addEventListener("click", replaceEverything);

    findInput.addEventListener("input", () => runSearch({ navigate: false }));
    caseCheckbox.addEventListener("change", () => runSearch({ navigate: false }));

    document.getElementById("findForm").addEventListener("submit", () => {
        dialog.close();
    });

    // Closing the dialog must not leave a highlighted match behind.
    dialog.addEventListener("close", () => {
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
    });

    findInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) stepMatch(-1);
            else stepMatch(1);
        }
    });
}
