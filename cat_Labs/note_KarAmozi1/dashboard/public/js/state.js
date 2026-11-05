// Central state of the editing session. Views read from here and react to
// bus events instead of reaching into each other.

export const state = {
    // Note identity and files
    noteId: null,
    notePath: null,
    noteName: null,
    originalMarkdown: "",
    savedMarkdown: "",
    savedAt: null,
    saveState: "empty", // empty | clean | dirty | saving | saved | error
    editedExists: false,

    // Document
    document: null,
    history: null,
    saveTracker: null,

    // Assets
    assets: [],
    manifestImages: [],

    // Panels
    issues: [],
    reviewItems: [],

    // Interaction
    selectedBlockId: null,
    focusRequest: null,
    view: "edit", // edit | preview | structure (small screens)
    panel: "outline"
};

/** Convenience accessors used across views. */
export function isNoteOpen() {
    return Boolean(state.noteId && state.document);
}

export function countWords(markdown) {
    const plain = String(markdown || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[#>*_`|\\-]/g, " ")
        .replace(/\$\$?[^$]*\$\$?/g, " ");

    const words = plain.split(/\s+/).filter((word) => /[^\s]/.test(word));
    return words.length;
}
