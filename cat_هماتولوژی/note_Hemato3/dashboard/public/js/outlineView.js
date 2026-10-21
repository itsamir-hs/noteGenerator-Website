// Outline panel: the heading tree of the note with navigation and
// section-level reordering.

import { collectSections, moveSection } from "/dashboard/src/documentModel.js";
import { state } from "./state.js";
import { on } from "./bus.js";
import { mutate } from "./documentController.js";
import { navigateToBlock } from "./editorView.js";
import { toast } from "./ui.js";

let listElement = null;

function renderOutline() {
    if (!listElement) return;
    listElement.replaceChildren();

    if (!state.document) return;

    const sections = collectSections(state.document);

    if (sections.length === 0) {
        const empty = document.createElement("li");
        empty.className = "emptyState";
        empty.textContent = "This note has no headings yet.";
        listElement.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const section of sections) {
        const item = document.createElement("li");
        item.className = "outlineItem";
        item.dataset.level = String(Math.min(section.level, 6));
        item.dataset.blockId = section.blockId;

        const link = document.createElement("button");
        link.type = "button";
        link.className = "outlineLink";
        link.textContent = section.title || "(untitled section)";
        link.title = section.title || "Untitled section";
        link.addEventListener("click", () => navigateToBlock(section.blockId));

        const moveUp = document.createElement("button");
        moveUp.type = "button";
        moveUp.className = "outlineMove";
        moveUp.textContent = "\u2191";
        moveUp.title = "Move this section up";
        moveUp.setAttribute("aria-label", `Move section ${section.title} up`);
        moveUp.addEventListener("click", () => moveSectionBy(section.blockId, "up"));

        const moveDown = document.createElement("button");
        moveDown.type = "button";
        moveDown.className = "outlineMove";
        moveDown.textContent = "\u2193";
        moveDown.title = "Move this section down";
        moveDown.setAttribute("aria-label", `Move section ${section.title} down`);
        moveDown.addEventListener("click", () => moveSectionBy(section.blockId, "down"));

        item.append(link, moveUp, moveDown);
        fragment.appendChild(item);
    }

    listElement.appendChild(fragment);
    highlightSelection();
}

function moveSectionBy(blockId, direction) {
    let moved = false;

    mutate((document) => {
        const before = collectSections(document)
            .map((section) => section.blockId)
            .join(",");

        moveSection(document, blockId, direction);

        const after = collectSections(document)
            .map((section) => section.blockId)
            .join(",");

        moved = before !== after;
    }, { structural: true });

    if (!moved) {
        toast("This section cannot move further in that direction.");
    }
}

function highlightSelection() {
    if (!listElement) return;

    for (const item of listElement.querySelectorAll(".outlineItem.is_active")) {
        item.classList.remove("is_active");
    }

    if (!state.selectedBlockId) return;

    const active = [...listElement.querySelectorAll(".outlineItem")].find(
        (item) => item.dataset.blockId === state.selectedBlockId
    );
    if (active) active.classList.add("is_active");
}

export function initOutlineView() {
    listElement = document.getElementById("outlineList");
    if (!listElement) return;

    on("document:changed", renderOutline);
    on("document:restored", renderOutline);
    on("note:loaded", renderOutline);
    on("selection:changed", highlightSelection);

    renderOutline();
}
