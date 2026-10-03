// Runs sample Markdown through the renderer, then checks the pieces the
// published site depends on: note identity, the note document, the navigation
// controls and the home page. Run with `npm test`.

import {
    cp,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMarkdown } from "../src/renderer.js";
import {
    adoptImportedAssetReferences,
    adoptImportedNote,
    createNoteNavigation,
    renderAllNotes,
    renderNoteHtml
} from "../src/main.js";
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
    // Every way of writing an image must land in the same place, so no
    // duplicate copy of the asset library is needed.
    "image-paths.md": ["../data/assets/image1.jpg"],
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
    ],
    // An absolute path would escape the note's own folder on the published site.
    "root-image.md": ['src="/absolute/path.png"', "javascript:alert"],
    // Persian prose around a stray `$` must not be handed to KaTeX.
    "math-unclosed.md": ["katex"]
};

/** Fixtures whose Markdown is legitimately empty. */
const expectedEmpty = new Set(["empty.md"]);

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

// The CLI expands `{{>partial}}` includes before rendering; renderNoteHtml
// receives a finished template and refuses one that still has holes in it.
const noteTemplate = await resolveTemplateIncludes(
    await readFile("./templates/note.html", "utf8")
);

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
        expectedEmpty.has(fileName)
            ? htmlContent.trim() === ""
            : htmlContent.trim() !== "",
        expectedEmpty.has(fileName)
            ? `${fileName} should render to nothing, but produced HTML.`
            : `${fileName} produced empty HTML.`
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
   Every fixture as a whole document

   The fragment tests above prove the Markdown pipeline. These prove that
   each fixture also survives being put through the real template: no
   unresolved placeholder, a note id for per-note storage, and asset
   references that stay inside the note's own folder.
   ========================================================= */

let documented = 0;

for (const fileName of testFiles) {
    const markdownContent = await readFile(
        `${testDirectory}/${fileName}`,
        "utf8"
    );

    let documentHtml;

    try {
        documentHtml = renderNoteHtml(markdownContent, {
            template: noteTemplate,
            rendererConfig,
            assetPrefix: "../../",
            noteSlug: createNoteSlug(fileName)
        });
    } catch (error) {
        // An empty note has no title to work with; it must still be reported
        // rather than crashing the build, so that is asserted separately below.
        if (fileName !== "empty.md") {
            throw error;
        }
        continue;
    }

    assert(
        !/\{\{\s*>?\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/.test(documentHtml),
        `${fileName}: the rendered note has an unresolved placeholder`
    );

    assert(
        documentHtml.includes('class="noteContainer"'),
        `${fileName}: the rendered note has no content container`
    );

    assert(
        documentHtml.includes('<body data-note-slug="'),
        `${fileName}: the rendered note carries no note id`
    );

    assert(
        documentHtml.includes('data-theme="light"'),
        `${fileName}: the rendered note has no resolved theme`
    );

    // Every project-asset reference must walk up exactly two levels, or it
    // escapes the published note folder.
    for (const match of documentHtml.matchAll(
        /(?:href|src)="(\.\.\/[^"]*)"/g
    )) {
        assert(
            !match[1].startsWith("../../../"),
            `${fileName}: asset reference "${match[1]}" climbs out of the note folder`
        );
    }

    documented++;
}

pass(`${documented} fixtures rendered as whole documents`);

/* =========================================================
   Edge cases the fixtures exist for
   ========================================================= */

const emptyDocument = renderNoteHtml("", {
    template: noteTemplate,
    rendererConfig,
    noteSlug: "empty"
});

assert(
    emptyDocument.includes("<title>") &&
        emptyDocument.includes('class="noteContainer"'),
    "an empty note must still produce a valid page"
);

pass("empty note still produces a page");

const bomTitle = extractNoteTitle(
    await readFile(`${testDirectory}/bom.md`, "utf8")
);

assert(
    bomTitle === "عنوان با BOM",
    `a byte order mark must not hide the title, got "${bomTitle}"`
);

pass("byte order mark before the title");

const emojiSlug = createNoteSlug(
    extractNoteTitle(
        await readFile(`${testDirectory}/emoji-title.md`, "utf8")
    )
);

assert(
    emojiSlug === "" || /^[\p{L}\p{N}-]+$/u.test(emojiSlug),
    `an emoji-only title must not produce a slug full of symbols, got "${emojiSlug}"`
);

pass("emoji-only title");

const traversal = resolveNoteSlug({
    title: "x",
    metadata: { slug: "../../etc/passwd" }
});

assert(
    !traversal.includes("/") && !traversal.includes("..") && traversal !== "",
    `a traversal attempt must be neutralised, got "${traversal}"`
);

pass("slug traversal is neutralised");

const manySectionNote = await readFile(
    `${testDirectory}/many-sections.md`,
    "utf8"
);

const manySectionsDocument = renderNoteHtml(manySectionNote, {
    template: noteTemplate,
    rendererConfig,
    noteSlug: "many-sections"
});

// Twelve H2s into ten placeholders: the extra two must be kept somewhere.
assert(
    (manySectionsDocument.match(/بخش آزمایشی 1[12]/g) ?? []).length >= 2,
    "sections beyond the ten template slots must not be dropped"
);

assert(
    (manySectionsDocument.match(/id="heading-\d+"/g) ?? []).length >= 12,
    "every heading should receive an id"
);

pass("more sections than template slots");

const headingsNote = await readFile(
    `${testDirectory}/headings-html.md`,
    "utf8"
);

const headingsDocument = renderNoteHtml(headingsNote, {
    template: noteTemplate,
    rendererConfig,
    noteSlug: "headings-html"
});

assert(
    headingsDocument.includes('<h2 id="heading-1">') &&
        headingsDocument.includes("پرانتز"),
    "headings with inline markup should keep their content"
);

assert(
    !/href="#\s/.test(headingsDocument),
    "a heading id must never contain whitespace"
);

pass("headings with inline markup");

const metadataDocument = renderNoteHtml(
    await readFile(`${testDirectory}/metadata-html.md`, "utf8"),
    {
        template: noteTemplate,
        rendererConfig,
        noteSlug: "meta-html"
    }
);

// Metadata is injected into a meta attribute and into a visible span, so both
// have to escape quotes as well as angle brackets. (The template's own inline
// <script> blocks are legitimate, so only the injection points are checked.)
assert(
    metadataDocument.includes(
        'content="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"'
    ),
    "the note-* meta tag must carry escaped metadata"
);

assert(
    metadataDocument.includes(
        '<span class="metadataValue">&lt;script&gt;'
    ),
    "the visible metadata value must be escaped"
);

assert(
    !/<span class="metadataValue"><(script|img|svg)/i.test(
        metadataDocument
    ),
    "a metadata value must never open a tag"
);

assert(
    !/content=""[^>]*onload/i.test(metadataDocument),
    "a metadata value must never close its attribute early"
);

assert(
    metadataDocument.includes("&lt;script&gt;"),
    "metadata should be shown escaped rather than silently dropped"
);

pass("hostile metadata is escaped, not dropped");

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

const imagePathVariants = renderMarkdown(
    await readFile(
        `${testDirectory}/image-paths.md`,
        "utf8"
    ),
    rendererConfig
);

const resolvedImagePaths = [
    ...imagePathVariants.matchAll(/src="([^"]*)"/g)
].map((match) => match[1]);

assert(
    resolvedImagePaths.length === 3 &&
        new Set(resolvedImagePaths).size === 1,
    "image1.jpg, assets/image1.jpg and data/assets/image1.jpg must all " +
        `resolve to one file, got ${JSON.stringify(resolvedImagePaths)}`
);

pass("image path spellings agree");

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


/* =========================================================
   Importing a pre-rendered note

   The import path patches a document it did not produce, anchored to specific
   markup. These exercise it directly, and then end to end on real files.
   ========================================================= */

const importedNoteHtml = [
    "<!DOCTYPE html>",
    '<html lang="fa" dir="rtl" data-theme="paperlike">',
    "",
    "<head>",
    '    <meta charset="UTF-8">',
    "    <title>یادداشت واردشده</title>",
    '    <link rel="stylesheet" href="../styles/base.css">',
    '    <script src="../node_modules/lucide/dist/umd/lucide.js"></script>',
    "</head>",
    "",
    "<body>",
    "",
    '    <header class="appHeader">',
    '        <button class="sidebarToggle" type="button"><i data-lucide="panel-left"></i></button>',
    '        <div class="appTitle"></div>',
    '        <div class="headerControls">',
    '            <button class="searchButton" type="button"><i data-lucide="search"></i></button>',
    "        </div>",
    "    </header>",
    "",
    '    <main class="noteContainer">',
    '        <section class="noteSection mainSection">',
    '            <img src="../data/assets/assets/figure1.jpg" alt="شکل">',
    '            <img src="../data/assets/assets/figure2.jpg" alt="شکل">',
    "        </section>",
    "    </main>",
    "",
    '    <script src="../src/themeSwitcher.js"></script>',
    "",
    "</body>",
    "",
    "</html>",
    ""
].join("\n");

const importIdentity = {
    slug: "imported-note",
    title: "یادداشت واردشده",
    metadata: {
        courseName: "",
        topic: "",
        instructor: "",
        sessionDate: "",
        generatedDate: ""
    }
};

const importNavigation = createNoteNavigation({
    homeHref: "../../",
    previous: null,
    next: null
});

const adopted = adoptImportedNote(importedNoteHtml, {
    identity: importIdentity,
    navigation: importNavigation
});

const countOf = (text, pattern) =>
    (text.match(pattern) ?? []).length;

// The patch that injects the icon and note metadata is anchored on </head>.
// That pattern has no capture group, so reading the replacer's *second*
// argument yields the match offset rather than the match — which silently
// swallowed the closing tag on every imported note.
assert(
    countOf(adopted, /<head>/g) === 1 &&
        countOf(adopted, /<\/head>/g) === 1,
    "adoption must leave the head element closed"
);

assert(
    countOf(adopted, /<body/g) === 1 &&
        countOf(adopted, /<\/body>/g) === 1,
    "adoption must not disturb the body element"
);

assert(
    countOf(adopted, /data-note-slug/g) === 1,
    "adoption must add exactly one note id"
);

assert(
    countOf(adopted, /noteStorage\.js/g) === 1,
    "adoption must load the per-note storage helper exactly once"
);

assert(
    adopted.includes('data-theme="paperLike"'),
    "a wrong-case theme must be corrected during adoption"
);

assert(
    adopted.includes("فهرست جزوه‌ها"),
    "adoption must give an imported note the library navigation"
);

assert(
    /<div class="appTitle">\s*یادداشت واردشده/.test(adopted),
    "an imported note with a blank header title must be given the note title"
);

pass("pre-rendered note adoption");

// Re-importing a page this project already published must not stack a second
// copy of our markup on top of the first.
assert(
    adoptImportedNote(adopted, {
        identity: importIdentity,
        navigation: importNavigation
    }) === adopted,
    "adoption must be idempotent: importing a published page again changes nothing"
);

pass("adoption is idempotent");

// A note that owns an image keeps it; one it borrows is left pointing at the
// shared library and reported, because a shared name may be another picture.
const owned = adoptImportedAssetReferences(
    importedNoteHtml,
    ["figure1.jpg"]
);

assert(
    owned.html.includes('src="assets/figure1.jpg"'),
    "an asset the note owns must be repointed at the note's own folder"
);

assert(
    owned.html.includes(
        'src="../data/assets/assets/figure2.jpg"'
    ),
    "an asset the note does not own must be left alone"
);

assert(
    owned.sharedReferences.length === 1 &&
        owned.sharedReferences[0] === "assets/figure2.jpg",
    `borrowed assets must be reported, got ${JSON.stringify(owned.sharedReferences)}`
);

pass("note-owned versus shared assets");

/* =========================================================
   The import pipeline, end to end

   Real files in a throwaway project, because the rules that matter here —
   which files are discovered, where their assets come from, what happens to a
   folder nobody claims — only exist on disk.
   ========================================================= */

/**
 * Run the renderer without its progress chatter, so a passing run reads as a
 * list of checks rather than a log.
 */
async function quietly(run) {
    const { log, warn } = console;

    console.log = () => {};
    console.warn = () => {};

    try {
        return await run();
    } finally {
        console.log = log;
        console.warn = warn;
    }
}

async function withTemporaryProject(setup, run) {
    const originalDirectory = process.cwd();
    const directory = await mkdtemp(
        join(tmpdir(), "note-renderer-")
    );

    try {
        await cp("templates", join(directory, "templates"), {
            recursive: true
        });
        await cp("config", join(directory, "config"), {
            recursive: true
        });
        await mkdir(join(directory, "data", "input"), {
            recursive: true
        });
        await mkdir(join(directory, "data", "imported"), {
            recursive: true
        });

        await setup(join(directory, "data", "imported"));
        process.chdir(directory);

        return await run(directory);
    } finally {
        process.chdir(originalDirectory);
        await rm(directory, {
            recursive: true,
            force: true
        });
    }
}

const pipeline = await withTemporaryProject(
    async (imported) => {
        // An extension that is not lowercase, as Windows saves it.
        await writeFile(
            join(imported, "Shouty.HTML"),
            importedNoteHtml,
            "utf8"
        );

        // A note inside a folder of its own, owning one of its two images.
        await mkdir(join(imported, "foldered", "assets"), {
            recursive: true
        });
        await writeFile(
            join(imported, "foldered", "note.html"),
            importedNoteHtml,
            "utf8"
        );
        await writeFile(
            join(imported, "foldered", "assets", "figure1.jpg"),
            "not really a jpeg",
            "utf8"
        );

        // Two notes whose names would fight over one folder.
        await writeFile(
            join(imported, "Same Name.html"),
            importedNoteHtml,
            "utf8"
        );
        await writeFile(
            join(imported, "same-name.html"),
            importedNoteHtml,
            "utf8"
        );

        // One file that cannot be adopted at all.
        await writeFile(
            join(imported, "broken.html"),
            "<p>not a note</p>",
            "utf8"
        );
    },
    async (directory) => {
        let failure = null;

        try {
            await quietly(() => renderAllNotes());
        } catch (error) {
            failure = error;
        }

        const notes = JSON.parse(
            await readFile(
                join(
                    directory,
                    "renderedNotes",
                    "notes.json"
                ),
                "utf8"
            )
        ).notes;

        // Read everything here: the temporary project is torn down before the
        // assertions below run.
        const rendered = {};

        for (const note of notes) {
            rendered[note.slug] = {
                html: await readFile(
                    join(
                        directory,
                        "renderedNotes",
                        note.slug,
                        "index.html"
                    ),
                    "utf8"
                ),
                assets: await readdir(
                    join(
                        directory,
                        "renderedNotes",
                        note.slug,
                        "assets"
                    )
                ).catch(() => []),
                note
            };
        }

        return { failure, notes, rendered };
    }
);

// One unusable file must not cost the operator the rest of the library.
assert(
    pipeline.failure !== null,
    "an unusable import must be reported, not swallowed"
);

assert(
    pipeline.failure?.message.includes("broken.html"),
    `the failure must name the file, got: ${pipeline.failure?.message}`
);

assert(
    pipeline.notes.length >= 4,
    `the good notes must still be published, got ${pipeline.notes.length}`
);

pass("one bad file does not stop the library");

const pipelineSlugs = pipeline.notes.map(
    (note) => note.slug
);

assert(
    pipelineSlugs.includes("shouty"),
    `an uppercase extension must be discovered, got: ${pipelineSlugs.join(", ")}`
);

assert(
    pipelineSlugs.includes("foldered"),
    `a note inside a folder must be discovered, got: ${pipelineSlugs.join(", ")}`
);

assert(
    new Set(pipelineSlugs).size === pipelineSlugs.length,
    `every note needs its own folder, got: ${pipelineSlugs.join(", ")}`
);

pass("discovery: case-insensitive, nested, unique slugs");

const folderedNote = pipeline.notes.find(
    (note) => note.slug === "foldered"
);

const folderedOutput = pipeline.rendered.foldered;

assert(
    folderedOutput !== undefined,
    "the foldered note should have been rendered"
);

assert(
    folderedOutput.html.includes('src="assets/figure1.jpg"'),
    "an image the note owns must point inside the note's own folder"
);

assert(
    folderedOutput.html.includes(
        'src="../data/assets/assets/figure2.jpg"'
    ),
    "an image the note does not own must still point at the shared library"
);

assert(
    folderedOutput.note.ownsAssets === 1,
    `the manifest must record the note's own assets, got ${folderedOutput.note.ownsAssets}`
);

assert(
    folderedOutput.assets.length === 1,
    `the note's own assets must be copied into its rendered folder, got ${folderedOutput.assets.length}`
);

pass("note-owned assets travel with the note");

for (const note of pipeline.notes) {
    const html = pipeline.rendered[note.slug].html;

    for (const tag of ["html", "head", "body"]) {
        const opened = countOf(
            html,
            new RegExp(`<${tag}\\b`, "gi")
        );
        const closed = countOf(
            html,
            new RegExp(`</${tag}>`, "gi")
        );

        assert(
            opened === 1 && closed === 1,
            `${note.slug}: <${tag}> opens ${opened}× and closes ${closed}×`
        );
    }
}

pass("every imported note is a whole document");

// A note that is deleted must not linger as a published folder.
const afterDeletion = await withTemporaryProject(
    async (imported) => {
        await writeFile(
            join(imported, "first.html"),
            importedNoteHtml,
            "utf8"
        );
        await writeFile(
            join(imported, "second.html"),
            importedNoteHtml.replace(
                "یادداشت واردشده",
                "یادداشت دوم"
            ),
            "utf8"
        );
    },
    async (directory) => {
        await quietly(() => renderAllNotes());

        const before = await readdir(
            join(directory, "renderedNotes"),
            {
                withFileTypes: true
            }
        );

        await rm(join(
            directory,
            "data",
            "imported",
            "second.html"
        ));

        await quietly(() => renderAllNotes());

        const after = await readdir(
            join(directory, "renderedNotes"),
            {
                withFileTypes: true
            }
        );

        return {
            before: before
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name),
            after: after
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
        };
    }
);

assert(
    afterDeletion.before.length === 2 &&
        afterDeletion.after.length === 1,
    `deleting a source must remove its folder, went from ${afterDeletion.before.length} to ${afterDeletion.after.length}`
);

pass("deleting a source removes its published folder");

/* =========================================================
   Source hygiene
   ========================================================= */

// A literal control byte — a NUL typed straight into a regex character class —
// makes a source file read as binary to ripgrep and quietly breaks tooling.
// Character classes have to be written with escapes.
const sourceFiles = [
    "src/main.js",
    "src/renderer.js",
    "src/math_renderer.js",
    "src/image_handler.js",
    "src/noteIdentity.js",
    "src/noteStorage.js",
    "src/noteLibrary.js",
    "src/templateIncludes.js",
    "src/callouts.js",
    "src/tableOfContents.js",
    "scripts/siteLib.mjs",
    "scripts/build-site.mjs"
];

for (const fileName of sourceFiles) {
    const bytes = await readFile(fileName);

    const controlBytes = [...bytes].filter(
        (byte) => byte < 9 || (byte > 13 && byte < 32)
    );

    assert(
        controlBytes.length === 0,
        `${fileName} contains ${controlBytes.length} literal control byte(s); write them as escapes`
    );
}

pass("no literal control bytes in any source file");

console.log(`\n${passedTests} tests passed.`);
