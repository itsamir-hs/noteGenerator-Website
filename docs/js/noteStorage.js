/* =========================================================
   Note Storage

   The site hosts many notes on one origin, so anything that
   belongs to a single note (highlights, sticky notes, scroll
   position) has to be namespaced per note. Preferences that
   should follow the reader across notes (theme, font size,
   highlight power) stay global.

   The note id comes from the data-note-slug attribute the
   renderer puts on <body>; pages without one fall back to a
   shared "default" bucket.
   ========================================================= */

const noteStorageFallbackId = "default";

function getNoteId() {
    const body = document.body;

    if (!body || typeof body.dataset === "undefined") {
        return noteStorageFallbackId;
    }

    const slug = (body.dataset.noteSlug || "").trim();

    return slug !== "" ? slug : noteStorageFallbackId;
}


function noteStorageKey(name) {
    return `note:${name}:${getNoteId()}`;
}

window.noteStorage = {
    getNoteId,
    noteStorageKey
};


/* =========================================================
   Consumer helper

   Read by every script that stores note-scoped data. Falls back
   to an unscoped key so a page that somehow loaded without
   this file keeps working instead of throwing on first use.
   ========================================================= */

window.noteScopedStorageKey = function (
    name
) {
    return typeof window.noteStorage?.noteStorageKey ===
        "function"
            ? window.noteStorage.noteStorageKey(name)
            : name;
};