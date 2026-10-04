/* =========================================================
   Note Page — per-note storage scoping
   =========================================================
   The original note module persists per-note state (sticky notes, highlights,
   scroll position) under single global localStorage keys. On a multi-note site
   that means note A's sticky notes show up on note B and every note reopens at
   note A's scroll position.

   This shim, injected before any of the original scripts run, namespaces those
   keys with the current note's id. `noteTheme` and `noteFontSizeIndex` are left
   alone: they are user preferences, not note data, and sharing them keeps the
   home page and the notes visually consistent.

   The original module is NOT modified — this only changes which key its own
   code happens to read and write. Set `enableStorageScoping: false` in
   site/config.js to turn it off. */

(function scopeNoteStorage() {
    const script = document.currentScript ||
        document.querySelector("script[data-note-scope]");

    const noteScope = script?.dataset?.noteScope;

    if (!noteScope) {
        return;
    }

    const SCOPED_KEYS = [
        "noteScrollPosition",
        "noteHighlights",
        "stickyNotes"
    ];

    function getNativeStorage() {
        try {
            return window.localStorage;
        } catch {
            return null;
        }
    }

    const nativeStorage = getNativeStorage();

    if (!nativeStorage) {
        return;
    }

    const prefix = `note:${noteScope}:`;

    function toScopedKey(key) {
        const name = String(key);

        if (!SCOPED_KEYS.includes(name)) {
            return name;
        }

        return `${prefix}${name}`;
    }

    const scopedStorage = {
        get length() {
            return nativeStorage.length;
        },

        key(index) {
            return nativeStorage.key(index);
        },

        getItem(key) {
            try {
                return nativeStorage.getItem(toScopedKey(key));
            } catch {
                return null;
            }
        },

        setItem(key, value) {
            try {
                nativeStorage.setItem(
                    toScopedKey(key),
                    String(value)
                );
            } catch {
                /* quota or private mode — never break the page */
            }
        },

        removeItem(key) {
            try {
                nativeStorage.removeItem(toScopedKey(key));
            } catch {
                /* ignore */
            }
        },

        clear() {
            SCOPED_KEYS.forEach((key) => {
                try {
                    nativeStorage.removeItem(`${prefix}${key}`);
                } catch {
                    /* ignore */
                }
            });
        }
    };

    try {
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            enumerable: true,
            get() {
                return scopedStorage;
            }
        });
    } catch (error) {
        console.warn(
            "Note storage scoping is unavailable on this browser:",
            error
        );
    }
})();