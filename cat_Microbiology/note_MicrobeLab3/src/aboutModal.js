// Controls opening and closing the About modal.

function initializeAboutModal() {
    const aboutButton = document.querySelector(".aboutButton");
    const aboutModal = document.querySelector(".aboutModal");
    const closeButton = document.querySelector(".aboutCloseButton");
    const backdrop = document.querySelector(".aboutModalBackdrop");

    if (
        !aboutButton ||
        !aboutModal ||
        !closeButton ||
        !backdrop
    ) {
        return;
    }

    function openModal() {
        aboutModal.classList.add("isOpen");
        aboutModal.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
        aboutModal.classList.remove("isOpen");
        aboutModal.setAttribute("aria-hidden", "true");
    }

    aboutButton.addEventListener("click", openModal);

    closeButton.addEventListener("click", closeModal);

    backdrop.addEventListener("click", closeModal);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeModal();
        }
    });
}

initializeAboutModal();
