/* =========================================================
   Note Page — back to home control
   =========================================================
   Injected by the site layer into every generated note page. The note template
   cannot be modified, so the control is created at runtime and prepended to the
   existing header control cluster. */

(function addNoteHomeLink() {
    const headerControls = document.querySelector(".headerControls");

    if (!headerControls) {
        return;
    }

    if (document.querySelector(".noteHomeLink")) {
        return;
    }

    const homeLink = document.createElement("a");

    homeLink.className = "noteHomeLink";
    homeLink.href = "../../index.html";
    homeLink.title = "بازگشت به صفحه اصلی";
    homeLink.setAttribute(
        "aria-label",
        "بازگشت به صفحه اصلی"
    );

    homeLink.innerHTML =
        '<i data-lucide="library-big"></i>' +
        '<span class="noteHomeLinkText">خانه</span>';

    headerControls.prepend(homeLink);

    if (
        window.lucide &&
        typeof window.lucide.createIcons === "function"
    ) {
        window.lucide.createIcons();
    }
})();