// Runs sample Markdown through the renderer, then checks the pieces the
// published site depends on: note identity, the note document, the navigation
// controls and the home page. Run with `npm test`.

import { readdir, readFile } from "node:fs/promises";
import { renderMarkdown } from "../src/renderer.js";
import { createNoteNavigation, renderNoteHtml } from "../src/main.js";
import { resolveTemplateIncludes } from "../src/templateIncludes.js";
import {
    claimNoteSlug,
    createNoteSlug,
    extractMetadata,
    extractNoteTitle,
    normalizeThemeName,
    resolveNoteSlug
} from "../src/noteIdentity.js";
import {
    mapProjectPath,
    renderHomePage,
    rewriteAssetReferences
} from "../scripts/siteLib.mjs";

const testDirectory = "./tests/sample_notes";

const rendererConfig = {
    theme: "light",
    language: "fa",
    enableMath: true
};

const expectedContent = {
    "basic.md": ["<h1>", "<ul>", "<blockquote>"],
    "callouts.md": [
        "calloutBox calloutBox--tip",
        "calloutBox calloutBox--warning",
        'class="definitionBox"'
    ],
    "code.md": ["<pre>", "language-python"],
    "image.md": ["<img"],
    "math.md": ["katex", "katex-display"],
    "rtl.md": ["سیستم عصبی", "Central Nervous System"],
    "table.md": ["<table>", "<th>", "<td>"],
    // Sanitization: the prose survives, the payloads do not.
    "security.md": [
        "این متن باید باقی بماند",
        "Dangerous Link"
    ]
};

const forbiddenContent = {
    "security.md": [
        "<script>alert",
        "onerror=",
        'href="javascript:'
    ]
};

let passedTests = 0;

function pass(label) {
    console.log(`✓ ${label}`);
    passedTests++;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Test failed: ${message}`);
    }
}

console.log("Running renderer tests...\n");

/* =========================================================
   Markdown -> HTML
   ========================================================= */

const testFiles = (await readdir(testDirectory))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort();

for (const fileName of testFiles) {
    const markdownContent = await readFile(
        `${testDirectory}/${fileName}`,
        "utf8"
    );

    const htmlContent = renderMarkdown(
        markdownContent,
        rendererConfig
    );

    assert(
        htmlContent.trim() !== "",
        `${fileName} produced empty HTML.`
    );

    for (const expectedValue of expectedContent[fileName] ?? []) {
        assert(
            htmlContent.includes(expectedValue),
            `${fileName} is missing "${expectedValue}".`
        );
    }

    for (const forbidden of forbiddenContent[fileName] ?? []) {
        assert(
            !htmlContent.includes(forbidden),
            `${fileName} should not contain "${forbidden}".`
        );
    }

    pass(fileName);
}

const mathContent = await readFile(
    `${testDirectory}/math.md`,
    "utf8"
);

const mathDisabledHtml = renderMarkdown(
    mathContent,
    {
        ...rendererConfig,
        enableMath: false
    }
);

assert(
    !mathDisabledHtml.includes("katex") &&
        !mathDisabledHtml.includes("katex-display"),
    "Math should not be rendered when enableMath is false."
);

pass("math disabled");

/* =========================================================
   Note identity
   ========================================================= */

const metadataSource = [
    "# عنوان نمونه",
    "",
    "**درس:** درس آزمایشی",
    "**مبحث:** مبحث آزمایشی",
    "**استاد:** دکتر آزمایشی",
    "**تاریخ جلسه:** 1405/01/01",
    "**تاریخ تولید جزوه:** 2026-01-01T00:00:00",
    "",
    "## ۱. مقدمه",
    "",
    "### یک زیرعنوان",
    "",
    "متن.",
    ""
].join("\n");

const metadata = extractMetadata(metadataSource);

assert(
    metadata.courseName === "درس آزمایشی" &&
        metadata.topic === "مبحث آزمایشی" &&
        metadata.instructor === "دکتر آزمایشی" &&
        metadata.sessionDate === "1405/01/01",
    `metadata was not parsed as expected: ${JSON.stringify(metadata)}`
);

assert(
    extractNoteTitle(metadataSource) === "عنوان نمونه",
    "note title was not read from the H1"
);

pass("metadata extraction");

assert(
    createNoteSlug("مثال‌های کلیدی") === "مثالهای-کلیدی",
    "a Persian title should keep its letters and lose its punctuation"
);

assert(
    createNoteSlug("Security Test!") === "security-test",
    "a Latin title should slugify to ASCII"
);

assert(
    resolveNoteSlug({ title: "عنوان", metadata: { slug: "explicit-slug" } }) ===
        "explicit-slug",
    "an explicit نامک should win over the derived slug"
);

pass("slug generation");

const takenSlugs = new Map();

assert(
    claimNoteSlug("نوت", takenSlugs, "a") === "نوت" &&
        claimNoteSlug("نوت", takenSlugs, "b") === "نوت-2" &&
        claimNoteSlug("نوت", takenSlugs, "c") === "نوت-3",
    "duplicate slugs should be disambiguated, not overwritten"
);

assert(
    normalizeThemeName("paperlike") === "paperLike",
    "a wrong-case theme name should be corrected to a defined theme"
);

assert(
    normalizeThemeName("does-not-exist") === "light",
    "an unknown theme should fall back to light"
);

pass("slug uniqueness and theme names");

/* =========================================================
   The note document
   ========================================================= */

// The CLI expands `{{>partial}}` includes before rendering; renderNoteHtml
// receives a finished template and refuses one that still has holes in it.
const noteTemplate = await resolveTemplateIncludes(
    await readFile("./templates/note.html", "utf8")
);

const noteHtml = renderNoteHtml(metadataSource, {
    template: noteTemplate,
    rendererConfig,
    assetPrefix: "../../",
    noteSlug: "note-azmayeshi",
    noteNavigation: createNoteNavigation({
        homeHref: "../../",
        previous: { title: "قبلی", href: "../gabli/" },
        next: null
    })
});

assert(
    !/\{\{\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/.test(noteHtml),
    "the rendered note still contains an unresolved template placeholder"
);

assert(
    noteHtml.includes('data-note-slug="note-azmayeshi"'),
    "the note should carry its slug on <body> for per-note storage"
);

for (const expectedAsset of [
    "../../styles/base.css",
    "../../src/noteStorage.js",
    "../../node_modules/katex/dist/katex.min.css",
    "../../data/assets/favicon.svg"
]) {
    assert(
        noteHtml.includes(expectedAsset),
        `the note should reference ${expectedAsset}`
    );
}

assert(
    noteHtml.includes('data-theme="light"'),
    "the note should open in a theme the stylesheets define"
);

assert(
    noteHtml.includes("noteNavLink") &&
        noteHtml.includes('href="../gabli/"') &&
        noteHtml.includes("disabled"),
    "navigation should link home and the previous note, and disable 'next' at the end of the library"
);

assert(
    noteHtml.includes('href="#heading-1"'),
    "the table of contents should link to generated heading ids"
);

assert(
    noteHtml.includes("<h2 id=\"heading-1\">"),
    "headings should receive stable ids"
);

assert(
    noteHtml.includes("tocSubItem"),
    "h3 entries in the table of contents should use the styled sub-item class"
);

pass("note document");

/* =========================================================
   Template composition
   ========================================================= */

const rawNoteTemplate = await readFile(
    "./templates/note.html",
    "utf8"
);

let unexpandedIncludeRejected = false;

try {
    renderNoteHtml("# عنوان\n", {
        template: rawNoteTemplate,
        rendererConfig,
        noteSlug: "includes"
    });
} catch (error) {
    unexpandedIncludeRejected = error.message.includes("{{>about");
}

assert(
    unexpandedIncludeRejected,
    "a template that still contains an unexpanded include must be rejected"
);

let unknownIncludeRejected = false;

try {
    await resolveTemplateIncludes("{{>noSuchPartial}}");
} catch (error) {
    unknownIncludeRejected = error.message.includes("noSuchPartial");
}

assert(
    unknownIncludeRejected,
    "an unknown partial must be reported by name"
);

pass("template includes");

// The About dialog is shared markup, so both pages must carry it identically.
const homeTemplateForAbout = await resolveTemplateIncludes(
    await readFile("./templates/home.html", "utf8")
);

const aboutModalPattern =
    /<div\s+class="aboutModal"[\s\S]*?<\/section>/;

const aboutInNote = noteHtml.match(aboutModalPattern)?.[0] ?? null;
const aboutInHome = homeTemplateForAbout.match(aboutModalPattern)?.[0] ?? null;

assert(
    aboutInNote !== null &&
        aboutInHome !== null &&
        aboutInNote === aboutInHome,
    "the About dialog must be identical on the note page and the home page"
);

assert(
    aboutInHome.includes("آدم‌هایی که اینجا رو ساختن") &&
        (aboutInHome.match(/developerCard/g) ?? []).length === 4,
    "the About dialog should list the four people who built this"
);

assert(
    /class="aboutButton"/.test(homeTemplateForAbout),
    "the home page should carry the About button in its header"
);

assert(
    homeTemplateForAbout.includes("src/aboutModal.js"),
    "the home page should load the script that opens the About dialog"
);

pass("about dialog is shared by both pages");

// The search filter hides cards with the `hidden` attribute, but the card rule
// sets an author-level `display`, which beats the user agent's
// `[hidden] { display: none }`. Without this rule a filtered-out card stays on
// screen while the count claims it is gone.
const homeStyles = await readFile(
    "./styles/home.css",
    "utf8"
);

assert(
    /\.noteCard\[hidden\]\s*\{[^}]*display:\s*none/.test(homeStyles),
    "filtered-out cards must be hidden explicitly, not just marked hidden"
);

assert(
    /\.noteMatch\s*\{/.test(homeStyles),
    "search hits need a visible highlight style"
);

pass("library search styles");

// $& and $' are backreference syntax for String.replace: when note content is
// substituted with a plain string they expand into the matched placeholder,
// which would paste a literal {{mainContent}} into the middle of a paragraph.
const dollarEscaped = renderNoteHtml(
    "# قیمت\n\n<p>قیمت $& و $' در آن.</p>\n",
    {
        template: noteTemplate,
        rendererConfig: {
            ...rendererConfig,
            enableMath: false
        },
        noteSlug: "dollar"
    }
);

assert(
    dollarEscaped.includes("$&amp;") &&
        dollarEscaped.includes("$'") &&
        !/\{\{\s*mainContent\s*\}\}/.test(dollarEscaped),
    "note content containing $ sequences must survive substitution intact"
);

pass("substitution is literal");

const metadataEscaped = renderNoteHtml(
    "# عنوان\n\n**درس:** <script>alert(1)</script>\n",
    {
        template: noteTemplate,
        rendererConfig,
        noteSlug: "escape"
    }
);

assert(
    !metadataEscaped.includes("<script>alert(1)</script>") &&
        metadataEscaped.includes("&lt;script&gt;"),
    "metadata must be escaped before it reaches the template"
);

pass("metadata is escaped");

assert(
    renderNoteHtml("# عنوان\n", {
        template: noteTemplate,
        rendererConfig: { ...rendererConfig, theme: "PaperLike" },
        noteSlug: "theme"
    }).includes('data-theme="paperLike"'),
    "a wrong-case theme should be normalised at render time"
);

pass("theme normalisation");

let assetPrefixReachesImages = false;

for (const fileName of testFiles) {
    const html = renderMarkdown(
        await readFile(`${testDirectory}/${fileName}`, "utf8"),
        rendererConfig,
        { assetPrefix: "../../" }
    );

    if (html.includes("../../data/assets/")) {
        assetPrefixReachesImages = true;
    }
}

assert(
    assetPrefixReachesImages,
    "image paths should honour the asset prefix the note was rendered with"
);

pass("image paths follow the asset prefix");

/* =========================================================
   The published site
   ========================================================= */

assert(
    mapProjectPath("src/search.js") === "js/search.js" &&
        mapProjectPath("data/assets/image1.png") === "assets/image1.png" &&
        mapProjectPath("node_modules/katex/dist/katex.min.css") ===
            "vendor/katex/katex.min.css" &&
        mapProjectPath("styles/base.css") === "styles/base.css",
    "project paths should map onto their published locations"
);

const publishedNote = rewriteAssetReferences(
    noteHtml,
    "renderedNotes/note-azmayeshi/index.html"
);

assert(
    publishedNote.includes("../../styles/base.css") &&
        publishedNote.includes("../../js/noteStorage.js") &&
        publishedNote.includes("../../vendor/katex/katex.min.css") &&
        publishedNote.includes("../../assets/favicon.svg"),
    "a note two levels down should still reach shared assets at the site root"
);

assert(
    publishedNote.includes('href="../../"') &&
        publishedNote.includes('href="../gabli/"'),
    "the link back to the library and to a sibling note should keep their shape"
);

const homeTemplate = await readFile(
    "./templates/home.html",
    "utf8"
);

const homeHtml = rewriteAssetReferences(
    renderHomePage({
        template: homeTemplate,
        notes: [
            {
                slug: "یک-یادداشت",
                title: "یادداشت اول",
                course: "درس اول",
                topic: "مبحث اول",
                instructor: "",
                generated: "2026-01-01T00:00:00"
            },
            {
                slug: "note-two",
                title: "Note Two",
                course: "",
                topic: "",
                instructor: "",
                generated: ""
            }
        ]
    }),
    "index.html"
);

assert(
    !/\{\{\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/.test(homeHtml),
    "the home page still contains an unresolved template placeholder"
);

assert(
    homeHtml.includes("./renderedNotes/") &&
        homeHtml.includes(encodeURIComponent("یک-یادداشت")) &&
        homeHtml.includes("./renderedNotes/note-two/"),
    "the home page should link to every note, percent-encoding non-ASCII slugs"
);

assert(
    homeHtml.includes('href="styles/base.css"') &&
        homeHtml.includes('src="js/noteLibrary.js"') &&
        homeHtml.includes('src="vendor/lucide.min.js"'),
    "the home page at the site root should reference shared assets without walking up"
);

assert(
    !homeHtml.includes("searchPanel") && !homeHtml.includes("noteContainer"),
    "the home page must not load note-only chrome it has no markup for"
);

pass("site assembly");

console.log(`\n${passedTests} tests passed.`);
