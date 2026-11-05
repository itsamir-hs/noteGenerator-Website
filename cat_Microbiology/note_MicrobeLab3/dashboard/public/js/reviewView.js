// Review panel: shows the content the generator flagged for a human check and
// lets the operator jump to it or mark it as reviewed.

import { markReviewItemResolved } from "/dashboard/src/documentModel.js";
import { state } from "./state.js";
import { on } from "./bus.js";
import { commitChange } from "./documentController.js";
import { navigateToBlock } from "./editorView.js";
import { toast } from "./ui.js";

let listElement = null;

function renderReviewItems() {
    if (!listElement) return;
    listElement.replaceChildren();

    const items = state.reviewItems || [];

    if (items.length === 0) {
        const empty = document.createElement("li");
        empty.className = "emptyState";
        empty.textContent = "No review markers found in this note.";
        listElement.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const item of items) {
        const card = document.createElement("li");
        card.className = `reviewItem${item.isResolved ? " is_resolved" : ""}`;

        const text = document.createElement("div");
        text.textContent = item.preview;
        card.appendChild(text);

        const status = document.createElement("div");
        status.className = "assetState";
        status.textContent = item.status
            ? `Status: ${item.status}`
            : "Marked with \u26a0 for review";
        card.appendChild(status);

        const actions = document.createElement("div");
        actions.className = "itemActions";

        const gotoButton = document.createElement("button");
        gotoButton.type = "button";
        gotoButton.className = "dashButton dashButtonSmall";
        gotoButton.textContent = "Open";
        gotoButton.addEventListener("click", () => navigateToBlock(item.blockId));
        actions.appendChild(gotoButton);

        if (!item.isResolved) {
            const resolveButton = document.createElement("button");
            resolveButton.type = "button";
            resolveButton.className = "dashButton dashButtonSmall";
            resolveButton.textContent = "Mark reviewed";
            resolveButton.addEventListener("click", () => {
                const changed = markReviewItemResolved(state.document, item.blockId);
                if (!changed) {
                    toast("This item has no pending status line to resolve.");
                    return;
                }
                commitChange({ immediate: true });
                toast("Marked as reviewed.", "success");
            });
            actions.appendChild(resolveButton);
        }

        card.appendChild(actions);
        fragment.appendChild(card);
    }

    listElement.appendChild(fragment);
}

export function initReviewView() {
    listElement = document.getElementById("reviewList");

    on("review:updated", renderReviewItems);
    on("note:loaded", renderReviewItems);
    on("document:restored", renderReviewItems);

    renderReviewItems();
}
