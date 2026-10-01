const themeSwitcher = document.querySelector(".themeSwitcher");
const themeToggle = document.querySelector(".themeToggle");
const themeOptions = document.querySelector(".themeOptions");
const themeButtons = document.querySelectorAll(".themeButton");

const themeStorageKey = "noteTheme";


function setTheme(themeName) {
    document.documentElement.dataset.theme = themeName;

    themeButtons.forEach((button) => {
        const isActive =
            button.dataset.theme === themeName;

        button.setAttribute(
            "aria-pressed",
            String(isActive)
        );
    });

    localStorage.setItem(
        themeStorageKey,
        themeName
    );
}


function toggleThemeOptions() {
    const isOpen =
        themeSwitcher.classList.toggle(
            "isOpen"
        );

    themeToggle.setAttribute(
        "aria-expanded",
        String(isOpen)
    );
}


function closeThemeOptions() {
    themeSwitcher.classList.remove(
        "isOpen"
    );

    themeToggle.setAttribute(
        "aria-expanded",
        "false"
    );
}


themeToggle.addEventListener(
    "click",
    toggleThemeOptions
);


themeButtons.forEach((button) => {
    button.addEventListener(
        "click",
        () => {
            const selectedTheme =
                button.dataset.theme;

            setTheme(selectedTheme);
            closeThemeOptions();
        }
    );
});


document.addEventListener(
    "click",
    (event) => {
        if (
            !themeSwitcher.contains(
                event.target
            )
        ) {
            closeThemeOptions();
        }
    }
);


/* =========================================================
   Initial State
   ========================================================= */

const savedTheme =
    localStorage.getItem(
        themeStorageKey
    );

setTheme(
    savedTheme ||
    document.documentElement.dataset.theme ||
    "light"
);
