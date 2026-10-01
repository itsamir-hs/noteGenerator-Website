const fontSizeControls = document.querySelectorAll(
    ".fontSizeControl"
);

const fontSizeValue = document.querySelector(
    ".fontSizeValue"
);

const root = document.documentElement;

const fontSizes = [
    15,
    16,
    17,
    18,
    19
];

const fontSizeStorageKey =
    "noteFontSizeIndex";

let currentFontSizeIndex = 2;


/* =========================================================
   Font Size
   ========================================================= */

function updateFontSize() {
    const fontSize =
        fontSizes[currentFontSizeIndex];

    root.style.setProperty(
        "--fontSize",
        `${fontSize}px`
    );

    if (fontSizeValue) {
        fontSizeValue.textContent = "A";
    }

    localStorage.setItem(
        fontSizeStorageKey,
        String(currentFontSizeIndex)
    );
}


/* =========================================================
   Controls
   ========================================================= */

fontSizeControls.forEach(
    (control) => {
        control.addEventListener(
            "click",
            () => {
                const action =
                    control.dataset.action;

                if (
                    action === "increase" &&
                    currentFontSizeIndex <
                        fontSizes.length - 1
                ) {
                    currentFontSizeIndex++;
                }

                if (
                    action === "decrease" &&
                    currentFontSizeIndex > 0
                ) {
                    currentFontSizeIndex--;
                }

                updateFontSize();
            }
        );
    }
);


/* =========================================================
   Initial State
   ========================================================= */

const savedFontSizeIndex =
    Number(
        localStorage.getItem(
            fontSizeStorageKey
        )
    );

if (
    Number.isInteger(
        savedFontSizeIndex
    ) &&
    savedFontSizeIndex >= 0 &&
    savedFontSizeIndex <
        fontSizes.length
) {
    currentFontSizeIndex =
        savedFontSizeIndex;
}

updateFontSize();
