const fontSwitchControl =
    document.querySelector(
        ".fontSwitchControl"
    );

const fontSwitcherRoot =
    document.documentElement;

const availableFonts = [
    {
        name: "IRKamran",
        family: '"IRKamran", sans-serif'
    },
    {
        name: "IRKoodak",
        family: '"IRKoodak", sans-serif'
    },
    {
        name: "Vazirmatn",
        family: '"Vazirmatn", sans-serif'
    },
    {
        name: "IRYekan",
        family: '"IRYekan", sans-serif'
    },
    {
        name: "System",
        family: "system-ui, sans-serif"
    }
];

const fontStorageKey =
    "noteFontIndex";

let currentFontIndex = 2;

let fontPanel = null;


/* =========================================================
   Font
   ========================================================= */

function updateFont() {
    const selectedFont =
        availableFonts[currentFontIndex];

    fontSwitcherRoot.style.setProperty(
        "--fontFamily",
        selectedFont.family
    );

    localStorage.setItem(
        fontStorageKey,
        String(currentFontIndex)
    );

    updateFontPanel();
}


/* =========================================================
   Font Panel
   ========================================================= */

function createFontPanel() {
    const panel =
        document.createElement("div");

    panel.className =
        "fontSwitcherPanel";

    panel.setAttribute(
        "role",
        "menu"
    );

    availableFonts.forEach(
        (font, index) => {
            const option =
                document.createElement(
                    "button"
                );

            option.type =
                "button";

            option.className =
                "fontSwitcherOption";

            option.dataset.fontIndex =
                String(index);

            option.textContent =
                font.name;

            option.style.fontFamily =
                font.family;

            option.addEventListener(
                "click",
                () => {
                    currentFontIndex =
                        index;

                    updateFont();

                    closeFontPanel();
                }
            );

            panel.appendChild(
                option
            );
        }
    );

    document.body.appendChild(
        panel
    );

    return panel;
}


function updateFontPanel() {
    if (!fontPanel) {
        return;
    }

    const options =
        fontPanel.querySelectorAll(
            ".fontSwitcherOption"
        );

    options.forEach(
        (option) => {
            const optionIndex =
                Number(
                    option.dataset.fontIndex
                );

            const isSelected =
                optionIndex ===
                currentFontIndex;

            option.classList.toggle(
                "isSelected",
                isSelected
            );

            option.setAttribute(
                "aria-current",
                isSelected
                    ? "true"
                    : "false"
            );
        }
    );
}


function openFontPanel() {
    if (!fontPanel) {
        fontPanel =
            createFontPanel();
    }

    const controlRect =
        fontSwitchControl.getBoundingClientRect();

    fontPanel.style.top =
        `${controlRect.bottom + 8}px`;

    fontPanel.style.left =
        `${controlRect.left}px`;

    fontPanel.classList.add(
        "isOpen"
    );

    updateFontPanel();
}


function closeFontPanel() {
    if (!fontPanel) {
        return;
    }

    fontPanel.classList.remove(
        "isOpen"
    );
}


function toggleFontPanel() {
    if (!fontPanel) {
        openFontPanel();
        return;
    }

    if (
        fontPanel.classList.contains(
            "isOpen"
        )
    ) {
        closeFontPanel();
    } else {
        openFontPanel();
    }
}


/* =========================================================
   Controls
   ========================================================= */

if (fontSwitchControl) {
    fontSwitchControl.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            toggleFontPanel();
        }
    );
}


document.addEventListener(
    "click",
    (event) => {
        if (
            !fontPanel ||
            !fontPanel.classList.contains(
                "isOpen"
            )
        ) {
            return;
        }

        if (
            event.target ===
                fontSwitchControl ||
            fontPanel.contains(
                event.target
            )
        ) {
            return;
        }

        closeFontPanel();
    }
);


/* =========================================================
   Initial State
   ========================================================= */

const savedFontIndex =
    Number(
        localStorage.getItem(
            fontStorageKey
        )
    );

if (
    Number.isInteger(
        savedFontIndex
    ) &&
    savedFontIndex >= 0 &&
    savedFontIndex <
        availableFonts.length
) {
    currentFontIndex =
        savedFontIndex;
}

updateFont();
