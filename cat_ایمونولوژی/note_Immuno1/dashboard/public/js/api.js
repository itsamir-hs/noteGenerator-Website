// Thin fetch wrapper for the dashboard's JSON API.

async function parseResponse(response) {
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || `Request failed with status ${response.status}.`);
    }

    return payload;
}

async function getJson(path) {
    const response = await fetch(path, { method: "GET" });
    return parseResponse(response);
}

async function postJson(path, body) {
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {})
    });
    return parseResponse(response);
}

export const api = {
    listNotes: () => getJson("/api/notes"),
    openNote: (path) => postJson("/api/open", { path }),
    saveNote: (noteId, markdown, overwriteOriginal = false) =>
        postJson("/api/save", { noteId, markdown, overwriteOriginal }),
    originalMarkdown: (noteId) => postJson("/api/original", { noteId }),
    renderPreview: (noteId, markdown) => postJson("/api/render", { noteId, markdown }),
    validate: (noteId, markdown) => postJson("/api/validate", { noteId, markdown }),
    exportNote: (noteId, markdown, force = false) =>
        postJson("/api/export", { noteId, markdown, force }),
    listAssets: (noteId) => postJson("/api/assets", { noteId }),
    uploadAsset: (noteId, name, data) => postJson("/api/upload", { noteId, name, data }),
    deleteAsset: (noteId, name) => postJson("/api/deleteAsset", { noteId, name })
};
