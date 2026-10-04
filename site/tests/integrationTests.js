// End-to-end tests for the site layer.
//
// The suite runs in two phases:
//
//   1. fixtures  — extra notes + a registry that exercises slug/title overrides,
//                   hidden notes, ordering and tags
//   2. production — the real content/ and the real registry, plus the browser
//                   behaviour of the generated pages (jsdom) and the full link
//                   check through the local static server
//
// Both phases drive the real `buildSite()`, so what is asserted here is exactly
// what ends up in the published site.

import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
    after,
    before,
    describe,
    test,
    assert,
    assertEqual,
    assertDeepEqual,
    assertIncludes,
    assertExcludes
} from "./harness.js";
import { SITE_CONFIG } from "../config.js";
import { toAbsolute } from "../paths.js";
import { normalizeSearchText } from "../textUtils.js";
import { buildSite } from "../buildSite.js";
import { renderHomePage } from "../homePage.js";
import { runLinkCheck } from "../serve.js";
import { installFixtures, restoreFixtures } from "./fixtures.js";

const notesDirectory = toAbsolute(SITE_CONFIG.notesDirectoryName);
const homePagePath = toAbsolute(SITE_CONFIG.homePageFileName);

let buildResult = null;
let homeHtml = "";

function findNote(predicate, description) {
    const note = buildResult.notes.find(predicate);

    assert(note, `no note matched: ${description}`);

    return note;
}

/** Match a note by its source file name, with or without the directory. */
function hasSourceFile(entry, fileName) {
    return (
        entry.source.file === fileName ||
        entry.source.file.endsWith(`/${fileName}`)
    );
}

async function readNotePage(slug) {
    return readFile(path.join(notesDirectory, slug, "index.html"), "utf8");
}

async function pathExists(absolutePath) {
    try {
        await stat(absolutePath);

        return true;
    } catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }

        throw error;
    }
}

async function readHomePage() {
    return readFile(homePagePath, "utf8");
}

function readAsset(relativePath) {
    return readFile(toAbsolute(relativePath), "utf8");
}

/** Load a generated page into jsdom and run the scripts that matter. */
async function createPageDom(htmlPath, { url, scripts }) {
    const html = await readFile(htmlPath, "utf8");

    const dom = new JSDOM(html, {
        runScripts: "outside-only",
        url
    });

    for (const script of scripts) {
        dom.window.eval(await readAsset(script));
    }

    return dom;
}

const HOME_SCRIPTS = [
    "site/assets/textSearch.js",
    "site/assets/home.js"
];

describe("build with fixtures", () => {
    before(async () => {
        await installFixtures();

        buildResult = await buildSite({ quiet: true });
        homeHtml = await readHomePage();
    });

    after(async () => {
        await restoreFixtures();

        await buildSite({ quiet: true });
    });

    test("builds a note from a temporary Markdown source", () => {
        const note = findNote(
            (entry) => hasSourceFile(entry, "fixture-math.md"),
            "fixture markdown note"
        );

        assertEqual(note.slug, "fixture-math");
        assertEqual(note.title, "ریاضی آزمایشگاهی");
        assertEqual(note.course, "فیزیک آزمایشگاهی");
        assertEqual(note.instructor, "دکتر آزمایش");
        assertEqual(note.hidden, true);
    });

    test("renders Markdown features of a temporary note", async () => {
        const html = await readNotePage("fixture-math");

        assertIncludes(html, "katex-display");
        assertIncludes(html, "<table>");
        assertIncludes(html, "calloutBox calloutBox--tip");
    });

    test("honours a slug override from the registry", () => {
        const note = findNote(
            (entry) => hasSourceFile(entry, "fixture-pre-rendered.html"),
            "fixture pre-rendered note"
        );

        assertEqual(note.slug, "custom-prerendered-slug");
        assertEqual(note.source.kind, "pre-rendered");
    });

    test("honours a title override from the registry", () => {
        const note = findNote(
            (entry) => entry.slug === "custom-prerendered-slug",
            "slug-overridden note"
        );

        assertEqual(note.title, "عنوان جایگزین جزوه");
        assertIncludes(homeHtml, "عنوان جایگزین جزوه");
    });

    test("imports a pre-rendered document and re-anchors its assets", async () => {
        const html = await readNotePage("custom-prerendered-slug");

        assertIncludes(html, '<h2 id="heading-1">متن از پیش رندر شده</h2>');
        assertIncludes(html, 'href="../../styles/base.css"');
        assertIncludes(html, 'href="../../vendor/katex/katex.min.css"');
        assertIncludes(html, 'src="../../vendor/lucide/lucide.min.js"');
        assertIncludes(html, 'src="../../src/print.js"');
    });

    test("imports a pre-rendered document without re-rendering its text", async () => {
        const html = await readNotePage("custom-prerendered-slug");

        // The <title> of a pre-rendered page is the page's own title; the build
        // only changes what the home page *displays*, never the document.
        assertIncludes(html, "<title>جزوهٔ پیش‌رندر آزمایشی</title>");
        assertIncludes(html, 'data-theme="forest"');
    });

    test("imports a document that the original renderer just wrote to output/", () => {
        const note = findNote(
            (entry) => hasSourceFile(entry, "fixture-alpha.html"),
            "renderer output note"
        );

        assertEqual(note.slug, "fixture-alpha");
        assertEqual(note.source.kind, "rendered");
        assertEqual(note.source.file, "output/fixture-alpha.html");
        assertEqual(note.title, "خروجی تازهٔ رندرر");
        assertEqual(note.course, "درس رندر");
    });

    test("publishes byte-identical content only once", () => {
        const publishedCopies = buildResult.notes.filter((note) =>
            ["fixture-alpha.html", "fixture-beta.html"].some((name) =>
                hasSourceFile(note, name)
            )
        );

        assertEqual(
            publishedCopies.length,
            1,
            "exactly one copy of identical content may be published"
        );

        const duplicateIssue = buildResult.issues.find(
            (issue) => issue.type === "duplicate-content"
        );

        assert(duplicateIssue, "the build must report the duplicate");
    });

    test("publishes same-title notes with different content, but warns", () => {
        const sameTitleNotes = buildResult.notes.filter((note) =>
            ["fixture-alpha.html", "fixture-gamma.html"].some((name) =>
                hasSourceFile(note, name)
            )
        );

        assertEqual(
            sameTitleNotes.length,
            2,
            "different content must be published even with the same title"
        );

        const duplicateTitle = buildResult.issues.find(
            (issue) => issue.type === "duplicate-title"
        );

        assert(duplicateTitle, "the build must warn about duplicate titles");
    });

    test("skips notes listed as removed", () => {
        assertEqual(
            buildResult.notes.some(
                (note) => note.slug === "fixture-removed-note"
            ),
            false
        );

        assert(
            buildResult.issues.some(
                (issue) => issue.type === "removed"
            ),
            "the build must report the skipped note"
        );
    });

    test("keeps a hidden note out of the home page menu", () => {
        assertExcludes(homeHtml, 'data-note-slug="fixture-math"');
        assertExcludes(homeHtml, 'href="notes/fixture-math/"');
    });

    test("still publishes the page of a hidden note", async () => {
        const html = await readNotePage("fixture-math");

        assertIncludes(html, "<title>ریاضی آزمایشگاهی</title>");
    });

    test("shows no tag chips and no source badge on the cards", () => {
        assertExcludes(homeHtml, "noteCardTag");
        assertExcludes(homeHtml, "noteCardTags");
        assertExcludes(homeHtml, "noteCardSource");
    });

    test("applies a registry description and order to an existing note", () => {
        const note = findNote(
            (entry) => entry.slug === "nervous-system",
            "nervous system note"
        );

        assertEqual(note.description, "توضیح دستی برای تست اولویت‌ها.");
        assertEqual(note.order, 5);
    });

    test("never leaves an unresolved template placeholder", async () => {
        const documents = [
            homeHtml,
            ...(await Promise.all(
                buildResult.notes.map((note) => readNotePage(note.slug))
            ))
        ];

        for (const document of documents) {
            assert(
                !/\{\{[^}]+\}\}/.test(document),
                "document still contains a {{placeholder}}"
            );
        }
    });

    test("purging a note also deletes its source file", async () => {
        const { removeNote } = await import("../removeNote.js");

        await removeNote({
            slug: "custom-prerendered-slug",
            purge: true,
            build: false
        });

        assertEqual(
            await pathExists(
                toAbsolute(
                    `${SITE_CONFIG.preRenderedNotesDirectoryName}/fixture-pre-rendered.html`
                )
            ),
            false,
            "--purge must delete the pre-rendered source"
        );

        assertEqual(
            await pathExists(
                path.join(notesDirectory, "custom-prerendered-slug")
            ),
            false
        );

        const rebuilt = await buildSite({ quiet: true });

        assertEqual(
            rebuilt.notes.some(
                (note) => note.slug === "custom-prerendered-slug"
            ),
            false
        );

        buildResult = rebuilt;
    });

    test("passes the full link check with fixtures present", async () => {
        const result = await runLinkCheck({ port: 0 });

        assertEqual(
            result.failures.length,
            0,
            JSON.stringify(result.failures, null, 2)
        );
    });
});

describe("build of the published content", () => {
    before(async () => {
        buildResult = await buildSite({ quiet: true });
        homeHtml = await readHomePage();
    });

    test("vendors KaTeX and Lucide out of node_modules", () => {
        const targets = buildResult.vendorResults.map(
            (result) => result.target
        );

        assertIncludes(targets.join(","), "vendor/katex/katex.min.css");
        assertIncludes(targets.join(","), "vendor/katex/fonts");
        assertIncludes(targets.join(","), "vendor/lucide/lucide.min.js");
    });

    test("leaves no fixture note behind", () => {
        assertEqual(
            buildResult.notes.some((note) => note.slug.startsWith("fixture")),
            false
        );

        assertEqual(
            buildResult.notes.some((note) =>
                note.slug.startsWith("custom-prerendered")
            ),
            false
        );
    });

    test("publishes one folder per note", async () => {
        assert(buildResult.notes.length >= 3);

        for (const note of buildResult.notes) {
            const html = await readNotePage(note.slug);

            assert(html.length > 1000, `${note.slug}/index.html is empty`);
        }
    });

    test("supports markdown and pre-rendered notes side by side", () => {
        const kinds = new Set(
            buildResult.notes.map((note) => note.source.kind)
        );

        assert(kinds.has("markdown"));
        assert(kinds.has("pre-rendered"));
    });

    test("re-anchors every asset reference to the note's real depth", async () => {
        for (const note of buildResult.notes) {
            const html = await readNotePage(note.slug);

            assertExcludes(html, 'href="../styles/');
            assertExcludes(html, 'src="../src/');
            assertExcludes(html, 'src="../node_modules/');
            assertExcludes(html, 'src="../data/assets/');
            assertIncludes(html, 'href="../../styles/base.css"');
            assertIncludes(html, 'href="../../vendor/katex/katex.min.css"');
            assertIncludes(html, 'src="../../vendor/lucide/lucide.min.js"');
            assertIncludes(html, 'src="../../src/search.js"');
        }
    });

    test("keeps markdown images reachable", async () => {
        const note = findNote(
            (entry) => entry.source.kind === "markdown",
            "markdown note"
        );

        const html = await readNotePage(note.slug);

        assertIncludes(html, 'src="../../data/assets/whale.png"');
    });

    test("ships the image size override that base.css is missing", async () => {
        const style = await readAsset("site/assets/noteNav.css");

        assertIncludes(style, ".noteSection img");
        assertIncludes(style, "max-width: 100%");

        // base.css only constrains images inside .mainSection, so an image in any
        // other section would render at its natural size and widen the whole
        // document. This is a safety net only; the note module is untouched.
        const baseStyle = await readAsset("styles/base.css");

        assertIncludes(baseStyle, ".mainSection img");
    });

    test("injects the site navigation into every note", async () => {
        for (const note of buildResult.notes) {
            const html = await readNotePage(note.slug);

            assertIncludes(html, `data-note-scope="${note.slug}"`);
            assertIncludes(html, "site/assets/noteHomeLink.js");
            assertIncludes(html, "site/assets/noteNav.css");
        }
    });

    test("builds a searchable text blob for every note", () => {
        for (const note of buildResult.notes) {
            const normalizedTitle = normalizeSearchText(note.title);

            assert(note.searchText.length > 0);
            assertIncludes(note.searchText, normalizedTitle.split(" ")[0]);
        }
    });

    test("is idempotent — a second build produces byte-identical output", async () => {
        const pagesBefore = await Promise.all(
            buildResult.notes.map((note) => readNotePage(note.slug))
        );

        const homeBefore = await readHomePage();

        await buildSite({ quiet: true });

        const pagesAfter = await Promise.all(
            buildResult.notes.map((note) => readNotePage(note.slug))
        );

        assertEqual(pagesAfter.join("\n"), pagesBefore.join("\n"));
        assertEqual(await readHomePage(), homeBefore);
    });

    test("writes a machine readable notes index", async () => {
        const generated = JSON.parse(
            await readAsset(SITE_CONFIG.generatedIndexFilePath)
        );

        assertEqual(generated.notes.length, buildResult.notes.length);
        assertEqual(
            generated.visibleNoteCount,
            buildResult.notes.filter((note) => !note.hidden).length
        );
    });
});

describe("home page markup", () => {
    before(async () => {
        if (!homeHtml) {
            buildResult = await buildSite({ quiet: true });
            homeHtml = await readHomePage();
        }
    });

    test("is a complete RTL document that reuses the note stylesheets", () => {
        assertIncludes(homeHtml, "<!DOCTYPE html>");
        assertIncludes(homeHtml, '<html lang="fa" dir="rtl"');
        assertIncludes(homeHtml, 'href="styles/base.css"');
        assertIncludes(homeHtml, 'href="styles/rtl.css"');
        assertIncludes(homeHtml, 'href="styles/responsive.css"');
        assertIncludes(homeHtml, 'href="styles/dark.css"');
        assertIncludes(homeHtml, 'href="styles/forest.css"');
        assertIncludes(homeHtml, 'href="styles/paperLike.css"');
        assertIncludes(homeHtml, 'href="styles/neon.css"');
        assertIncludes(homeHtml, 'href="site/assets/home.css"');
    });

    test("offers every existing theme and reuses the original switcher", () => {
        for (const theme of SITE_CONFIG.themes) {
            assertIncludes(homeHtml, `data-theme="${theme.key}"`);
        }

        assertIncludes(
            homeHtml,
            '<script src="src/themeSwitcher.js"></script>'
        );
    });

    test("has the contributors button with the requested label", () => {
        assertIncludes(homeHtml, "آدم هایی که اینجا رو ساختن");
        assertIncludes(homeHtml, "آدم‌هایی که اینجا رو ساختن");
        assertIncludes(homeHtml, 'class="contributorsButton"');

        for (const contributor of SITE_CONFIG.contributors) {
            assertIncludes(homeHtml, contributor.name);
            assertIncludes(homeHtml, contributor.role);
        }
    });

    test("has a search box and a notes menu", () => {
        assertIncludes(homeHtml, 'class="siteSearchInput"');
        assertIncludes(homeHtml, 'id="notesMenuList"');
        assertIncludes(homeHtml, 'id="notesMenuEmpty"');
        assertIncludes(homeHtml, SITE_CONFIG.notesMenuTitle);
    });

    test("links every published note", () => {
        for (const note of buildResult.notes) {
            if (note.hidden) {
                continue;
            }

            assertIncludes(homeHtml, `href="notes/${note.slug}/"`);
            assertIncludes(homeHtml, `data-note-slug="${note.slug}"`);
        }
    });

    test("bakes a valid notes index into the document", () => {
        const match = homeHtml.match(
            /<script type="application\/json" id="notesIndex">([\s\S]*?)<\/script>/
        );

        assert(match, "notes index script tag must exist");

        const index = JSON.parse(match[1]);

        assertEqual(index.length, buildResult.notes.length);

        for (const entry of index) {
            assert(entry.title.length > 0);
            assert(entry.searchText.length > 0);
            assert(entry.url.endsWith("/"));
        }
    });

    test("escapes note text so markup cannot leak into the menu", async () => {
        const html = await renderHomePage([
            {
                ...buildResult.notes[0],
                title: '<img src=x onerror="alert(1)">',
                description: "<script>alert('xss')</script>"
            }
        ]);

        assertExcludes(html, "<script>alert");
        assertExcludes(html, "<img src=x");
        assertIncludes(html, "&lt;script&gt;");
    });
});

describe("browser behaviour (jsdom)", () => {
    test("the notes menu filters and highlights the query", async () => {
        const dom = await createPageDom(homePagePath, {
            url: "https://example.test/index.html",
            scripts: HOME_SCRIPTS
        });

        const { window } = dom;
        const { document } = window;

        const cards = Array.from(document.querySelectorAll(".noteCard"));

        assertEqual(cards.length, buildResult.notes.length);
        cards.forEach((card) => assertEqual(card.hidden, false));

        const input = document.querySelector(".siteSearchInput");

        input.value = "ایمنی";
        input.dispatchEvent(new window.Event("input"));

        const visible = cards.filter((card) => !card.hidden);

        assert(visible.length >= 1, "the query must match at least one note");
        assert(visible.length < cards.length, "unrelated notes must be hidden");

        assert(
            document.querySelectorAll(".noteCard mark").length > 0,
            "matching text must be highlighted"
        );

        assertIncludes(
            document.querySelector(".siteSearchStatus").textContent,
            "از"
        );

        input.value = "عبارتی که در هیچ جزوه‌ای نیست";
        input.dispatchEvent(new window.Event("input"));

        cards.forEach((card) => assertEqual(card.hidden, true));
        assertEqual(document.querySelector("#notesMenuEmpty").hidden, false);

        document.querySelector(".siteSearchClear").click();

        cards.forEach((card) => assertEqual(card.hidden, false));
        assertEqual(document.querySelectorAll(".noteCard mark").length, 0);

        dom.window.close();
    });

    test("search matches Persian digits and Arabic letter variants", async () => {
        const dom = await createPageDom(homePagePath, {
            url: "https://example.test/index.html",
            scripts: HOME_SCRIPTS
        });

        const { window } = dom;
        const { document } = window;

        const input = document.querySelector(".siteSearchInput");

        input.value = "أزمايشگاه";
        input.dispatchEvent(new window.Event("input"));

        const visible = Array.from(
            document.querySelectorAll(".noteCard")
        ).filter((card) => !card.hidden);

        assertEqual(visible.length, 1);

        input.value = "۲۰۲۶";
        input.dispatchEvent(new window.Event("input"));

        assert(
            Array.from(document.querySelectorAll(".noteCard")).some(
                (card) => !card.hidden
            ),
            "a Persian-digit query must still match"
        );

        dom.window.close();
    });

    test("clicking the contributors button opens the modal", async () => {
        const dom = await createPageDom(homePagePath, {
            url: "https://example.test/index.html",
            scripts: HOME_SCRIPTS
        });

        const { window } = dom;
        const { document } = window;

        const modal = document.querySelector(".siteContributorsModal");
        const button = document.querySelector(".contributorsButton");

        assertEqual(modal.getAttribute("aria-hidden"), "true");

        button.click();

        assert(modal.classList.contains("isOpen"));
        assertEqual(modal.getAttribute("aria-hidden"), "false");

        document.querySelector(".aboutCloseButton").click();

        assert(!modal.classList.contains("isOpen"));

        button.click();
        document.querySelector(".aboutModalBackdrop").click();

        assert(!modal.classList.contains("isOpen"));

        dom.window.close();
    });

    test("the original theme switcher drives the home page", async () => {
        const dom = await createPageDom(homePagePath, {
            url: "https://example.test/index.html",
            scripts: ["src/themeSwitcher.js"]
        });

        const { window } = dom;

        assertEqual(window.document.documentElement.dataset.theme, "light");

        window.document
            .querySelector('.themeButton[data-theme="forest"]')
            .click();

        assertEqual(window.document.documentElement.dataset.theme, "forest");
        assertEqual(window.localStorage.getItem("noteTheme"), "forest");

        dom.window.close();
    });

    test("a note page gets a working back-to-home link", async () => {
        const note = buildResult.notes[0];

        const dom = await createPageDom(
            path.join(notesDirectory, note.slug, "index.html"),
            {
                url: `https://example.test/notes/${note.slug}/`,
                scripts: ["site/assets/noteHomeLink.js"]
            }
        );

        const homeLink = dom.window.document.querySelector(".noteHomeLink");

        assert(homeLink, "the home link must be injected");
        assertEqual(homeLink.getAttribute("href"), "../../index.html");
        assertEqual(homeLink.parentElement.className, "headerControls");

        dom.window.close();
    });

    test("storage scoping isolates note data but keeps preferences global", async () => {
        const note = buildResult.notes[0];

        const dom = await createPageDom(
            path.join(notesDirectory, note.slug, "index.html"),
            {
                url: `https://example.test/notes/${note.slug}/`,
                scripts: ["site/assets/noteStorageScope.js"]
            }
        );

        const { localStorage } = dom.window;

        localStorage.setItem("stickyNotes", "[]");
        localStorage.setItem("noteScrollPosition", "1200");
        localStorage.setItem("noteTheme", "neon");

        assertEqual(localStorage.getItem("stickyNotes"), "[]");
        assertEqual(localStorage.getItem("noteScrollPosition"), "1200");
        assertEqual(localStorage.getItem("noteTheme"), "neon");

        assertEqual(
            localStorage.getItem(`note:${note.slug}:stickyNotes`),
            "[]"
        );

        assert(localStorage.getItem("noteTheme") !== null);
        assertEqual(localStorage.getItem("note:does-not-exist:stickyNotes"), null);

        dom.window.close();
    });
});

describe("note removal", () => {
    let registryBackup = null;

    before(async () => {
        registryBackup = await readFile(
            toAbsolute(SITE_CONFIG.registryFilePath),
            "utf8"
        );
    });

    after(async () => {
        // Undo every removal this group performed, then rebuild.
        const { removeNote } = await import("../removeNote.js");

        const registry = JSON.parse(registryBackup);

        for (const entry of registry.removed ?? []) {
            const slug = typeof entry === "string" ? entry : entry.slug;

            await removeNote({ slug, restore: true, build: false });
        }

        await writeFile(
            toAbsolute(SITE_CONFIG.registryFilePath),
            registryBackup,
            "utf8"
        );

        await buildSite({ quiet: true });

        buildResult = await buildSite({ quiet: true });
    });

    test("removing a note deletes its page and drops it from the home page", async () => {
        const { removeNote } = await import("../removeNote.js");

        const target = buildResult.notes.find(
            (note) => note.slug === "nervous-system"
        );

        assert(target);

        await removeNote({ slug: target.slug, build: true, quiet: true });

        buildResult = await buildSite({ quiet: true });

        const html = await readFile(homePagePath, "utf8");

        assertExcludes(html, `href="notes/${target.slug}/"`);
        assertExcludes(html, `data-note-slug="${target.slug}"`);
        assertEqual(await pathExists(path.join(notesDirectory, target.slug)), false);
    });

    test("a removed note never comes back, even though its source still exists", async () => {
        assertEqual(
            await pathExists(
                toAbsolute(
                    `${SITE_CONFIG.markdownNotesDirectoryName}/nervous-system.md`
                )
            ),
            true,
            "the source file must still be on disk"
        );

        const rebuilt = await buildSite({ quiet: true });

        assertEqual(
            rebuilt.notes.some((note) => note.slug === "nervous-system"),
            false,
            "the removed note must not be republished"
        );

        assert(
            rebuilt.issues.some((issue) => issue.type === "removed"),
            "the build must report the skip"
        );

        buildResult = rebuilt;

        const html = await readFile(homePagePath, "utf8");

        assertExcludes(html, 'data-note-slug="nervous-system"');
    });

    test("restoring a note brings its page and menu entry back", async () => {
        const { removeNote } = await import("../removeNote.js");

        await removeNote({ slug: "nervous-system", restore: true, build: false });

        const rebuilt = await buildSite({ quiet: true });

        assert(
            rebuilt.notes.some((note) => note.slug === "nervous-system"),
            "the restored note must be published again"
        );

        buildResult = rebuilt;

        const html = await readFile(homePagePath, "utf8");

        assertIncludes(html, 'data-note-slug="nervous-system"');
        assertEqual(
            await pathExists(path.join(notesDirectory, "nervous-system", "index.html")),
            true
        );
    });

    test("refuses to purge a source file outside the source directories", async () => {
        const { isPurgeable } = await import("../removeNote.js");

        assertEqual(
            isPurgeable("content/notes/a.md"),
            true
        );

        assertEqual(
            isPurgeable("content/pre-rendered/a.html"),
            true
        );

        assertEqual(
            isPurgeable("output/index.html"),
            true
        );

        assertEqual(isPurgeable("data/input/note.md"), false);
        assertEqual(isPurgeable("src/main.js"), false);
        assertEqual(isPurgeable("notes/a/index.html"), false);
        assertEqual(isPurgeable("content/notes/../../etc/passwd"), false);
    });
});

describe("original renderer CLI → site", () => {
    let originalMarkdown = null;

    before(async () => {
        originalMarkdown = await readFile(
            toAbsolute("data/input/note.md"),
            "utf8"
        );
    });

    after(async () => {
        if (originalMarkdown !== null) {
            await writeFile(
                toAbsolute("data/input/note.md"),
                originalMarkdown,
                "utf8"
            );

            originalMarkdown = null;
        }

        await rm(toAbsolute("output/index.html"), { force: true });

        await buildSite({ quiet: true });
    });

    test("`--render` runs the original CLI and publishes what it wrote", async () => {
        const markdownPath = toAbsolute("data/input/note.md");

        try {
            await writeFile(
                markdownPath,
                `# یادداشت تست جریان رندر

**درس:** تست
**مبحث:** از ماژول اصلی تا سایت

## ۱. مقدمه و کلیات

متن آزمایشی برای بررسی زنجیرهٔ رندر.

## ۲. متن اصلی جزوه

فرمول $a^2+b^2=c^2$ و یک جدول:

| مرحله | وضعیت |
|---|---|
| رندر | انجام شد |
`,
                "utf8"
            );

            await rm(toAbsolute("output/index.html"), { force: true });

            const result = await buildSite({
                quiet: true,
                renderFirst: true
            });

            // 1. the original CLI really ran and wrote its file
            assertEqual(
                await pathExists(toAbsolute("output/index.html")),
                true,
                "`node src/main.js` must have written output/index.html"
            );

            // 2. the build imported it
            const note = result.notes.find(
                (entry) => entry.source.file === "output/index.html"
            );

            assert(note, "the rendered file must be published");
            assertEqual(note.source.kind, "rendered");
            assertEqual(note.title, "یادداشت تست جریان رندر");
            assertEqual(note.slug, SITE_CONFIG.rendererOutputDefaultSlug);

            // 3. the page is a complete, correctly-anchored note
            const html = await readFile(
                path.join(notesDirectory, note.slug, "index.html"),
                "utf8"
            );

            assertIncludes(html, 'href="../../styles/base.css"');
            assertIncludes(html, "katex");
            assertIncludes(html, `data-note-scope="${note.slug}"`);

            // 4. and it is on the home page
            const home = await readFile(homePagePath, "utf8");

            assertIncludes(home, `href="notes/${note.slug}/"`);
        } finally {
            await writeFile(markdownPath, originalMarkdown, "utf8");

            originalMarkdown = await readFile(markdownPath, "utf8");
        }
    });

    test("re-rendering the same note is recognised as a duplicate", async () => {
        const result = await buildSite({ quiet: true, renderFirst: true });

        const fromRendererOutput = result.notes.filter(
            (note) => note.source.file === "output/index.html"
        );

        assertEqual(
            fromRendererOutput.length,
            0,
            "byte-identical content must not be published twice"
        );

        assert(
            result.issues.some((issue) => issue.type === "duplicate-content"),
            "the build must report the duplicate"
        );
    });
});

describe("white flash on load", () => {
    test("themeBoot.js runs before the first stylesheet, on the home page", () => {
        const head = homeHtml.slice(0, homeHtml.indexOf("</head>"));

        const bootIndex = head.indexOf("site/assets/themeBoot.js");
        const firstStyleIndex = head.indexOf('rel="stylesheet"');

        assert(bootIndex !== -1, "the home page must load themeBoot.js");
        assert(firstStyleIndex !== -1);
        assert(
            bootIndex < firstStyleIndex,
            "themeBoot.js must come before any stylesheet"
        );
    });

    test("themeBoot.js runs before the first stylesheet, on every note", async () => {
        for (const note of buildResult.notes) {
            const html = await readNotePage(note.slug);
            const head = html.slice(0, html.indexOf("</head>"));

            const bootIndex = head.indexOf(
                `../../${SITE_CONFIG.noteAssetDirectoryName}/${SITE_CONFIG.noteThemeBootScriptFileName}`
            );
            const firstStyleIndex = head.indexOf('rel="stylesheet"');

            assert(bootIndex !== -1, `${note.slug} must load themeBoot.js`);
            assert(
                bootIndex < firstStyleIndex,
                `${note.slug}: themeBoot.js must precede the stylesheets`
            );
        }
    });

    test("themeBoot.js applies the stored theme before the first paint", async () => {
        const source = await readAsset("site/assets/themeBoot.js");

        for (const theme of SITE_CONFIG.themes.map((entry) => entry.key)) {
            const dom = new JSDOM(
                '<!DOCTYPE html><html data-theme="light"><head></head><body></body></html>',
                { runScripts: "outside-only", url: "https://example.test/" }
            );

            dom.window.localStorage.setItem("noteTheme", theme);
            dom.window.eval(source);

            assertEqual(
                dom.window.document.documentElement.dataset.theme,
                theme,
                `stored theme "${theme}" must be applied`
            );

            dom.window.close();
        }
    });

    test("themeBoot.js keeps the default for unknown or missing values", async () => {
        const source = await readAsset("site/assets/themeBoot.js");

        const cases = [null, "", "not-a-theme", "../etc/passwd"];

        for (const storedValue of cases) {
            const dom = new JSDOM(
                '<!DOCTYPE html><html data-theme="forest"><head></head><body></body></html>',
                { runScripts: "outside-only", url: "https://example.test/" }
            );

            if (storedValue !== null) {
                dom.window.localStorage.setItem("noteTheme", storedValue);
            }

            dom.window.eval(source);

            assertEqual(
                dom.window.document.documentElement.dataset.theme,
                "forest",
                `stored value ${JSON.stringify(storedValue)} must be ignored`
            );

            dom.window.close();
        }
    });

    test("themeBoot.js survives storage being unavailable", async () => {
        const source = await readAsset("site/assets/themeBoot.js");

        const dom = new JSDOM(
            '<!DOCTYPE html><html data-theme="neon"><head></head><body></body></html>',
            { runScripts: "outside-only", url: "https://example.test/" }
        );

        Object.defineProperty(dom.window, "localStorage", {
            configurable: true,
            get() {
                throw new Error("storage disabled");
            }
        });

        dom.window.eval(source);

        assertEqual(
            dom.window.document.documentElement.dataset.theme,
            "neon"
        );

        dom.window.close();
    });
});

describe("theme menu sizing", () => {
    test("the popover is pinned to its natural width", async () => {
        const style = await readAsset("site/assets/home.css");

        // base.css anchors .themeOptions with `left: 50%`, which leaves only half
        // of the narrow switcher as shrink-to-fit space; some engines clamp the
        // box to it and squeeze the buttons.
        assertIncludes(style, ".themeOptions {");
        assertIncludes(style, "width: max-content");
        assertIncludes(style, "max-width: calc(100vw - 24px)");
        assertIncludes(style, ".themeOptions .themeButton");
        assertIncludes(style, "flex: 0 0 auto");
    });
});

describe("local server link check", () => {
    test("every published page, script, stylesheet and font resolves", async () => {
        const result = await runLinkCheck({ port: 0 });

        assertEqual(
            result.failures.length,
            0,
            JSON.stringify(result.failures, null, 2)
        );

        assert(result.htmlFiles >= 4, "expected the home page and every note");
        assert(result.styleSheetFiles >= 8);
        assert(result.checkedReferences > 100);
    });

    test("refuses to serve files outside the project root", async () => {
        const { createSiteServer } = await import("../serve.js");

        const server = createSiteServer({ logMissing: false });

        await new Promise((resolve) => server.listen(0, resolve));

        const { port } = server.address();

        const response = await fetch(
            `http://127.0.0.1:${port}/../../etc/passwd`
        );

        assert(
            response.status === 400 || response.status === 404,
            `expected a rejection, got ${response.status}`
        );

        await new Promise((resolve) => server.close(resolve));
    });
});