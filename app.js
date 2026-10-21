const themeSwitcher = document.querySelector(".themeSwitcher");
const themeToggle = document.querySelector(".themeToggle");
const themeButtons = document.querySelectorAll(".themeButton");
const searchInput = document.getElementById("searchInput");
const notesContainer = document.getElementById("notesContainer");
const emptyState = document.getElementById("emptyState");

const themeStorageKey = "noteTheme";

let notes = [];

function setTheme(themeName) {
    document.documentElement.dataset.theme = themeName;

    themeButtons.forEach((button) => {
        const isActive = button.dataset.theme === themeName;
        button.setAttribute("aria-pressed", String(isActive));
    });

    localStorage.setItem(themeStorageKey, themeName);
}

function toggleThemeOptions() {
    const isOpen = themeSwitcher.classList.toggle("isOpen");
    themeToggle.setAttribute("aria-expanded", String(isOpen));
}

function closeThemeOptions() {
    themeSwitcher.classList.remove("isOpen");
    themeToggle.setAttribute("aria-expanded", "false");
}

themeToggle.addEventListener("click", toggleThemeOptions);

themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setTheme(button.dataset.theme);
        closeThemeOptions();
    });
});

document.addEventListener("click", (event) => {
    if (!themeSwitcher.contains(event.target)) {
        closeThemeOptions();
    }
});

const savedTheme = localStorage.getItem(themeStorageKey);
setTheme(savedTheme || document.documentElement.dataset.theme || "light");

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(
        new RegExp(`(${escapedQuery})`, "gi"),
        "<mark>$1</mark>"
    );
}

const uncategorizedLabel = "بدون دسته‌بندی";

/* ---------- sorting + "new" tag ---------- */

const sortStorageKey = "papyrusSort";
const sortModes = ["newest", "session", "title"];
const newNoteHours = 24; // how long the "جدید" tag stays on a note
const seenStorageKey = "papyrusSeenNotes";
const collator = new Intl.Collator("fa");
const sortButtons = document.querySelectorAll(".sortButton");

let sortMode = "newest";
try {
    const savedSort = localStorage.getItem(sortStorageKey);
    if (sortModes.includes(savedSort)) sortMode = savedSort;
} catch (_) {
    /* storage unavailable */
}

// Notes the person already opened on this device (their tag is gone for good)
function loadSeenNotes() {
    try {
        const saved = JSON.parse(localStorage.getItem(seenStorageKey));
        return new Set(Array.isArray(saved) ? saved : []);
    } catch (_) {
        return new Set();
    }
}

const seenNotes = loadSeenNotes();

function saveSeenNotes() {
    try {
        localStorage.setItem(seenStorageKey, JSON.stringify([...seenNotes]));
    } catch (_) {
        /* storage unavailable */
    }
}

function noteKey(note) {
    return note.id || note.path;
}

function isNewNote(note) {
    return (
        note.timestamp > 0 &&
        Date.now() - note.timestamp < newNoteHours * 60 * 60 * 1000 &&
        !seenNotes.has(noteKey(note))
    );
}

function markNoteSeen(note, card) {
    if (!isNewNote(note)) return;
    seenNotes.add(noteKey(note));
    saveSeenNotes();
    const badge = card.querySelector(".newBadge");
    if (badge) badge.remove();
}

function compareByTitle(a, b) {
    return collator.compare(a.title, b.title);
}

const noteComparators = {
    // newest first
    newest: (a, b) => b.timestamp - a.timestamp || compareByTitle(a, b),

    // course, then session number (notes without a session go last)
    session: (a, b) => {
        if (!a.course !== !b.course) return a.course ? -1 : 1;
        const byCourse = collator.compare(a.course || "", b.course || "");
        if (byCourse) return byCourse;

        const sa = a.sessionNumber ?? Infinity;
        const sb = b.sessionNumber ?? Infinity;
        if (sa !== sb) return sa < sb ? -1 : 1;

        return compareByTitle(a, b);
    },

    title: compareByTitle,
};

function updateSortButtons() {
    sortButtons.forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.sort === sortMode));
    });
}

function setSortMode(mode) {
    if (!sortModes.includes(mode)) return;
    sortMode = mode;
    try {
        localStorage.setItem(sortStorageKey, mode);
    } catch (_) {
        /* storage unavailable */
    }
    updateSortButtons();
    renderNotes(searchInput.value);
}

sortButtons.forEach((button) => {
    button.addEventListener("click", () => setSortMode(button.dataset.sort));
});

updateSortButtons();

/* ---------- rendering ---------- */

function createNoteCard(note, q) {
    const card = document.createElement("a");
    card.className = "noteCard";
    card.href = note.path.split("/").map(encodeURIComponent).join("/");
    card.innerHTML = `
        <span class="noteCardHead">
            <span class="noteCardTitle">${highlightText(note.title, q)}</span>
            ${isNewNote(note) ? '<span class="newBadge">جدید</span>' : ""}
        </span>
    `;

    const markAsSeen = () => markNoteSeen(note, card);
    card.addEventListener("click", markAsSeen);
    card.addEventListener("auxclick", markAsSeen); // middle-click / new tab

    return card;
}

function createGrid(list, q) {
    const grid = document.createElement("div");
    grid.className = "notesGrid";
    list.forEach((note) => grid.appendChild(createNoteCard(note, q)));
    return grid;
}

function renderNotes(query = "") {
    const q = query.trim().toLowerCase();
    const filtered = q
        ? notes.filter(
              (n) =>
                  n.title.toLowerCase().includes(q) ||
                  (n.category || "").toLowerCase().includes(q)
          )
        : notes;

    notesContainer.innerHTML = "";

    if (filtered.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    const compare = noteComparators[sortMode];

    // Group by category; uncategorized goes last
    const groups = new Map();
    const uncategorized = [];

    filtered.forEach((note) => {
        if (!note.category) {
            uncategorized.push(note);
            return;
        }
        if (!groups.has(note.category)) groups.set(note.category, []);
        groups.get(note.category).push(note);
    });

    uncategorized.sort(compare);

    // No categories at all: plain grid, no headings
    if (groups.size === 0) {
        notesContainer.appendChild(createGrid(uncategorized, q));
        return;
    }

    const sections = [...groups.entries()].map(([name, list]) => {
        list.sort(compare);
        return { name, list, latest: Math.max(...list.map((n) => n.timestamp)) };
    });

    // Newest mode: the category with the most recent note comes first
    sections.sort((a, b) =>
        sortMode === "newest"
            ? b.latest - a.latest || collator.compare(a.name, b.name)
            : collator.compare(a.name, b.name)
    );

    if (uncategorized.length) sections.push({ name: null, list: uncategorized });

    sections.forEach(({ name, list }) => {
        const section = document.createElement("section");
        section.className = "categorySection";

        const title = document.createElement("h2");
        title.className = "categoryTitle";
        title.innerHTML = `
            <span>${name ? highlightText(name, q) : uncategorizedLabel}</span>
            <span class="categoryCount">${list.length.toLocaleString("fa-IR")}</span>
        `;

        section.appendChild(title);
        section.appendChild(createGrid(list, q));
        notesContainer.appendChild(section);
    });
}

searchInput.addEventListener("input", (e) => {
    renderNotes(e.target.value);
});

fetch("notes.json", { cache: "no-cache" })
    .then((res) => res.json())
    .then((data) => {
        notes = (data.notes || []).map((note) => ({
            ...note,
            timestamp: Date.parse(note.added) || 0,
        }));

        // Forget "seen" entries of notes that no longer exist
        const knownKeys = new Set(notes.map(noteKey));
        [...seenNotes].forEach((key) => {
            if (!knownKeys.has(key)) seenNotes.delete(key);
        });
        saveSeenNotes();

        renderNotes(searchInput.value);
    })
    .catch(() => {
        notes = [];
        renderNotes();
    });

// About modal
const aboutButton = document.querySelector(".aboutButton");
const aboutModal = document.querySelector(".aboutModal");
const aboutCloseButton = document.querySelector(".aboutCloseButton");
const aboutModalBackdrop = document.querySelector(".aboutModalBackdrop");

function openAboutModal() {
    aboutModal.classList.add("isOpen");
    aboutModal.setAttribute("aria-hidden", "false");
}

function closeAboutModal() {
    aboutModal.classList.remove("isOpen");
    aboutModal.setAttribute("aria-hidden", "true");
}

if (aboutButton && aboutModal) {
    aboutButton.addEventListener("click", openAboutModal);
    aboutCloseButton.addEventListener("click", closeAboutModal);
    aboutModalBackdrop.addEventListener("click", closeAboutModal);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAboutModal();
    });
}
