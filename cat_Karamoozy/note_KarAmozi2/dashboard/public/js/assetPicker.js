// Coordinates "pick an image from the Images panel" flows: inserting a new
// image at the caret position or replacing the image of an existing block.

import { emit } from "./bus.js";

let pickerState = null;

/** Select an existing image block as the replacement target. */
export function openAssetPicker(blockId) {
    pickerState = { mode: "replace", blockId };
    emit("assetPicker:changed", { picker: pickerState });
}

/** Next picked asset is inserted as a new image block. */
export function openInsertPicker() {
    pickerState = { mode: "insert" };
    emit("assetPicker:changed", { picker: pickerState });
}

export function clearAssetPicker() {
    if (!pickerState) return;
    pickerState = null;
    emit("assetPicker:changed", { picker: null });
}

export function getAssetPicker() {
    return pickerState;
}
