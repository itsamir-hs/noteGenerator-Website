const quickNavigation = document.querySelector(
    ".quickNavigation"
);

const quickNavigationList = document.querySelector(
    ".quickNavigationList"
);

function getNoteSections() {
    return document.querySelectorAll(
        ".noteSection"
    );
}

function createQuickNavigation() {
    if (!quickNavigationList) {
        return;
    }

    const noteSections =
        getNoteSections();

    quickNavigationList.innerHTML = "";

    noteSections.forEach((section, index) => {
        const heading = section.querySelector(
            ":scope > h2"
        );

        const item =
            document.createElement("button");

        item.type = "button";
        item.className =
            "quickNavigationItem";

        item.dataset.index =
            index;

        if (heading) {
            item.dataset.label =
                heading.textContent.trim();
        }

        item.addEventListener(
            "click",
            () => {
                const currentSections =
                    getNoteSections();

                const currentSection =
                    currentSections[index];

                if (!currentSection) {
                    return;
                }

                currentSection.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            }
        );

        quickNavigationList.appendChild(
            item
        );
    });
}

function updateActiveNavigation() {
    const noteSections =
        getNoteSections();

    let activeIndex = 0;

    noteSections.forEach(
        (section, index) => {
            const sectionTop =
                section.getBoundingClientRect().top;

            if (sectionTop <= 180) {
                activeIndex = index;
            }
        }
    );

    const items =
        document.querySelectorAll(
            ".quickNavigationItem"
        );

    items.forEach(
        (item, index) => {
            item.classList.toggle(
                "isActive",
                index === activeIndex
            );
        }
    );
}

createQuickNavigation();

window.addEventListener(
    "scroll",
    updateActiveNavigation,
    {
        passive: true
    }
);

updateActiveNavigation();
