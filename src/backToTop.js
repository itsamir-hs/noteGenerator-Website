/* =========================================================
   Back To Top

   The button ships in the note template and is styled in every
   theme, but only revealed once the reader has scrolled far
   enough for it to be useful.
   ========================================================= */

const backToTopButton = document.querySelector(
    ".backToTop"
);

const backToTopThreshold = 400;

let backToTicking = false;


function updateBackToTopVisibility() {
    if (!backToTopButton) {
        return;
    }

    const isVisible =
        window.scrollY > backToTopThreshold;

    backToTopButton.classList.toggle(
        "isVisible",
        isVisible
    );

    backToTopButton.setAttribute(
        "aria-hidden",
        String(!isVisible)
    );
}


function handleBackToTopScroll() {
    if (backToTicking) {
        return;
    }

    backToTicking = true;

    window.requestAnimationFrame(() => {
        updateBackToTopVisibility();
        backToTicking = false;
    });
}


function scrollBackToTop() {
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


if (backToTopButton) {
    backToTopButton.addEventListener(
        "click",
        scrollBackToTop
    );

    window.addEventListener(
        "scroll",
        handleBackToTopScroll,
        { passive: true }
    );

    updateBackToTopVisibility();
}