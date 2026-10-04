// Central configuration for the GitHub Pages site layer.
//
// The site layer is a *separate* module built on top of the untouched
// `note_renderer` package. It only consumes the public API exported by
// `src/main.js` (renderNoteHtml) and re-uses the existing styles/scripts of the
// note template, so the note format stays owned by the original module.

export const SITE_CONFIG = {
    title: "جزوه‌ساز — کتابخانه جزوه‌ها",
    tagline: "ساعت‌های کلاس، تبدیل‌شده به جزوه‌هایی که می‌شود واقعاً خواند.",

    // Relative to the project root.
    notesDirectoryName: "notes",
    homePageFileName: "index.html",

    // Note sources. Every note gets its own folder under notesDirectoryName.
    markdownNotesDirectoryName: "content/notes",
    preRenderedNotesDirectoryName: "content/pre-rendered",

    /*
     * `output/` is where the original renderer's CLI writes (`node src/main.js`
     * hardcodes ./output/index.html), so the build reads it as a source too:
     * whatever the renderer just produced is imported like any other
     * pre-rendered note.
     *
     * `rendererOutputDefaultSlug` is used for source files with a generic name
     * (index.html) inside this directory — it is the "current render" slot.
     * Rename the file (e.g. `mv output/index.html output/my-topic.html`) to
     * publish the render as its own permanent note instead.
     */
    rendererOutputDirectoryName: "output",
    rendererOutputDefaultSlug: "latest",

    // Hand-edited metadata that overrides what the build extracts automatically.
    registryFilePath: "site/notes.registry.json",

    /*
     * Notes removed from the site with `node site/removeNote.js`. Listed here so
     * a later build can never resurrect them, even while their source file is
     * still on disk. Shape: [{ slug, source, removedAt }].
     */
    removedEntriesKey: "removed",

    // Build artefact: everything the build knows about every note.
    generatedIndexFilePath: "site/notes.generated.json",

    // Third-party runtime assets are copied here so the published site never
    // depends on node_modules being committed.
    vendorDirectoryName: "vendor",

    // Shared browser assets injected into every generated note page.
    noteAssetDirectoryName: "site/assets",
    noteNavStyleFileName: "noteNav.css",
    noteHomeLinkScriptFileName: "noteHomeLink.js",
    noteStorageScopeScriptFileName: "noteStorageScope.js",
    noteThemeBootScriptFileName: "themeBoot.js",

    // Home page.
    homeTemplatePath: "site/assets/home.template.html",
    homeStylePath: "site/assets/home.css",
    homeScriptPath: "site/assets/home.js",

    // Re-used verbatim from the original module — see note about src/ below.
    themeSwitcherScriptPath: "src/themeSwitcher.js",
    styleSheetPaths: [
        "styles/base.css",
        "styles/rtl.css",
        "styles/responsive.css",
        "styles/dark.css",
        "styles/forest.css",
        "styles/paperLike.css",
        "styles/neon.css"
    ],

    // Third-party assets copied out of node_modules into vendor/.
    vendorAssets: [
        {
            from: "node_modules/katex/dist/katex.min.css",
            to: "vendor/katex/katex.min.css"
        },
        {
            from: "node_modules/katex/dist/fonts",
            to: "vendor/katex/fonts",
            isDirectory: true
        },
        {
            from: "node_modules/lucide/dist/umd/lucide.min.js",
            to: "vendor/lucide/lucide.min.js"
        }
    ],

    // The note template links KaTeX/Lucide through node_modules. The site layer
    // rewrites those two references to the vendored copies above.
    nodeModulesPathRewrites: [
        {
            match: "../node_modules/katex/dist/katex.min.css",
            replace: "../../vendor/katex/katex.min.css"
        },
        {
            match: "../node_modules/lucide/dist/umd/lucide.js",
            replace: "../../vendor/lucide/lucide.min.js"
        }
    ],

    defaultTheme: "light",

    themes: [
        { key: "light", label: "تم روشن", icon: "sun" },
        { key: "dark", label: "تم تاریک", icon: "moon" },
        { key: "forest", label: "تم جنگلی", icon: "trees" },
        { key: "paperLike", label: "تم پیپر لایک", icon: "file-text" },
        { key: "neon", label: "تم نئون", icon: "zap" }
    ],

    /*
     * Multi-note fix applied by the site layer (the original module keeps its
     * behaviour untouched):
     *
     * `src/viewPersistence.js`, `src/highlight.js` and `src/stickyNotes.js` all
     * use single, global localStorage keys, so on a multi-note site sticky
     * notes, highlights and the scroll position leak from one note into the
     * next one. These keys are therefore namespaced per note by
     * site/assets/noteStorageScope.js, which is injected before any of the
     * original scripts run. `theme`/`fontSize` stay global because they are
     * user preferences, not note data.
     */
    noteScopedStorageKeys: [
        "noteScrollPosition",
        "noteHighlights",
        "stickyNotes"
    ],

    // Can be disabled with `--no-storage-scope` / config override.
    enableStorageScoping: true,

    /*
     * Contributors shown behind the "آدم هایی که اینجا رو ساختن" button on the
     * home page. Mirrors the team table of the original module's README plus the
     * note template's About modal.
     */
    contributors: [
        {
            name: "شبنم رضاپور",
            role: "استخراج فایل‌ها"
        },
        {
            name: "امیر‌حسین شکری‌زاده سعادت‌آباد",
            role: "پردازش صوت و ویدیو"
        },
        {
            name: "مهراد اسدی",
            role: "پرامپت‌نویسی و پردازش با هوش مصنوعی"
        },
        {
            name: "امیرسالار سهام‌پور",
            role: "فرانت‌اند و طراحی رابط کاربری"
        }
    ],

    contributorsButtonLabel: "آدم هایی که اینجا رو ساختن",
    contributorsModalTitle: "آدم‌هایی که اینجا رو ساختن",
    contributorsIntroduction:
        "ما یک تیم کوچک هستیم که باور داریم یادگیری باید لذت‌بخش، عمیق و در دسترس باشد. جزوه‌ساز تلاش ماست برای تبدیل ساعت‌های طولانی کلاس به متن‌هایی که واقعاً بتوانی با آن‌ها چیزی یاد بگیری.",
    contributorsFooter:
        "این پروژه با صبر، چای، و چند شب بی‌خوابی ساخته شد. امیدواریم یادگیریت را لذت‌بخش‌تر کند.",

    searchPlaceholder: "جستجو در عنوان، درس، مبحث و برچسب‌ها...",
    emptySearchResultMessage: "هیچ جزوه‌ای با این عبارت پیدا نشد.",
    notesMenuTitle: "منوی جزوه‌ها"
};