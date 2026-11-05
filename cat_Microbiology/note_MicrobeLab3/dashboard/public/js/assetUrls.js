// Resolves the note's Markdown image references to URLs the dashboard serves.
//
// Notes store images as Markdown paths relative to the note
// (`assets/photo.png`), while the server exposes the actual files under
// `/data/<noteId>/…`. Anything that paints an image — the image block card as
// well as images embedded in inline Markdown text — goes through these
// helpers, so the editor and the preview always point at the same file.

import { state } from "./state.js";

/** Find a note asset by Markdown path, name or bare file name. */
export function findAssetByPath(reference) {
    const normalized = String(reference || "");
    const baseName = normalized.split("/").pop();

    return (
        state.assets.find(
            (asset) =>
                asset.markdownPath === normalized ||
                asset.name === normalized ||
                asset.fileName === baseName
        ) || null
    );
}

/** URL the dashboard serves for a Markdown image reference (or null). */
export function assetUrlFor(reference) {
    const asset = findAssetByPath(reference);
    return asset ? asset.url : null;
}