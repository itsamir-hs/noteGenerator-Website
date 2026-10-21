/* =========================================================
   Sticky Notes
   ========================================================= */

const stickyNotesPanel = document.querySelector(
    ".stickyNotesPanel"
);

const stickyNotesToggle = document.querySelector(
    ".stickyNotesToggle"
);

const stickyNotesBackdrop = document.querySelector(
    ".stickyNotesBackdrop"
);

const addStickyNoteButton = document.querySelector(
    ".addStickyNoteButton"
);

const stickyNotesList = document.querySelector(
    ".stickyNotesList"
);

const stickyNotesEmptyState = document.querySelector(
    ".stickyNotesEmptyState"
);

const stickyNotesLayer = document.querySelector(
    ".stickyNotesLayer"
);

const stickyNoteContainer = document.querySelector(
    ".noteContainer"
);

const stickyNotesGeneratedDateElement =
    document.querySelector(".generatedDate");

const stickyNotesGeneratedDate =
    stickyNotesGeneratedDateElement?.textContent.trim();

const stickyNotesStorageKey =
    stickyNotesGeneratedDate
        ? `stickyNotes:${stickyNotesGeneratedDate}`
        : `stickyNotes:${window.location.pathname}`;

let stickyNotes = [];


/* =========================================================
   Storage
   ========================================================= */

function loadStickyNotes() {
    try {
        const storedNotes =
            localStorage.getItem(
                stickyNotesStorageKey
            );

        if (!storedNotes) {
            stickyNotes = [];
            return;
        }

        const parsedNotes =
            JSON.parse(storedNotes);

        if (!Array.isArray(parsedNotes)) {
            stickyNotes = [];
            return;
        }

        stickyNotes =
            parsedNotes.map(
                normalizeStickyNote
            );
    } catch (error) {
        console.error(
            "Failed to load sticky notes:",
            error
        );

        stickyNotes = [];
    }
}


function normalizeStickyNote(
    stickyNote
) {
    return {
        id:
            stickyNote.id ||
            Date.now().toString() +
                Math.random()
                    .toString(36)
                    .slice(2, 8),

        text:
            typeof stickyNote.text ===
            "string"
                ? stickyNote.text
                : "",

        x:
            Number.isFinite(
                Number(stickyNote.x)
            )
                ? Number(stickyNote.x)
                : 20,

        y:
            Number.isFinite(
                Number(stickyNote.y)
            )
                ? Number(stickyNote.y)
                : 20,

        width:
            Number.isFinite(
                Number(stickyNote.width)
            )
                ? Number(stickyNote.width)
                : 240,

        height:
            Number.isFinite(
                Number(stickyNote.height)
            )
                ? Number(stickyNote.height)
                : 180,

        isMinimized:
            Boolean(
                stickyNote.isMinimized
            ),

        isLocked:
            Boolean(
                stickyNote.isLocked
            )
    };
}


function saveStickyNotes() {
    try {
        localStorage.setItem(
            stickyNotesStorageKey,
            JSON.stringify(stickyNotes)
        );
    } catch (error) {
        console.error(
            "Failed to save sticky notes:",
            error
        );
    }
}


/* =========================================================
   Helpers
   ========================================================= */

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function getStickyNotePreview(
    stickyNote
) {
    const text =
        stickyNote.text
            ?.replace(/\s+/g, " ")
            .trim();

    if (!text) {
        return "یادداشت بدون متن";
    }

    if (text.length > 70) {
        return (
            text.slice(0, 70) +
            "…"
        );
    }

    return text;
}


function refreshIcons() {
    if (
        window.lucide &&
        typeof window.lucide.createIcons ===
            "function"
    ) {
        lucide.createIcons();
    }
}


/* =========================================================
   Sticky Note Position Helpers
   ========================================================= */

function clampStickyNotePosition(
    stickyNote,
    noteElement = null
) {
    if (
        !stickyNoteContainer ||
        !stickyNotesLayer
    ) {
        return false;
    }

    const noteWidth =
        noteElement?.offsetWidth ||
        stickyNote.width ||
        240;

    const noteHeight =
        noteElement?.offsetHeight ||
        stickyNote.height ||
        180;

    const layerRect =
        stickyNotesLayer.getBoundingClientRect();

    const layerWidth =
        Math.max(
            0,
            Math.round(layerRect.width)
        );

    const layerHeight =
        Math.max(
            0,
            Math.round(layerRect.height)
        );

    const maxX =
        Math.max(
            0,
            layerWidth - noteWidth
        );

    const maxY =
        Math.max(
            0,
            layerHeight - noteHeight
        );

    const oldX =
        Number(stickyNote.x) || 0;

    const oldY =
        Number(stickyNote.y) || 0;

    const newX =
        Math.max(
            0,
            Math.min(
                oldX,
                maxX
            )
        );

    const newY =
        Math.max(
            0,
            Math.min(
                oldY,
                maxY
            )
        );

    stickyNote.x = newX;
    stickyNote.y = newY;

    if (noteElement) {
        noteElement.style.left =
            `${newX}px`;

        noteElement.style.top =
            `${newY}px`;
    }

    return (
        oldX !== newX ||
        oldY !== newY
    );
}

function clampAllStickyNotes() {
    if (!stickyNoteContainer) {
        return false;
    }

    let positionChanged = false;

    stickyNotes.forEach(
        (stickyNote) => {
            const noteElement =
                document.querySelector(
                    `[data-sticky-note-id="${stickyNote.id}"]`
                );

            if (
                clampStickyNotePosition(
                    stickyNote,
                    noteElement
                )
            ) {
                positionChanged = true;
            }
        }
    );

    return positionChanged;
}


/* =========================================================
   Panel
   ========================================================= */

function openStickyNotesPanel() {
    if (
        !stickyNotesPanel ||
        !stickyNotesToggle ||
        !stickyNotesBackdrop
    ) {
        return;
    }

    stickyNotesPanel.classList.add(
        "isOpen"
    );

    stickyNotesBackdrop.classList.add(
        "isVisible"
    );

    stickyNotesToggle.setAttribute(
        "aria-expanded",
        "true"
    );

    stickyNotesPanel.setAttribute(
        "aria-hidden",
        "false"
    );
}


function closeStickyNotesPanel() {
    if (
        !stickyNotesPanel ||
        !stickyNotesToggle ||
        !stickyNotesBackdrop
    ) {
        return;
    }

    stickyNotesPanel.classList.remove(
        "isOpen"
    );

    stickyNotesBackdrop.classList.remove(
        "isVisible"
    );

    stickyNotesToggle.setAttribute(
        "aria-expanded",
        "false"
    );

    stickyNotesPanel.setAttribute(
        "aria-hidden",
        "true"
    );
}


function toggleStickyNotesPanel() {
    if (!stickyNotesPanel) {
        return;
    }

    if (
        stickyNotesPanel.classList.contains(
            "isOpen"
        )
    ) {
        closeStickyNotesPanel();
    } else {
        openStickyNotesPanel();
    }
}


/* =========================================================
   Note Position
   ========================================================= */

function getStickyNoteDocumentPosition(
    stickyNote
) {
    if (!stickyNoteContainer) {
        return null;
    }

    const containerRect =
        stickyNoteContainer.getBoundingClientRect();

    return {
        x:
            containerRect.left +
            stickyNote.x,

        y:
            containerRect.top +
            window.scrollY +
            stickyNote.y
    };
}


function getNewStickyNotePosition(
    noteWidth,
    noteHeight
) {
    if (!stickyNoteContainer) {
        return {
            x: 20,
            y: 20
        };
    }

    const containerRect =
        stickyNoteContainer.getBoundingClientRect();

    const viewportCenterX =
        window.innerWidth / 2;

    const viewportCenterY =
        window.innerHeight / 2;

    const containerRelativeX =
        viewportCenterX -
        containerRect.left -
        noteWidth / 2;

    const containerRelativeY =
        viewportCenterY -
        containerRect.top -
        noteHeight / 2;

    const maxX =
        Math.max(
            0,
            stickyNoteContainer.clientWidth -
                noteWidth
        );

    const maxY =
        Math.max(
            0,
            stickyNoteContainer.scrollHeight -
                noteHeight
        );

    return {
        x: Math.max(
            0,
            Math.min(
                containerRelativeX,
                maxX
            )
        ),

        y: Math.max(
            0,
            Math.min(
                containerRelativeY,
                maxY
            )
        )
    };
}


/* =========================================================
   Note Creation
   ========================================================= */

function createStickyNote() {
    if (!stickyNoteContainer) {
        return;
    }

    const noteWidth = 240;
    const noteHeight = 180;

    const position =
        getNewStickyNotePosition(
            noteWidth,
            noteHeight
        );

    const stickyNote = {
        id:
            Date.now().toString() +
            Math.random()
                .toString(36)
                .slice(2, 8),

        text: "",

        x: position.x,
        y: position.y,

        width: noteWidth,
        height: noteHeight,

        isMinimized: false,
        isLocked: false
    };

    stickyNotes.push(
        stickyNote
    );

    saveStickyNotes();

    renderStickyNotes();

    closeStickyNotesPanel();

    requestAnimationFrame(() => {
        const noteElement =
            document.querySelector(
                `[data-sticky-note-id="${stickyNote.id}"]`
            );

        const textarea =
            noteElement?.querySelector(
                ".stickyNoteTextarea"
            );

        textarea?.focus();
    });
}


/* =========================================================
   Rendering
   ========================================================= */

function renderStickyNotes() {
    if (
        !stickyNotesLayer ||
        !stickyNotesList
    ) {
        return;
    }

    stickyNotesLayer.innerHTML = "";
    stickyNotesList.innerHTML = "";

    stickyNotes.forEach(
        (stickyNote) => {
            createStickyNoteElement(
                stickyNote
            );

            createStickyNoteListItem(
                stickyNote
            );
        }
    );

    updateStickyNotesEmptyState();

    refreshIcons();

    requestAnimationFrame(() => {
        const positionChanged =
            clampAllStickyNotes();

        if (positionChanged) {
            saveStickyNotes();
        }
    });
}


/* =========================================================
   Sticky Note Element
   ========================================================= */

function createStickyNoteElement(
    stickyNote
) {
    const noteElement =
        document.createElement("article");

    noteElement.className =
        "stickyNote";

    noteElement.dataset.stickyNoteId =
        stickyNote.id;

    noteElement.style.left =
        `${stickyNote.x}px`;

    noteElement.style.top =
        `${stickyNote.y}px`;

    noteElement.style.width =
        `${stickyNote.width}px`;

    noteElement.style.height =
        `${stickyNote.height}px`;

    if (stickyNote.isMinimized) {
        noteElement.classList.add(
            "isMinimized"
        );
    }

    if (stickyNote.isLocked) {
        noteElement.classList.add(
            "isLocked"
        );
    }

    noteElement.innerHTML = `
        <div class="stickyNoteHeader">

            <div
                class="stickyNoteDragHandle"
                title="جابجایی یادداشت"
            >
                <i data-lucide="grip"></i>
            </div>

            <div class="stickyNoteControls">

                <button
                    class="stickyNoteDelete"
                    type="button"
                    aria-label="حذف یادداشت"
                    title="حذف"
                >
                    <i data-lucide="trash-2"></i>
                </button>

                <button
                    class="stickyNoteMinimize"
                    type="button"
                    aria-label="کوچک کردن یادداشت"
                    title="کوچک کردن"
                >
                    <i data-lucide="minimize-2"></i>
                </button>

                <button
                    class="stickyNoteLock"
                    type="button"
                    aria-label="${
                        stickyNote.isLocked
                            ? "باز کردن قفل"
                            : "قفل کردن"
                    }"
                    title="${
                        stickyNote.isLocked
                            ? "باز کردن قفل"
                            : "قفل کردن"
                    }"
                >
                    <i data-lucide="${
                        stickyNote.isLocked
                            ? "lock"
                            : "unlock"
                    }"></i>
                </button>

            </div>
        </div>

        <textarea
            class="stickyNoteTextarea"
            placeholder="یادداشت خود را بنویسید..."
            spellcheck="false"
        ></textarea>
    `;

    const textarea =
        noteElement.querySelector(
            ".stickyNoteTextarea"
        );

    textarea.value =
        stickyNote.text || "";

    const dragHandle =
        noteElement.querySelector(
            ".stickyNoteDragHandle"
        );

    const deleteButton =
        noteElement.querySelector(
            ".stickyNoteDelete"
        );

    const minimizeButton =
        noteElement.querySelector(
            ".stickyNoteMinimize"
        );

    const lockButton =
        noteElement.querySelector(
            ".stickyNoteLock"
        );

    textarea.addEventListener(
        "input",
        () => {
            stickyNote.text =
                textarea.value;

            saveStickyNotes();

            updateStickyNoteListItem(
                stickyNote
            );
        }
    );

    deleteButton.addEventListener(
        "pointerdown",
        (event) => {
            event.preventDefault();
            event.stopPropagation();
        }
    );

    deleteButton.addEventListener(
        "click",
        (event) => {
            event.preventDefault();
            event.stopPropagation();

            deleteStickyNote(
                stickyNote.id
            );
        }
    );

    minimizeButton.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            toggleStickyNoteMinimize(
                stickyNote
            );
        }
    );

    lockButton.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            toggleStickyNoteLock(
                stickyNote
            );
        }
    );

    noteElement.addEventListener(
        "click",
        () => {
            if (
                stickyNote.isMinimized
            ) {
                toggleStickyNoteMinimize(
                    stickyNote
                );
            }
        }
    );

    setupStickyNoteDragging(
        noteElement,
        stickyNote,
        dragHandle
    );

    setupStickyNoteResize(
        noteElement,
        stickyNote
    );

    stickyNotesLayer.appendChild(
        noteElement
    );
}


/* =========================================================
   Panel List
   ========================================================= */

function createStickyNoteListItem(
    stickyNote
) {
    const item =
        document.createElement("button");

    item.type = "button";

    item.className =
        "stickyNoteListItem";

    item.dataset.stickyNoteId =
        stickyNote.id;

    item.innerHTML = `
        <i data-lucide="file-text"></i>

        <span class="stickyNoteListText">
            ${escapeHtml(
                getStickyNotePreview(
                    stickyNote
                )
            )}
        </span>
    `;

    item.addEventListener(
        "click",
        () => {
            focusStickyNote(
                stickyNote
            );
        }
    );

    stickyNotesList.appendChild(
        item
    );
}


function updateStickyNoteListItem(
    stickyNote
) {
    const item =
        stickyNotesList?.querySelector(
            `[data-sticky-note-id="${stickyNote.id}"]`
        );

    if (!item) {
        return;
    }

    const textElement =
        item.querySelector(
            ".stickyNoteListText"
        );

    if (!textElement) {
        return;
    }

    textElement.textContent =
        getStickyNotePreview(
            stickyNote
        );
}


function updateStickyNotesEmptyState() {
    if (!stickyNotesEmptyState) {
        return;
    }

    stickyNotesEmptyState.style.display =
        stickyNotes.length === 0
            ? "flex"
            : "none";
}


/* =========================================================
   Navigation
   ========================================================= */

function focusStickyNote(
    stickyNote
) {
    if (!stickyNote) {
        return;
    }

    if (stickyNote.isMinimized) {
        stickyNote.isMinimized =
            false;

        saveStickyNotes();

        renderStickyNotes();
    }

    closeStickyNotesPanel();

    const position =
        getStickyNoteDocumentPosition(
            stickyNote
        );

    if (!position) {
        return;
    }

    const header =
        document.querySelector(
            ".topBar"
        );

    const headerHeight =
        header?.offsetHeight || 0;

    const targetY =
        Math.max(
            0,
            position.y -
                headerHeight -
                40
        );

    window.scrollTo({
        top: targetY,
        behavior: "smooth"
    });

    requestAnimationFrame(() => {
        const noteElement =
            document.querySelector(
                `[data-sticky-note-id="${stickyNote.id}"]`
            );

        if (!noteElement) {
            return;
        }

        noteElement.classList.add(
            "isFocused"
        );

        setTimeout(() => {
            noteElement.classList.remove(
                "isFocused"
            );
        }, 900);
    });
}


/* =========================================================
   Delete
   ========================================================= */

function deleteStickyNote(
    stickyNoteId
) {
    console.log(
        "Deleting sticky note:",
        stickyNoteId
    );

    const noteIndex =
        stickyNotes.findIndex(
            (stickyNote) =>
                stickyNote.id ===
                stickyNoteId
        );

    if (noteIndex === -1) {
        console.error(
            "Sticky note not found:",
            stickyNoteId
        );

        return;
    }

    stickyNotes.splice(
        noteIndex,
        1
    );

    saveStickyNotes();

    renderStickyNotes();
}


/* =========================================================
   Minimize
   ========================================================= */

function toggleStickyNoteMinimize(
    stickyNote
) {
    stickyNote.isMinimized =
        !stickyNote.isMinimized;

    saveStickyNotes();

    renderStickyNotes();
}


/* =========================================================
   Lock
   ========================================================= */

function toggleStickyNoteLock(
    stickyNote
) {
    stickyNote.isLocked =
        !stickyNote.isLocked;

    saveStickyNotes();

    renderStickyNotes();
}


/* =========================================================
   Dragging
   ========================================================= */

function setupStickyNoteDragging(
    noteElement,
    stickyNote,
    dragHandle
) {
    let isDragging = false;

    let startPointerX = 0;
    let startPointerY = 0;

    let startNoteX = 0;
    let startNoteY = 0;


    function stopDragging(event) {
        if (!isDragging) {
            return;
        }

        isDragging = false;

        noteElement.classList.remove(
            "isDragging"
        );

        if (
            event &&
            dragHandle.hasPointerCapture(
                event.pointerId
            )
        ) {
            dragHandle.releasePointerCapture(
                event.pointerId
            );
        }

        clampStickyNotePosition(
            stickyNote,
            noteElement
        );

        saveStickyNotes();
    }


    dragHandle.addEventListener(
        "pointerdown",
        (event) => {
            if (
                stickyNote.isLocked ||
                stickyNote.isMinimized
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            isDragging = true;

            startPointerX =
                event.clientX;

            startPointerY =
                event.clientY;

            startNoteX =
                stickyNote.x;

            startNoteY =
                stickyNote.y;

            dragHandle.setPointerCapture(
                event.pointerId
            );

            noteElement.classList.add(
                "isDragging"
            );
        }
    );


    dragHandle.addEventListener(
        "pointermove",
        (event) => {
            if (!isDragging) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const deltaX =
                event.clientX -
                startPointerX;

            const deltaY =
                event.clientY -
                startPointerY;

            stickyNote.x =
                startNoteX +
                deltaX;

            stickyNote.y =
                startNoteY +
                deltaY;

            clampStickyNotePosition(
                stickyNote,
                noteElement
            );
        }
    );


    dragHandle.addEventListener(
        "pointerup",
        (event) => {
            stopDragging(event);
        }
    );


    dragHandle.addEventListener(
        "pointercancel",
        (event) => {
            stopDragging(event);
        }
    );


    dragHandle.addEventListener(
        "lostpointercapture",
        () => {
            if (!isDragging) {
                return;
            }

            isDragging = false;

            noteElement.classList.remove(
                "isDragging"
            );

            clampStickyNotePosition(
                stickyNote,
                noteElement
            );

            saveStickyNotes();
        }
    );
}


/* =========================================================
   Resize
   ========================================================= */

function setupStickyNoteResize(
    noteElement,
    stickyNote
) {
    if (
        typeof ResizeObserver ===
        "undefined"
    ) {
        return;
    }

    let resizeTimer = null;

    const resizeObserver =
        new ResizeObserver(() => {
            if (
                stickyNote.isMinimized
            ) {
                return;
            }

            stickyNote.width =
                noteElement.offsetWidth;

            stickyNote.height =
                noteElement.offsetHeight;

            clampStickyNotePosition(
                stickyNote,
                noteElement
            );

            clearTimeout(
                resizeTimer
            );

            resizeTimer =
                setTimeout(() => {
                    saveStickyNotes();
                }, 100);
        });

    resizeObserver.observe(
        noteElement
    );
}


/* =========================================================
   Events
   ========================================================= */

if (stickyNotesToggle) {
    stickyNotesToggle.addEventListener(
        "click",
        toggleStickyNotesPanel
    );
}


if (stickyNotesBackdrop) {
    stickyNotesBackdrop.addEventListener(
        "click",
        closeStickyNotesPanel
    );
}


if (addStickyNoteButton) {
    addStickyNoteButton.addEventListener(
        "click",
        createStickyNote
    );
}


document.addEventListener(
    "keydown",
    (event) => {
        if (event.key === "Escape") {
            closeStickyNotesPanel();
        }
    }
);


/* =========================================================
   Responsive Position Handling
   ========================================================= */

let stickyNotesResizeTimer = null;

function handleStickyNotesContainerResize() {
    clearTimeout(
        stickyNotesResizeTimer
    );

    stickyNotesResizeTimer =
        setTimeout(() => {
            requestAnimationFrame(() => {
                const positionChanged =
                    clampAllStickyNotes();

                if (positionChanged) {
                    saveStickyNotes();
                }
            });
        }, 50);
}


if (
    typeof ResizeObserver !==
    "undefined" &&
    stickyNoteContainer
) {
    const stickyNotesContainerObserver =
        new ResizeObserver(() => {
            handleStickyNotesContainerResize();
        });

    stickyNotesContainerObserver.observe(
        stickyNoteContainer
    );
}


window.addEventListener(
    "resize",
    handleStickyNotesContainerResize
);


/* =========================================================
   Initialization
   ========================================================= */

loadStickyNotes();

renderStickyNotes();
