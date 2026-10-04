/* =========================================================
   Home Page — notes menu, search and contributors
   =========================================================
   Search behaviour:
     * every typed character re-filters the menu (AND over all terms)
     * only matching notes stay visible
     * every occurrence of a term inside the visible text of a card is wrapped
       in <mark>, which is how the match is highlighted
     * matching happens on the build-time normalized `searchText` so Persian
       digits, Arabic ي/ك and ZWNJ cannot hide a result
   ========================================================= */

const notesMenuList = document.querySelector("#notesMenuList");
const notesMenuEmpty = document.querySelector("#notesMenuEmpty");
const searchInput = document.querySelector(".siteSearchInput");
const searchClearButton = document.querySelector(".siteSearchClear");
const searchStatus = document.querySelector(".siteSearchStatus");
const notesIndexElement = document.getElementById("notesIndex");
const contributorsButton = document.querySelector(".contributorsButton");
const contributorsModal = document.querySelector(".siteContributorsModal");

const search = window.BashlighSearch || {
    normalizeSearchText: (value) => String(value || "").toLowerCase(),
    toSearchTerms: (value) => String(value || "").toLowerCase().split(" ").filter(Boolean),
    escapeHtml: (value) => String(value == null ? "" : value)
};

const noteCards = notesMenuList
    ? Array.from(notesMenuList.querySelectorAll(".noteCard"))
    : [];

let noteIndex = [];

try {
    noteIndex = notesIndexElement
        ? JSON.parse(notesIndexElement.textContent || "[]")
        : [];
} catch (error) {
    console.error("Failed to parse the notes index:", error);

    noteIndex = [];
}


/* =========================================================
   Card Text
   ========================================================= */

const TEXT_SELECTORS = [
    ".noteCardTitle",
    ".noteCardDescription",
    ".noteCardMetaItem"
];

const SOURCE_TEXTS = new Map();

/** Cache each card's original HTML so highlighting can be undone at any time. */
noteCards.forEach((card) => {
    SOURCE_TEXTS.set(card, card.innerHTML);
});

/** Text nodes the highlighter is allowed to touch. */
function getSearchableTextNodes(card) {
    const selectors = TEXT_SELECTORS.join(", ");
    const roots = Array.from(card.querySelectorAll(selectors));
    const textNodes = [];

    roots.forEach((root) => {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT
        );

        let node = walker.nextNode();

        while (node) {
            if (node.nodeValue && node.nodeValue.trim()) {
                textNodes.push(node);
            }

            node = walker.nextNode();
        }
    });

    return textNodes;
}


/* =========================================================
   Highlighting
   ========================================================= */

function createPattern(terms) {
    const escapedTerms = terms.map((term) =>
        term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );

    if (escapedTerms.length === 0) {
        return null;
    }

    return new RegExp(`(${escapedTerms.join("|")})`, "gi");
}

function highlightNodeText(textNode, pattern) {
    const text = textNode.nodeValue;

    pattern.lastIndex = 0;

    if (!pattern.test(text)) {
        pattern.lastIndex = 0;

        return 0;
    }

    pattern.lastIndex = 0;

    const fragment = document.createDocumentFragment();

    let lastIndex = 0;
    let matchCount = 0;

    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match[0] === "") {
            pattern.lastIndex++;
            continue;
        }

        fragment.appendChild(
            document.createTextNode(
                text.slice(lastIndex, match.index)
            )
        );

        const mark = document.createElement("mark");

        mark.textContent = match[0];

        fragment.appendChild(mark);

        matchCount++;

        lastIndex = match.index + match[0].length;
    }

    fragment.appendChild(
        document.createTextNode(text.slice(lastIndex))
    );

    textNode.parentNode.replaceChild(fragment, textNode);

    return matchCount;
}

/** Restore a card to its original markup. */
function clearCardHighlight(card) {
    const originalHtml = SOURCE_TEXTS.get(card);

    if (originalHtml !== undefined && card.innerHTML !== originalHtml) {
        card.innerHTML = originalHtml;
    }
}

/** Highlight every term in a card, returning how many matches were marked. */
function highlightCard(card, terms) {
    const pattern = createPattern(terms);

    if (!pattern) {
        return 0;
    }

    return getSearchableTextNodes(card).reduce(
        (total, textNode) => total + highlightNodeText(textNode, pattern),
        0
    );
}


/* =========================================================
   Filtering
   ========================================================= */

function getIndexEntry(card) {
    const slug = card.dataset.noteSlug;

    return (
        noteIndex.find((entry) => entry.slug === slug) || {}
    );
}

/**
 * How many times every term occurs in the note. A note only matches when *all*
 * terms are present, so the total is 0 as soon as one term is missing.
 */
function countMatches(card, terms) {
    const entry = getIndexEntry(card);

    const haystack =
        typeof entry.searchText === "string" && entry.searchText
            ? entry.searchText
            : search.normalizeSearchText(card.textContent);

    let totalMatches = 0;

    for (const term of terms) {
        const termMatches = haystack.split(term).length - 1;

        if (termMatches === 0) {
            return 0;
        }

        totalMatches += termMatches;
    }

    return totalMatches;
}

function setStatus(message, terms) {
    if (!searchStatus) {
        return;
    }

    if (terms.length === 0) {
        searchStatus.textContent = message;
        return;
    }

    const highlightedTerms = terms
        .map((term) => `<mark>${search.escapeHtml(term)}</mark>`)
        .join("، ");

    searchStatus.innerHTML =
        `جستجو برای ${highlightedTerms} — ${message}`;
}

function runSearch() {
    const rawQuery = searchInput ? searchInput.value : "";
    const terms = search.toSearchTerms(rawQuery);

    if (searchClearButton) {
        searchClearButton.classList.toggle(
            "isVisible",
            rawQuery.length > 0
        );
    }

    let visibleCount = 0;

    noteCards.forEach((card) => {
        clearCardHighlight(card);

        if (terms.length === 0) {
            card.hidden = false;
            visibleCount++;
            return;
        }

        const matches = countMatches(card, terms);

        if (matches === 0) {
            card.hidden = true;
            return;
        }

        card.hidden = false;
        visibleCount++;

        highlightCard(card, terms);
    });

    if (notesMenuEmpty) {
        notesMenuEmpty.hidden = visibleCount !== 0;
    }

    const totalCount = noteCards.length;
    const statusMessage =
        terms.length === 0
            ? `${totalCount.toLocaleString("fa-IR")} جزوه`
            : `${visibleCount.toLocaleString("fa-IR")} از ${totalCount.toLocaleString("fa-IR")} جزوه`;

    setStatus(statusMessage, terms);
}


/* =========================================================
   Contributors Modal
   ========================================================= */

function openContributorsModal() {
    if (!contributorsModal) {
        return;
    }

    contributorsModal.classList.add("isOpen");
    contributorsModal.setAttribute("aria-hidden", "false");

    contributorsButton?.setAttribute("aria-expanded", "true");
}

function closeContributorsModal() {
    if (!contributorsModal) {
        return;
    }

    contributorsModal.classList.remove("isOpen");
    contributorsModal.setAttribute("aria-hidden", "true");

    contributorsButton?.setAttribute("aria-expanded", "false");
}

if (contributorsButton && contributorsModal) {
    contributorsButton.addEventListener("click", openContributorsModal);

    contributorsModal
        .querySelector(".aboutCloseButton")
        ?.addEventListener("click", closeContributorsModal);

    contributorsModal
        .querySelector(".aboutModalBackdrop")
        ?.addEventListener("click", closeContributorsModal);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeContributorsModal();
        }
    });
}


/* =========================================================
   Events
   ========================================================= */

searchInput?.addEventListener("input", runSearch);

searchClearButton?.addEventListener("click", () => {
    if (!searchInput) {
        return;
    }

    searchInput.value = "";
    runSearch();
    searchInput.focus();
});

document.addEventListener("keydown", (event) => {
    const isTypingInsideInput =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;

    if (event.key === "/" && !isTypingInsideInput) {
        event.preventDefault();
        searchInput?.focus();
    }
});


/* =========================================================
   Initial State
   ========================================================= */

runSearch();