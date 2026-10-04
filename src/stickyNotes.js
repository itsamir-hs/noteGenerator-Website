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

const stickyNotesStorageKey =
    "stickyNotes";

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

/*
    Returns the note's absolute document position.

    stickyNote.x / stickyNote.y are relative to
    .noteContainer.

    This function converts that position into
    the browser's document coordinates.
*/

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


/*
    Calculate where a new note should appear.

    The note is placed in the center of the
    currently visible viewport.
*/

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

    const maxX = Math.max(
        20,
        stickyNoteContainer.scrollWidth -
            noteWidth -
            20
    );

    const maxY = Math.max(
        20,
        stickyNoteContainer.scrollHeight -
            noteHeight -
            20
    );

    return {
        x: Math.max(
            20,
            Math.min(
                containerRelativeX,
                maxX
            )
        ),

        y: Math.max(
            20,
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

        deleteStickyNote(stickyNote.id);
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
        <i data-lucide="sticky-note"></i>

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

    /*
        Scroll directly to the exact document
        position of the sticky note.
    */

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

function deleteStickyNote(stickyNoteId) {
    console.log(
        "Deleting sticky note:",
        stickyNoteId
    );

    const noteIndex = stickyNotes.findIndex(
        (stickyNote) =>
            stickyNote.id === stickyNoteId
    );

    if (noteIndex === -1) {
        console.error(
            "Sticky note not found:",
            stickyNoteId
        );
        return;
    }

    stickyNotes.splice(noteIndex, 1);

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

    dragHandle.addEventListener(
        "pointerdown",
        (event) => {
            if (
                stickyNote.isLocked ||
                stickyNote.isMinimized
            ) {
                return;
            }

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

            const deltaX =
                event.clientX -
                startPointerX;

            const deltaY =
                event.clientY -
                startPointerY;

            const maxX =
                Math.max(
                    0,
                    stickyNoteContainer.clientWidth -
                        noteElement.offsetWidth
                );

            const maxY =
                Math.max(
                    0,
                    stickyNoteContainer.scrollHeight -
                        noteElement.offsetHeight
                );

            stickyNote.x =
                Math.max(
                    0,
                    Math.min(
                        maxX,
                        startNoteX +
                            deltaX
                    )
                );

            stickyNote.y =
                Math.max(
                    0,
                    Math.min(
                        maxY,
                        startNoteY +
                            deltaY
                    )
                );

            noteElement.style.left =
                `${stickyNote.x}px`;

            noteElement.style.top =
                `${stickyNote.y}px`;
        }
    );

    dragHandle.addEventListener(
        "pointerup",
        (event) => {
            if (!isDragging) {
                return;
            }

            isDragging = false;

            noteElement.classList.remove(
                "isDragging"
            );

            if (
                dragHandle.hasPointerCapture(
                    event.pointerId
                )
            ) {
                dragHandle.releasePointerCapture(
                    event.pointerId
                );
            }

            saveStickyNotes();
        }
    );

    dragHandle.addEventListener(
        "pointercancel",
        (event) => {
            if (!isDragging) {
                return;
            }

            isDragging = false;

            noteElement.classList.remove(
                "isDragging"
            );

            if (
                dragHandle.hasPointerCapture(
                    event.pointerId
                )
            ) {
                dragHandle.releasePointerCapture(
                    event.pointerId
                );
            }

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
   Initialization
   ========================================================= */

loadStickyNotes();

renderStickyNotes();
