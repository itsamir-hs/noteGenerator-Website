/* =========================================================
   Note Library

   Filters the note cards on the home page and marks *why* each
   surviving card matched, so "۱ جزوه از ۴ جزوه" also tells you
   where the hit was.

   The list is rendered server-side, so filtering only hides
   non-matching cards — no network round trip, no empty flash.

   Matching folds the characters Persian and Arabic keyboards
   disagree about. The fold is strictly one character to one
   character, which is what lets a match found in the folded
   text be highlighted at the same offset in the original.
   ========================================================= */

const noteList = document.querySelector(
    "[data-note-list]"
);

const noteFilterInput = document.querySelector(
    "#homeNoteFilter"
);

const noteCountLabel = document.querySelector(
    "[data-note-count]"
);

const noteEmptyState = document.querySelector(
    "[data-note-empty]"
);

const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

/** Elements of a card whose text is searched and highlighted. */
const searchableSelectors = [
    ".noteCardTitle",
    ".noteCardFactValue",
    ".noteCardSlug"
];


/* =========================================================
   Text handling
   ========================================================= */

function toPersianDigits(value) {
    return String(value).replace(
        /\d/g,
        (digit) => persianDigits[Number(digit)]
    );
}


const foldedCharacters = new Map([
    ["ي", "ی"],
    ["ى", "ی"],
    ["ك", "ک"],
    ["أ", "ا"],
    ["إ", "ا"],
    ["آ", "ا"],
    ["ة", "ه"],
    ["ؤ", "و"],
    ["ۀ", "ه"],
    ["\u200c", " "]
]);


/**
 * Fold a single character for comparison. Always one character in,
 * one character out — the caller relies on that to keep offsets.
 */
function foldCharacter(character) {
    const lower = character.toLowerCase();

    return foldedCharacters.get(lower) ?? lower;
}


/** Fold a string without changing its length, so offsets survive. */
function foldPreservingOffsets(value) {
    return Array.from(
        String(value ?? "")
    )
        .map(foldCharacter)
        .join("");
}


/** Normalize what the reader typed: folded, trimmed, whitespace collapsed. */
function normalizeSearchTerm(term) {
    return foldPreservingOffsets(term)
        .trim()
        .replace(/\s+/g, " ");
}


function parseSearchTerms(value) {
    return normalizeSearchTerm(value)
        .split(" ")
        .filter((term) => term !== "");
}


/* =========================================================
   Highlighting
   ========================================================= */

/**
 * Index ranges where any term occurs in already-folded text.
 *
 * @param {Array<string>} characters - Folded text, one entry per character.
 * @param {Array<string>} terms - Folded search terms.
 * @returns {Array<[number, number]>} Sorted, non-overlapping ranges.
 */
function findMatchRanges(characters, terms) {
    const ranges = [];

    for (const term of terms) {
        const termCharacters = Array.from(term);

        if (termCharacters.length === 0) {
            continue;
        }

        for (
            let start = 0;
            start + termCharacters.length <= characters.length;
            start++
        ) {
            const matches = termCharacters.every(
                (character, offset) =>
                    characters[start + offset] === character
            );

            if (matches) {
                ranges.push([
                    start,
                    start + termCharacters.length
                ]);
            }
        }
    }

    return mergeRanges(ranges);
}


function mergeRanges(ranges) {
    const sorted = [...ranges].sort(
        (a, b) => a[0] - b[0] || a[1] - b[1]
    );
    const merged = [];

    for (const range of sorted) {
        const previous = merged.at(-1);

        if (previous && range[0] <= previous[1]) {
            previous[1] = Math.max(previous[1], range[1]);
        } else {
            merged.push([...range]);
        }
    }

    return merged;
}


/**
 * Replace an element's text with the original text, wrapping every matched
 * range in a <mark>.
 *
 * Built from text nodes and created elements rather than innerHTML, so
 * whatever the reader types can never become markup.
 *
 * @returns {number} How many ranges were marked.
 */
function highlightElement(element, originalText, terms) {
    const originalCharacters = Array.from(originalText);
    const ranges =
        terms.length === 0
            ? []
            : findMatchRanges(
                originalCharacters.map(foldCharacter),
                terms
            );

    if (ranges.length === 0) {
        element.textContent = originalText;
        return 0;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const [start, end] of ranges) {
        if (start > cursor) {
            fragment.append(
                document.createTextNode(
                    originalCharacters.slice(cursor, start).join("")
                )
            );
        }

        const mark = document.createElement("mark");

        mark.className = "noteMatch";
        mark.textContent = originalCharacters
            .slice(start, end)
            .join("");

        fragment.append(mark);
        cursor = end;
    }

    if (cursor < originalCharacters.length) {
        fragment.append(
            document.createTextNode(
                originalCharacters.slice(cursor).join("")
            )
        );
    }

    element.replaceChildren(fragment);

    return ranges.length;
}


/* =========================================================
   Filtering
   ========================================================= */

/**
 * Index every card once: the text to search, and the text of each element that
 * may be highlighted later (captured before any <mark> is inserted).
 */
function indexCards() {
    if (!noteList) {
        return [];
    }

    return Array.from(
        noteList.querySelectorAll(".noteCard")
    ).map((card) => {
        const highlightTargets =
            searchableSelectors
                .flatMap((selector) =>
                    Array.from(card.querySelectorAll(selector))
                )
                .map((element) => ({
                    element,
                    text: element.textContent
                }));

        return {
            card,
            searchText: foldPreservingOffsets(
                card.dataset.searchText
            ),
            highlightTargets
        };
    });
}


const indexedCards = indexCards();


function applyHighlights(entry, terms) {
    let matchCount = 0;

    for (const target of entry.highlightTargets) {
        matchCount += highlightElement(
            target.element,
            target.text,
            terms
        );
    }

    return matchCount;
}


function filterNotes() {
    if (!noteList) {
        return;
    }

    const terms = parseSearchTerms(
        noteFilterInput?.value
    );

    let visibleCount = 0;

    for (const entry of indexedCards) {
        const matches = terms.every((term) =>
            entry.searchText.includes(term)
        );

        entry.card.hidden = !matches;

        if (matches) {
            visibleCount++;

            // Always restore first, so clearing the box removes every mark.
            applyHighlights(entry, terms);
            entry.card.classList.toggle(
                "isMatch",
                terms.length > 0
            );
        } else {
            applyHighlights(entry, []);
            entry.card.classList.remove("isMatch");
        }
    }

    if (noteCountLabel) {
        if (terms.length === 0) {
            noteCountLabel.hidden = true;
            noteCountLabel.textContent = "";
        } else {
            noteCountLabel.hidden = false;
            noteCountLabel.textContent =
                `${toPersianDigits(visibleCount)} جزوه از ${toPersianDigits(indexedCards.length)} جزوه`;
        }
    }

    if (noteEmptyState) {
        noteEmptyState.hidden = visibleCount !== 0;
    }
}


if (noteFilterInput) {
    noteFilterInput.addEventListener(
        "input",
        filterNotes
    );

    document.addEventListener("keydown", (event) => {
        const isSlashKey =
            event.key === "/" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey;

        const isTypingElsewhere =
            event.target instanceof HTMLElement &&
            (
                event.target.tagName === "INPUT" ||
                event.target.tagName === "TEXTAREA"
            );

        if (isSlashKey && !isTypingElsewhere) {
            event.preventDefault();
            noteFilterInput.focus();
        }
    });

    filterNotes();
}