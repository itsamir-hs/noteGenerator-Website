// Issues panel: runs the shared validation module over the current document
// and lets the operator jump straight to the problem block.

import { validateDocument, countActionableIssues } from "/dashboard/src/validation.js";
import { state } from "./state.js";
import { on, emit } from "./bus.js";
import { navigateToBlock } from "./editorView.js";

const VALIDATION_DEBOUNCE_MS = 600;

let issueListElement = null;
let badgeElement = null;
let statusElement = null;
let validationTimer = null;

/** Asset keys the image checks should accept (file name and Markdown path). */
function assetKeys() {
    const keys = [];
    for (const asset of state.assets) {
        keys.push(asset.name, asset.fileName, asset.markdownPath);
    }
    return keys;
}

export function computeIssues() {
    if (!state.document) return [];

    return validateDocument(state.document, {
        assetNames: assetKeys(),
        manifestImages: state.manifestImages
    });
}

/** Render a list of issues into any container (Issues panel, export dialog). */
export function renderIssueList(container, issues) {
    container.replaceChildren();

    if (issues.length === 0) {
        const empty = document.createElement("li");
        empty.className = "emptyState";
        empty.textContent = "No problems found. This note is ready to export.";
        container.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const issue of issues) {
        const item = document.createElement("li");
        item.className = "issueItem";
        item.dataset.level = issue.level;

        const symbol = issue.level === "info" ? "i" : "\u26a0";

        const text = document.createElement("div");
        text.textContent = `${symbol} ${issue.message}`;
        item.appendChild(text);

        if (issue.detail) {
            const detail = document.createElement("div");
            detail.className = "assetState";
            detail.textContent = issue.detail;
            item.appendChild(detail);
        }

        if (issue.blockId) {
            const actions = document.createElement("div");
            actions.className = "itemActions";

            const jump = document.createElement("button");
            jump.type = "button";
            jump.className = "dashButton dashButtonSmall";
            jump.textContent = "Go to";
            jump.addEventListener("click", () => onJumpRequested(issue.blockId));

            actions.appendChild(jump);
            item.appendChild(actions);
        }

        fragment.appendChild(item);
    }

    container.appendChild(fragment);
}

function renderIssues() {
    state.issues = computeIssues();

    const actionable = countActionableIssues(state.issues);

    if (badgeElement) {
        badgeElement.textContent = String(actionable);
        badgeElement.hidden = actionable === 0;
    }

    if (statusElement) {
        statusElement.textContent =
            actionable === 0 ? "No issues" : `${actionable} issue${actionable === 1 ? "" : "s"}`;
        statusElement.classList.toggle("has_issues", actionable > 0);
    }

    if (issueListElement) renderIssueList(issueListElement, state.issues);

    emit("issues:updated", { issues: state.issues });
}

// Set by app.js to switch the sidebar to the Issues panel before navigating.
let onJumpRequested = (blockId) => {
    navigateToBlock(blockId);
};

export function setIssueJumpHandler(handler) {
    onJumpRequested = handler;
}

export function runValidationNow() {
    if (validationTimer) {
        window.clearTimeout(validationTimer);
        validationTimer = null;
    }
    renderIssues();
}

export function scheduleValidation() {
    if (validationTimer) window.clearTimeout(validationTimer);
    validationTimer = window.setTimeout(() => {
        validationTimer = null;
        renderIssues();
    }, VALIDATION_DEBOUNCE_MS);
}

export function initValidationView() {
    issueListElement = document.getElementById("issueList");
    badgeElement = document.getElementById("issuesBadge");
    statusElement = document.getElementById("statusIssues");

    on("document:changed", scheduleValidation);
    on("document:restored", () => runValidationNow());
    on("note:loaded", () => runValidationNow());
    on("assets:changed", scheduleValidation);

    renderIssues();
}
