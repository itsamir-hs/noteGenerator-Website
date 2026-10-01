/* =========================================================
   Note Library

   Filters the note cards on the home page. The list is rendered
   server-side, so this only hides non-matching cards — there is
   no network round trip and no flash of an empty page.
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


/** Counts read as Persian digits, like the search counter in a note. */
function toPersianDigits(value) {
    return String(value).replace(
        /\d/g,
        (digit) => persianDigits[Number(digit)]
    );
}


function normalizeSearchTerm(term) {
    /*
        Arabic and Persian readers routinely type either the
        Arabic yeh/kaf or the Persian ones, and browsers may
        apply their own normalisation, so fold both directions
        before comparing.
    */

    return String(term ?? "")
        .trim()
        .toLowerCase()
        .replace(/[يى]/g, "ی")
        .replace(/ك/g, "ک")
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ؤ/g, "و")
        .replace(/‌/g, " ")
        .replace(/\s+/g, " ");
}


function filterNotes() {
    if (!noteList) {
        return;
    }

    const cards = Array.from(
        noteList.querySelectorAll(".noteCard")
    );

    const terms = normalizeSearchTerm(
        noteFilterInput?.value
    )
        .split(" ")
        .filter((term) => term !== "");

    let visibleCount = 0;

    for (const card of cards) {
        const haystack = normalizeSearchTerm(
            card.dataset.searchText
        );

        const matches = terms.every((term) =>
            haystack.includes(term)
        );

        card.hidden = !matches;

        if (matches) {
            visibleCount++;
        }
    }

    if (noteCountLabel) {
        if (terms.length === 0) {
            noteCountLabel.hidden = true;
            noteCountLabel.textContent = "";
        } else {
            noteCountLabel.hidden = false;
            noteCountLabel.textContent =
                `${toPersianDigits(visibleCount)} جزوه از ${toPersianDigits(cards.length)} جزوه`;
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