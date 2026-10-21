const searchButton = document.querySelector(".searchButton");
const searchPanel = document.querySelector(".searchPanel");
const searchInput = document.querySelector(".searchInput");
const searchClearButton = document.querySelector(".searchClearButton");

const searchResultsCount = document.querySelector(
    ".searchResultsCount"
);

const searchPreviousButton = document.querySelector(
    ".searchPreviousButton"
);

const searchNextButton = document.querySelector(
    ".searchNextButton"
);

const noteContainer = document.querySelector(".noteContainer");

let searchResults = [];
let currentResultIndex = -1;


function openSearch() {
    searchPanel.classList.add("isOpen");
    searchPanel.setAttribute("aria-hidden", "false");
    searchButton.setAttribute("aria-expanded", "true");
    searchInput.focus();
}


function closeSearch() {
    searchPanel.classList.remove("isOpen");
    searchPanel.setAttribute("aria-hidden", "true");
    searchButton.setAttribute("aria-expanded", "false");
}


function clearSearch() {
    searchInput.value = "";
    restoreContent();
    updateSearchInfo();
}


function escapeRegExp(value) {
    const specialCharacters = [
        ".", "*", "+", "?", "^", "$", "{", "}",
        "(", ")", "|", "[", "]", "\\"
    ];

    let escapedValue = "";

    for (const character of value) {
        if (specialCharacters.includes(character)) {
            escapedValue += "\\";
        }

        escapedValue += character;
    }

    return escapedValue;
}

function restoreContent() {
    noteContainer
        .querySelectorAll("mark.searchMatch")
        .forEach((mark) => {
            mark.replaceWith(
                document.createTextNode(mark.textContent)
            );
        });

    searchResults = [];
    currentResultIndex = -1;
}


function isExcludedTextNode(node) {
    const parent = node.parentElement;

    return !parent || Boolean(
        parent.closest(
            "script, style, .searchPanel, .stickyNotesLayer"
        )
    );
}


function getSearchBlock(node) {
    let element = node.parentElement;

    while (element && element !== noteContainer) {
        const display = window.getComputedStyle(element).display;

        if (
            display === "block" ||
            display === "flow-root" ||
            display === "flex" ||
            display === "grid" ||
            display === "list-item" ||
            display === "table-cell"
        ) {
            return element;
        }

        element = element.parentElement;
    }

    return noteContainer;
}


function searchContent(query) {
    restoreContent();

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
        updateSearchInfo();
        return;
    }

    const walker = document.createTreeWalker(
        noteContainer,
        NodeFilter.SHOW_TEXT
    );

    const textNodes = [];
    let combinedText = "";
    let previousBlock = null;
    let node;

    while ((node = walker.nextNode())) {
        if (isExcludedTextNode(node)) {
            continue;
        }

        const block = getSearchBlock(node);

        if (previousBlock !== null && block !== previousBlock) {
            combinedText += "\n";
        }

        const start = combinedText.length;
        combinedText += node.nodeValue;

        textNodes.push({
            node,
            start,
            end: combinedText.length
        });

        previousBlock = block;
    }

    const regex = new RegExp(
        escapeRegExp(trimmedQuery),
        "gi"
    );

    const matches = [];
    let match;

    while ((match = regex.exec(combinedText)) !== null) {
        matches.push({
            start: match.index,
            end: match.index + match[0].length,
            marks: []
        });

        if (match[0].length === 0) {
            regex.lastIndex++;
        }
    }

    if (matches.length === 0) {
        updateSearchInfo();
        return;
    }


let matchIndex = 0;

textNodes.forEach((entry) => {
    const { node, start, end } = entry;

    while (
        matchIndex < matches.length &&
        matches[matchIndex].end <= start
    ) {
        matchIndex++;
    }

    const intervals = [];

    for (
        let i = matchIndex;
        i < matches.length && matches[i].start < end;
        i++
    ) {
        const result = matches[i];

        const overlapStart = Math.max(start, result.start);
        const overlapEnd = Math.min(end, result.end);

        if (overlapStart < overlapEnd) {
            intervals.push({
                start: overlapStart - start,
                end: overlapEnd - start,
                resultIndex: i
            });
        }
    }

    if (intervals.length === 0) {
        return;
    }

    const text = node.nodeValue;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    intervals.forEach((interval) => {
        if (interval.start < lastIndex) {
            return;
        }

        if (interval.start > lastIndex) {
            fragment.appendChild(
                document.createTextNode(
                    text.slice(lastIndex, interval.start)
                )
            );
        }

        const mark = document.createElement("mark");
        mark.className = "searchMatch";
        mark.textContent = text.slice(
            interval.start,
            interval.end
        );

        fragment.appendChild(mark);
        matches[interval.resultIndex].marks.push(mark);

        lastIndex = interval.end;
    });

    if (lastIndex < text.length) {
        fragment.appendChild(
            document.createTextNode(text.slice(lastIndex))
        );
    }

    node.parentNode.replaceChild(fragment, node);
});


    searchResults = matches.filter(
        (result) => result.marks.length > 0
    );

    if (searchResults.length > 0) {
        currentResultIndex = 0;
        activateCurrentResult();
    }

    updateSearchInfo();
}


function activateCurrentResult() {
    searchResults.forEach((result) => {
        result.marks.forEach((mark) => {
            mark.classList.remove("isCurrent");
        });
    });

    if (currentResultIndex < 0) {
        return;
    }

    const currentResult = searchResults[currentResultIndex];

    if (!currentResult || currentResult.marks.length === 0) {
        return;
    }

    currentResult.marks.forEach((mark) => {
        mark.classList.add("isCurrent");
    });

    currentResult.marks[0].scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}


function goToNextResult() {
    if (searchResults.length === 0) {
        return;
    }

    currentResultIndex =
        (currentResultIndex + 1) % searchResults.length;

    activateCurrentResult();
    updateSearchInfo();
}


function goToPreviousResult() {
    if (searchResults.length === 0) {
        return;
    }

    currentResultIndex =
        (currentResultIndex - 1 + searchResults.length) %
        searchResults.length;

    activateCurrentResult();
    updateSearchInfo();
}


function updateSearchInfo() {
    const totalResults = searchResults.length;

    if (totalResults === 0) {
        searchResultsCount.textContent =
            searchInput.value.trim()
                ? "۰ نتیجه"
                : "جستجو کنید";

        searchPreviousButton.disabled = true;
        searchNextButton.disabled = true;

        return;
    }

    searchResultsCount.textContent =
        `${currentResultIndex + 1} از ${totalResults}`;

    searchPreviousButton.disabled = false;
    searchNextButton.disabled = false;
}


searchButton.addEventListener("click", () => {
    if (searchPanel.classList.contains("isOpen")) {
        closeSearch();
    } else {
        openSearch();
    }
});


searchInput.addEventListener("input", () => {
    searchContent(searchInput.value);
});


searchClearButton.addEventListener("click", clearSearch);

searchNextButton.addEventListener("click", goToNextResult);

searchPreviousButton.addEventListener("click", goToPreviousResult);


searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        if (event.shiftKey) {
            goToPreviousResult();
        } else {
            goToNextResult();
        }
    }

    if (event.key === "Escape") {
        closeSearch();
    }
});


document.addEventListener("keydown", (event) => {
    if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f"
    ) {
        event.preventDefault();
        openSearch();
    }
});


document.addEventListener("click", (event) => {
    if (
        searchPanel.classList.contains("isOpen") &&
        !searchPanel.contains(event.target) &&
        !searchButton.contains(event.target)
    ) {
        closeSearch();
    }
});
