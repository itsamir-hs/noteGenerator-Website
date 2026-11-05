// Small UI helpers: toasts, confirmations and icon refresh.

const TOAST_LIFETIME_MS = 4500;

/** Re-render lucide icons after markup that contains <i data-lucide> nodes. */
export function refreshIcons(root = document) {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons({ root });
    }
}

/** Show a short status message that fades away on its own. */
export function toast(message, kind = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;

    const element = document.createElement("div");
    element.className = `toast is_${kind}`;
    element.textContent = message;

    region.appendChild(element);

    window.setTimeout(() => {
        element.remove();
    }, TOAST_LIFETIME_MS);
}

/**
 * Ask the operator to confirm a destructive action.
 * @returns {Promise<boolean>}
 */
export function confirmAction({ title, message, confirmLabel = "Delete" }) {
    return new Promise((resolve) => {
        const dialog = document.getElementById("confirmDialog");
        const titleElement = document.getElementById("confirmDialogTitle");
        const messageElement = document.getElementById("confirmDialogMessage");
        const okButton = document.getElementById("confirmOkButton");
        const cancelButton = document.getElementById("confirmCancelButton");

        if (!dialog) {
            resolve(window.confirm(message));
            return;
        }

        titleElement.textContent = title;
        messageElement.textContent = message;
        okButton.textContent = confirmLabel;

        const settle = (result) => {
            okButton.removeEventListener("click", onConfirm);
            cancelButton.removeEventListener("click", onCancel);
            dialog.removeEventListener("close", onClose);
            if (dialog.open) dialog.close();
            resolve(result);
        };

        const onConfirm = () => settle(true);
        const onCancel = () => settle(false);
        const onClose = () => settle(false);

        okButton.addEventListener("click", onConfirm);
        cancelButton.addEventListener("click", onCancel);
        dialog.addEventListener("close", onClose);

        dialog.showModal();
        cancelButton.focus();
    });
}

/** Report an expected failure (bad file, server error…) in plain language. */
export function reportError(error, contextMessage) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = contextMessage ? `${contextMessage} ${detail}` : detail;
    console.error(message, error);
    toast(message, "error");
}
