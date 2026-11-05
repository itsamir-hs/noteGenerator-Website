/* =========================================================
   View Persistence
   ========================================================= */

const scrollStorageKey =
    "noteScrollPosition";


let scrollSaveTimer = null;


/* =========================================================
   Save Scroll Position
   ========================================================= */

function saveScrollPosition() {
    clearTimeout(
        scrollSaveTimer
    );

    scrollSaveTimer = setTimeout(
        () => {
            localStorage.setItem(
                scrollStorageKey,
                String(window.scrollY)
            );
        },
        100
    );
}


/* =========================================================
   Restore Scroll Position
   ========================================================= */

function restoreScrollPosition() {
    const savedPosition =
        Number(
            localStorage.getItem(
                scrollStorageKey
            )
        );

    if (
        !Number.isFinite(
            savedPosition
        )
    ) {
        return;
    }

    requestAnimationFrame(() => {
        window.scrollTo({
            top: savedPosition,
            behavior: "instant"
        });
    });
}


/* =========================================================
   Events
   ========================================================= */

window.addEventListener(
    "scroll",
    saveScrollPosition,
    {
        passive: true
    }
);


/* =========================================================
   Initial State
   ========================================================= */

restoreScrollPosition();
