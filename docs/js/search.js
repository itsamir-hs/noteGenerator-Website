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
let originalContent = "";


function openSearch() {
    searchPanel.classList.add("isOpen");

    searchPanel.setAttribute(
        "aria-hidden",
        "false"
    );

    searchButton.setAttribute(
        "aria-expanded",
        "true"
    );

    searchInput.focus();
}


function closeSearch() {
    searchPanel.classList.remove("isOpen");

    searchPanel.setAttribute(
        "aria-hidden",
        "true"
    );

    searchButton.setAttribute(
        "aria-expanded",
        "false"
    );
}


function clearSearch() {
    searchInput.value = "";

    restoreContent();

    searchResults = [];
    currentResultIndex = -1;

    updateSearchInfo();
}


function escapeRegExp(value) {
    return value.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}


function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function restoreContent() {
    noteContainer.innerHTML = originalContent;

    if (window.lucide) {
        lucide.createIcons();
    }
}


function searchContent(query) {
    restoreContent();

    searchResults = [];
    currentResultIndex = -1;

    if (!query.trim()) {
        updateSearchInfo();
        return;
    }

    const escapedQuery = escapeRegExp(query.trim());

    const walker = document.createTreeWalker(
        noteContainer,
        NodeFilter.SHOW_TEXT
    );

    const textNodes = [];

    let node;

    while ((node = walker.nextNode())) {
        if (
            node.parentElement.closest(
                "script, style, .searchPanel"
            )
        ) {
            continue;
        }

        textNodes.push(node);
    }


    textNodes.forEach((textNode) => {

        const text = textNode.nodeValue;

        if (!new RegExp(escapedQuery, "i").test(text)) {
            return;
        }

        const fragment = document.createDocumentFragment();

        let lastIndex = 0;

        const regex = new RegExp(
            escapedQuery,
            "gi"
        );

        let match;

        while ((match = regex.exec(text)) !== null) {

            fragment.appendChild(
                document.createTextNode(
                    text.slice(lastIndex, match.index)
                )
            );

            const mark = document.createElement("mark");

            mark.className = "searchMatch";
            mark.textContent = match[0];

            fragment.appendChild(mark);

            searchResults.push(mark);

            lastIndex = match.index + match[0].length;
        }

        fragment.appendChild(
            document.createTextNode(
                text.slice(lastIndex)
            )
        );

        textNode.parentNode.replaceChild(
            fragment,
            textNode
        );
    });


    if (searchResults.length > 0) {
        currentResultIndex = 0;
        activateCurrentResult();
    }

    updateSearchInfo();
}


function activateCurrentResult() {
    searchResults.forEach((result) => {
        result.classList.remove("isCurrent");
    });

    if (currentResultIndex < 0) {
        return;
    }

    const currentResult =
        searchResults[currentResultIndex];

    if (!currentResult) {
        return;
    }

    currentResult.classList.add("isCurrent");

    currentResult.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}


function goToNextResult() {
    if (searchResults.length === 0) {
        return;
    }

    currentResultIndex =
        (currentResultIndex + 1) %
        searchResults.length;

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


searchButton.addEventListener(
    "click",
    () => {

        if (
            searchPanel.classList.contains("isOpen")
        ) {
            closeSearch();
        } else {
            openSearch();
        }

    }
);


searchInput.addEventListener(
    "input",
    () => {
        searchContent(searchInput.value);
    }
);


searchClearButton.addEventListener(
    "click",
    clearSearch
);


searchNextButton.addEventListener(
    "click",
    goToNextResult
);


searchPreviousButton.addEventListener(
    "click",
    goToPreviousResult
);


searchInput.addEventListener(
    "keydown",
    (event) => {

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

    }
);


document.addEventListener(
    "keydown",
    (event) => {

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "f"
        ) {
            event.preventDefault();

            openSearch();
        }

    }
);


document.addEventListener(
    "click",
    (event) => {

        if (
            searchPanel.classList.contains("isOpen") &&
            !searchPanel.contains(event.target) &&
            !searchButton.contains(event.target)
        ) {
            closeSearch();
        }

    }
);


originalContent = noteContainer.innerHTML;
