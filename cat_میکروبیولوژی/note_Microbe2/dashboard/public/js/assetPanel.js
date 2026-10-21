// Images panel: lists the note's asset folder, shows which images are used
// and lets the operator insert, replace or delete them.

import { state } from "./state.js";
import { on } from "./bus.js";
import {
    getBlock,
    createNewBlock,
    editBlock,
    insertBlocksAfter
} from "/dashboard/src/documentModel.js";
import { mutate, requestFocus } from "./documentController.js";
import { getUsedAssetKeys, refreshAssets } from "./assetsController.js";
import { api } from "./api.js";
import { toast, confirmAction, reportError } from "./ui.js";
import {
    getAssetPicker,
    clearAssetPicker,
    openInsertPicker
} from "./assetPicker.js";

let listElement = null;
let pickerBanner = null;
let fileInput = null;

function lastContentBlockId() {
    if (!state.document) return null;

    for (let index = state.document.blocks.length - 1; index >= 0; index--) {
        const block = state.document.blocks[index];
        if (block.type !== "space") return block.id;
    }
    return null;
}

function assetNameWithoutExtension(asset) {
    return asset.fileName.replace(/\.[^.]+$/, "");
}

function useAsset(asset) {
    const picker = getAssetPicker();

    if (picker && picker.mode === "replace") {
        const block = getBlock(state.document, picker.blockId);
        if (!block || block.type !== "paragraph") {
            clearAssetPicker();
            return;
        }

        mutate(() => {
            if (block.variant === "placeholder") {
                const imageId = block.imageId;
                editBlock(block, {
                    variant: "image",
                    alt: block.alt || `Image ${imageId}`,
                    src: asset.markdownPath,
                    title: ""
                });
                delete block.imageId;
            } else {
                editBlock(block, { src: asset.markdownPath });
            }
        }, { structural: true });

        clearAssetPicker();
        toast("Image updated.", "success");
        return;
    }

    const referenceId = state.selectedBlockId || lastContentBlockId();
    const alt = assetNameWithoutExtension(asset);

    const imageBlock = createNewBlock({
        type: "paragraph",
        variant: "image",
        alt,
        src: asset.markdownPath,
        title: "",
        raw: `![${alt}](${asset.markdownPath})`,
        originalRaw: ""
    });

    mutate((document) => insertBlocksAfter(document, referenceId, [imageBlock]), {
        structural: true
    });

    requestFocus(imageBlock.id, "end");
    toast("Image inserted at the selected position.", "success");
}

function renderPickerBanner() {
    if (!pickerBanner) return;

    const picker = getAssetPicker();
    pickerBanner.replaceChildren();

    if (!picker) {
        pickerBanner.hidden = true;
        return;
    }

    pickerBanner.hidden = false;
    pickerBanner.textContent =
        picker.mode === "replace"
            ? "Choose an image to replace the selected one."
            : "Choose an image to insert into the note.";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "dashButton dashButtonSmall";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => clearAssetPicker());
    pickerBanner.appendChild(cancel);
}

function renderAssets() {
    if (!listElement) return;
    listElement.replaceChildren();
    renderPickerBanner();

    const usedKeys = getUsedAssetKeys();

    if (state.assets.length === 0) {
        const empty = document.createElement("li");
        empty.className = "emptyState";
        empty.textContent = "No images found in this note's asset folder.";
        listElement.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const asset of state.assets) {
        const isUsed =
            usedKeys.has(asset.name) ||
            usedKeys.has(asset.markdownPath) ||
            usedKeys.has(asset.fileName);

        const item = document.createElement("li");
        item.className = `assetItem${isUsed ? "" : " is_unused"}`;

        const thumbnail = document.createElement("img");
        thumbnail.className = "assetThumb";
        thumbnail.src = asset.url;
        thumbnail.alt = `Preview of ${asset.fileName}`;
        thumbnail.loading = "lazy";

        const meta = document.createElement("div");
        meta.className = "assetMeta";

        const name = document.createElement("div");
        name.className = "assetName";
        name.textContent = asset.name;
        name.title = asset.markdownPath;

        const status = document.createElement("div");
        status.className = `assetState${isUsed ? " is_used" : ""}`;
        status.textContent = isUsed ? "Used in the note" : "Not used yet";

        meta.append(name, status);

        const actions = document.createElement("div");
        actions.className = "assetActions";

        const useButton = document.createElement("button");
        useButton.type = "button";
        useButton.className = "dashButton dashButtonSmall";
        useButton.textContent = getAssetPicker() ? "Use here" : "Insert";
        useButton.setAttribute("aria-label", `Insert ${asset.fileName} into the note`);
        useButton.addEventListener("click", () => useAsset(asset));

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "dashButton dashButtonSmall";
        deleteButton.textContent = "Delete";
        deleteButton.setAttribute("aria-label", `Delete the file ${asset.fileName}`);
        deleteButton.addEventListener("click", () => {
            confirmAction({
                title: "Delete the asset file?",
                message: `"${asset.name}" will be permanently removed from the assets folder. This cannot be undone from the editor.`,
                confirmLabel: "Delete file"
            }).then(async (confirmed) => {
                if (!confirmed) return;
                try {
                    await api.deleteAsset(state.noteId, asset.fileName);
                    await refreshAssets();
                    toast(`Deleted ${asset.name}.`, "success");
                } catch (error) {
                    reportError(error, "The file could not be deleted.");
                }
            });
        });

        actions.append(useButton, deleteButton);
        item.append(thumbnail, meta, actions);
        fragment.appendChild(item);
    }

    listElement.appendChild(fragment);
}

function handleUpload() {
    if (!fileInput) return;

    fileInput.value = "";
    fileInput.click();
}

async function onFileSelected() {
    const file = fileInput.files && fileInput.files[0];
    if (!file || !state.noteId) return;

    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("The file could not be read."));
            reader.readAsDataURL(file);
        });

        await api.uploadAsset(state.noteId, file.name, dataUrl.split(",")[1]);
        await refreshAssets();
        toast(`${file.name} added to the assets folder.`, "success");

        openInsertPicker();
    } catch (error) {
        reportError(error, "The image could not be uploaded.");
    }
}

export function initAssetPanel() {
    listElement = document.getElementById("assetList");
    pickerBanner = document.createElement("div");
    pickerBanner.className = "rawBanner";
    pickerBanner.hidden = true;

    if (listElement && listElement.parentElement) {
        listElement.parentElement.insertBefore(pickerBanner, listElement);
    }

    fileInput = document.getElementById("assetFileInput");
    const uploadButton = document.getElementById("uploadAssetButton");

    if (uploadButton) uploadButton.addEventListener("click", handleUpload);
    if (fileInput) fileInput.addEventListener("change", onFileSelected);

    on("assets:changed", renderAssets);
    on("note:loaded", renderAssets);
    on("document:changed", renderAssets);
    on("assetPicker:changed", renderAssets);

    renderAssets();
}
