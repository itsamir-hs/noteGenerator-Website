const highlightSwitcher =
    document.querySelector(".highlightSwitcher");

const highlightToggle =
    document.querySelector(".highlightToggle");

const highlightOptions =
    document.querySelector(".highlightOptions");

const highlightColors =
    document.querySelectorAll(".highlightColor");

const highlightColorInput =
    document.querySelector(".highlightColorInput");

const highlightEraser =
    document.querySelector(".highlightEraser");

const highlightPowerToggle =
    document.querySelector(
        ".highlightPowerToggle"
    );

const highlightContainer =
    document.querySelector(".noteContainer");


/* =========================================================
   State
   ========================================================= */

let selectedColor = "#fff176";

let isEraserActive = false;

let highlightCounter = 0;

const highlights = new Map();

const highlightStorageKey =
    "noteHighlights";

const highlightPowerStorageKey =
    "highlightEnabled";

let isHighlightEnabled =
    localStorage.getItem(
        highlightPowerStorageKey
    ) !== "false";


/* =========================================================
   Highlight Persistence
   ========================================================= */

function getNodePath(
    root,
    node
) {
    const path = [];

    while (
        node &&
        node !== root
    ) {
        const parent =
            node.parentNode;

        if (!parent) {
            return null;
        }

        const index =
            Array.from(
                parent.childNodes
            ).indexOf(node);

        path.unshift(index);

        node = parent;
    }

    return path;
}


function getNodeFromPath(
    root,
    path
) {
    let node = root;

    for (
        const index of path
    ) {
        if (
            !node.childNodes[index]
        ) {
            return null;
        }

        node =
            node.childNodes[index];
    }

    return node;
}


function getNodeLength(node) {
    if (
        node.nodeType ===
        Node.TEXT_NODE
    ) {
        return node.textContent.length;
    }

    return node.childNodes.length;
}


function serializeHighlightRange(
    range
) {
    if (!highlightContainer) {
        return null;
    }

    const startPath =
        getNodePath(
            highlightContainer,
            range.startContainer
        );

    const endPath =
        getNodePath(
            highlightContainer,
            range.endContainer
        );

    if (
        !startPath ||
        !endPath
    ) {
        return null;
    }

    return {
        startPath,

        startOffset:
            range.startOffset,

        endPath,

        endOffset:
            range.endOffset
    };
}


function restoreHighlightRange(
    rangeData
) {
    if (!highlightContainer) {
        return null;
    }

    const startContainer =
        getNodeFromPath(
            highlightContainer,
            rangeData.startPath
        );

    const endContainer =
        getNodeFromPath(
            highlightContainer,
            rangeData.endPath
        );

    if (
        !startContainer ||
        !endContainer
    ) {
        return null;
    }

    try {
        const range =
            document.createRange();

        const startOffset =
            Math.min(
                rangeData.startOffset,
                getNodeLength(
                    startContainer
                )
            );

        const endOffset =
            Math.min(
                rangeData.endOffset,
                getNodeLength(
                    endContainer
                )
            );

        range.setStart(
            startContainer,
            startOffset
        );

        range.setEnd(
            endContainer,
            endOffset
        );

        return range;

    } catch {
        return null;
    }
}


function saveHighlights() {
    const storedHighlights = [];

    highlights.forEach(
        (highlightData) => {
            const rangeData =
                serializeHighlightRange(
                    highlightData.range
                );

            if (!rangeData) {
                return;
            }

            storedHighlights.push({
                range: rangeData,

                color:
                    highlightData.color
            });
        }
    );

    localStorage.setItem(
        highlightStorageKey,
        JSON.stringify(
            storedHighlights
        )
    );
}


function loadHighlights() {
    if (
        !supportsCustomHighlight()
    ) {
        return;
    }

    try {
        const storedHighlights =
            localStorage.getItem(
                highlightStorageKey
            );

        if (!storedHighlights) {
            return;
        }

        const parsedHighlights =
            JSON.parse(
                storedHighlights
            );

        if (
            !Array.isArray(
                parsedHighlights
            )
        ) {
            return;
        }

        parsedHighlights.forEach(
            (storedHighlight) => {
                const range =
                    restoreHighlightRange(
                        storedHighlight.range
                    );

                if (!range) {
                    return;
                }

                const color =
                    storedHighlight.color ||
                    "#fff176";

                createHighlightFromRange(
                    range,
                    color
                );
            }
        );

    } catch (error) {
        console.error(
            "Failed to load highlights:",
            error
        );
    }
}


/* =========================================================
   CSS Highlight Support
   ========================================================= */

function supportsCustomHighlight() {
    return (
        typeof CSS !== "undefined" &&
        "highlights" in CSS &&
        typeof Highlight !== "undefined"
    );
}


/* =========================================================
   Highlight Style
   ========================================================= */

function createHighlightStyle(
    highlightId,
    color
) {
    const style =
        document.createElement("style");

    style.dataset.highlightId =
        highlightId;

    style.textContent = `
        ::highlight(${highlightId}) {
            background-color: ${color};
            color: inherit;
            text-shadow: none;
        }
    `;

    document.head.appendChild(
        style
    );

    return style;
}


/* =========================================================
   Highlight Power
   ========================================================= */

function updateHighlightPowerToggle() {
    if (!highlightPowerToggle) {
        return;
    }

    highlightPowerToggle.classList.toggle(
        "isActive",
        isHighlightEnabled
    );

    highlightPowerToggle.setAttribute(
        "aria-pressed",
        String(isHighlightEnabled)
    );

    const label =
        highlightPowerToggle.querySelector(
            "span"
        );

    if (label) {
        label.textContent =
            isHighlightEnabled
                ? "هایلایت روشن"
                : "هایلایت خاموش";
    }
}


function toggleHighlightPower() {
    isHighlightEnabled =
        !isHighlightEnabled;

    localStorage.setItem(
        highlightPowerStorageKey,
        String(isHighlightEnabled)
    );

    updateHighlightPowerToggle();
}


/* =========================================================
   Highlight Mode
   ========================================================= */

function setHighlightMode(
    color
) {
    selectedColor = color;

    isEraserActive = false;

    if (highlightEraser) {
        highlightEraser.classList.remove(
            "isActive"
        );
    }

    highlightColors.forEach(
        (button) => {
            button.classList.toggle(
                "isActive",
                button.dataset
                    .highlightColor === color
            );
        }
    );
}


function setEraserMode() {
    isEraserActive = true;

    if (highlightEraser) {
        highlightEraser.classList.add(
            "isActive"
        );
    }

    highlightColors.forEach(
        (button) => {
            button.classList.remove(
                "isActive"
            );
        }
    );
}


/* =========================================================
   Selection
   ========================================================= */

function getHighlightSelection() {
    const highlightSelection =
        window.getSelection();

    if (
        !highlightSelection ||
        highlightSelection.rangeCount === 0 ||
        highlightSelection.isCollapsed
    ) {
        return null;
    }

    const highlightRange =
        highlightSelection.getRangeAt(0);

    if (!highlightContainer) {
        return null;
    }

    const startInsideNote =
        highlightContainer.contains(
            highlightRange.startContainer
        );

    const endInsideNote =
        highlightContainer.contains(
            highlightRange.endContainer
        );

    if (
        !startInsideNote ||
        !endInsideNote
    ) {
        return null;
    }

    return highlightRange.cloneRange();
}


/* =========================================================
   Create Highlight
   ========================================================= */

function createHighlightFromRange(
    highlightRange,
    color
) {
    if (
        !supportsCustomHighlight()
    ) {
        console.warn(
            "CSS Custom Highlight API is not supported."
        );

        return;
    }

    highlightCounter++;

    const highlightId =
        `noteHighlight${highlightCounter}`;

    const highlight =
        new Highlight();

    highlight.add(
        highlightRange
    );

    CSS.highlights.set(
        highlightId,
        highlight
    );

    const style =
        createHighlightStyle(
            highlightId,
            color
        );

    highlights.set(
        highlightId,
        {
            highlight,

            range:
                highlightRange,

            color,

            style
        }
    );
}


function createHighlight(
    highlightRange
) {
    createHighlightFromRange(
        highlightRange,
        selectedColor
    );

    saveHighlights();
}


/* =========================================================
   Remove Highlight
   ========================================================= */

function removeHighlight(
    selectionRange
) {
    if (
        !supportsCustomHighlight()
    ) {
        return;
    }

    const highlightsToRemove =
        [];

    highlights.forEach(
        (
            highlightData,
            highlightId
        ) => {
            if (
                rangesIntersect(
                    highlightData.range,
                    selectionRange
                )
            ) {
                highlightsToRemove.push(
                    highlightId
                );
            }
        }
    );

    if (
        highlightsToRemove.length === 0
    ) {
        return;
    }

    highlightsToRemove.forEach(
        (highlightId) => {
            const highlightData =
                highlights.get(
                    highlightId
                );

            if (!highlightData) {
                return;
            }

            CSS.highlights.delete(
                highlightId
            );

            if (
                highlightData.style
            ) {
                highlightData.style.remove();
            }

            highlights.delete(
                highlightId
            );
        }
    );

    saveHighlights();
}


/* =========================================================
   Range Intersection
   ========================================================= */

function rangesIntersect(
    firstRange,
    secondRange
) {
    try {
        return (
            firstRange.compareBoundaryPoints(
                Range.END_TO_START,
                secondRange
            ) < 0 &&
            firstRange.compareBoundaryPoints(
                Range.START_TO_END,
                secondRange
            ) > 0
        );
    } catch {
        return false;
    }
}


/* =========================================================
   Apply Highlight
   ========================================================= */

function applyHighlight() {
    if (!isHighlightEnabled) {
        return;
    }

    const highlightRange =
        getHighlightSelection();

    if (!highlightRange) {
        return;
    }

    if (isEraserActive) {
        removeHighlight(
            highlightRange
        );
    } else {
        createHighlight(
            highlightRange
        );
    }

    window
        .getSelection()
        .removeAllRanges();
}


/* =========================================================
   Mouse Selection
   ========================================================= */

document.addEventListener(
    "mouseup",
    (event) => {
        if (
            event.target.closest(
                ".highlightSwitcher"
            )
        ) {
            return;
        }

        setTimeout(() => {
            applyHighlight();
        }, 0);
    }
);


/* =========================================================
   Highlight Menu
   ========================================================= */

if (highlightToggle) {
    highlightToggle.addEventListener(
        "click",
        () => {
            const isOpen =
                highlightSwitcher.classList.toggle(
                    "isOpen"
                );

            highlightToggle.setAttribute(
                "aria-expanded",
                String(isOpen)
            );

            if (highlightOptions) {
                highlightOptions.setAttribute(
                    "aria-hidden",
                    String(!isOpen)
                );
            }
        }
    );
}


/* =========================================================
   Highlight Power Toggle
   ========================================================= */

if (highlightPowerToggle) {
    highlightPowerToggle.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            toggleHighlightPower();
        }
    );
}


/* =========================================================
   Preset Colors
   ========================================================= */

highlightColors.forEach(
    (button) => {
        button.addEventListener(
            "click",
            () => {
                setHighlightMode(
                    button.dataset
                        .highlightColor
                );
            }
        );
    }
);


/* =========================================================
   Custom Color
   ========================================================= */

if (highlightColorInput) {
    highlightColorInput.addEventListener(
        "input",
        (event) => {
            setHighlightMode(
                event.target.value
            );
        }
    );
}


/* =========================================================
   Eraser
   ========================================================= */

if (highlightEraser) {
    highlightEraser.addEventListener(
        "click",
        () => {
            setEraserMode();
        }
    );
}


/* =========================================================
   Initial State
   ========================================================= */

if (
    !supportsCustomHighlight()
) {
    console.warn(
        "CSS Custom Highlight API is not supported in this browser."
    );
}

setHighlightMode(
    selectedColor
);

updateHighlightPowerToggle();

loadHighlights();
