// Keeps the session's asset list in sync with the server.

import { api } from "./api.js";
import { state } from "./state.js";
import { replaceAssets } from "./documentController.js";
import { collectImageBlocks, getImageReference } from "/dashboard/src/documentModel.js";
import { reportError } from "./ui.js";

/** Reload the note's asset folder from the server. */
export async function refreshAssets() {
    if (!state.noteId) return;

    try {
        const result = await api.listAssets(state.noteId);
        replaceAssets(result.assets);
    } catch (error) {
        reportError(error, "The asset list could not be refreshed.");
    }
}

function normalizeReference(reference) {
    return String(reference || "").replace(/^\.\//, "");
}

/**
 * Keys of assets currently referenced by the note (path and bare file name),
 * so the panel can distinguish used from unused images.
 */
export function getUsedAssetKeys() {
    const keys = new Set();
    if (!state.document) return keys;

    for (const block of collectImageBlocks(state.document)) {
        const reference = getImageReference(block);
        if (reference.isPlaceholder) {
            const entry = state.manifestImages.find(
                (image) => String(image.id) === String(reference.imageId)
            );
            if (entry) {
                keys.add(normalizeReference(entry.relativePath));
                keys.add(entry.relativePath.split("/").pop());
            }
            continue;
        }

        const path = normalizeReference(reference.src);
        keys.add(path);
        keys.add(path.split("/").pop());
    }

    return keys;
}
