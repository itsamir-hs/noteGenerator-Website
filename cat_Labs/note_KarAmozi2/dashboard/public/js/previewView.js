// Live preview: sends the current Markdown to the server, which renders it
// with Bashligh's own renderer, and loads the result into the preview frame.

import { state } from "./state.js";
import { on } from "./bus.js";
import { api } from "./api.js";
import { currentMarkdown } from "./documentController.js";
import { reportError } from "./ui.js";

const PREVIEW_DEBOUNCE_MS = 350;

let frame = null;
let timer = null;
let revision = 0;
let lastRenderedMarkdown = null;
let pendingScrollTop = null;
let consecutiveFailures = 0;

async function renderPreviewNow() {
    if (!state.noteId || !frame) return;

    const markdown = currentMarkdown();
    if (markdown === lastRenderedMarkdown) return;

    const currentRevision = ++revision;
    const scrollTop = captureScrollTop();

    try {
        await api.renderPreview(state.noteId, markdown);
        if (currentRevision !== revision) return;

        lastRenderedMarkdown = markdown;
        consecutiveFailures = 0;
        pendingScrollTop = scrollTop;

        frame.src = `/preview/${state.noteId}.html?rev=${currentRevision}`;
    } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures === 1) {
            reportError(error, "The preview could not be rendered.");
        }
    }
}

function captureScrollTop() {
    try {
        return frame && frame.contentWindow ? frame.contentWindow.scrollY : null;
    } catch {
        return null;
    }
}

function restoreScrollTop() {
    if (pendingScrollTop === null || !frame || !frame.contentWindow) return;
    try {
        frame.contentWindow.scrollTo(0, pendingScrollTop);
    } catch {
        // Cross-frame access can fail while the document is swapping.
    }
    pendingScrollTop = null;
}

function schedulePreview() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
        timer = null;
        renderPreviewNow();
    }, PREVIEW_DEBOUNCE_MS);
}

/** Force a preview refresh right now (Ctrl+Enter / manual refresh). */
export function refreshPreview() {
    if (timer) {
        window.clearTimeout(timer);
        timer = null;
    }
    lastRenderedMarkdown = null;
    renderPreviewNow();
}

export function initPreviewView() {
    frame = document.getElementById("previewFrame");
    if (!frame) return;

    frame.addEventListener("load", restoreScrollTop);

    on("document:changed", schedulePreview);
    on("note:loaded", () => {
        lastRenderedMarkdown = null;
        renderPreviewNow();
    });
    on("document:restored", schedulePreview);
}
