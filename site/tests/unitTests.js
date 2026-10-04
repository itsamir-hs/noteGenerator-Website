// Unit tests for the pure helpers of the site layer.

import {
    describe,
    test,
    assert,
    assertEqual,
    assertDeepEqual,
    assertIncludes,
    assertExcludes
} from "./harness.js";
import {
    escapeHtml,
    escapeJsonForScript,
    foldDigits,
    matchesTerms,
    normalizeSearchText,
    toAsciiDigits,
    toPlainText,
    toSearchTerms,
    toSingleLine
} from "../textUtils.js";
import { createNoteSlug, slugify, toSlugSource } from "../slug.js";
import {
    insertAfter,
    insertBefore,
    rewriteNoteAssetPaths,
    rewriteReferencePath,
    collectNoteAssetReferences,
    injectNoteAssets,
    finalizeNoteHtml
} from "../noteHtml.js";
import {
    addRemovedEntry,
    getRegistryEntry,
    isNoteRemoved,
    lookupRegistryEntry,
    normalizeRegistryEntry,
    removeRemovedEntry
} from "../registry.js";
import { createSummary, extractPreRenderedMetadata } from "../noteMetadata.js";

describe("textUtils", () => {
    test("folds Persian and Arabic digits to ASCII", () => {
        assertEqual(foldDigits("۱۴۰۴"), "1404");
        assertEqual(foldDigits("2026-10-01"), "2026-10-01");
        assertEqual(foldDigits("٣٠"), "30");
        assertEqual(toAsciiDigits("جلسه ۳"), "جلسه 3");
    });

    test("normalizes Arabic letter variants onto Persian ones", () => {
        assertEqual(
            normalizeSearchText("كتابخانهٔ علمي"),
            normalizeSearchText("کتابخانهٔ علمی")
        );

        assertEqual(
            normalizeSearchText("مُرور سریع"),
            normalizeSearchText("مرور سریع")
        );
    });

    test("collapses ZWNJ and punctuation into single spaces", () => {
        assertEqual(
            normalizeSearchText("ایمنی‌و بهداشت، آزمایشگاه!"),
            normalizeSearchText("ایمنی و بهداشت آزمایشگاه")
        );
    });

    test("keeps Latin text searchable, case-insensitively", () => {
        assertEqual(
            normalizeSearchText("Bone Marrow-on-a-Chip"),
            "bone marrow on a chip"
        );

        assert(
            normalizeSearchText("Bone Marrow").includes(
                normalizeSearchText("bone marrow")
            )
        );
    });

    test("treats a Persian-digit query as equal to its ASCII form", () => {
        assert(
            matchesTerms(
                normalizeSearchText("جلسه 12 - ایمنی"),
                toSearchTerms("۱۲")
            )
        );
    });

    test("requires every term to match (AND semantics)", () => {
        const haystack = normalizeSearchText("ایمنی و بهداشت آزمایشگاه");

        assert(matchesTerms(haystack, toSearchTerms("ایمنی بهداشت")));
        assert(!matchesTerms(haystack, toSearchTerms("ایمنی ژنتیک")));
    });

    test("splitSearchTerms drops empty terms", () => {
        assertDeepEqual(toSearchTerms("   ایمنی    بهداشت  "), [
            "ایمنی",
            "بهداشت"
        ]);
    });

    test("toSingleLine collapses newlines", () => {
        assertEqual(toSingleLine("  a\n  b\tc  "), "a b c");
    });

    test("toPlainText strips tags and decodes entities", () => {
        assertEqual(
            toPlainText("<strong>تعریف</strong>&nbsp;<em>سلول</em>"),
            "تعریف سلول"
        );
    });

    test("escapeHtml neutralises markup characters", () => {
        assertEqual(
            escapeHtml('<img src="x" onerror=\'y\'>&'),
            "&lt;img src=&quot;x&quot; onerror=&#039;y&#039;&gt;&amp;"
        );
    });

    test("escapeJsonForScript prevents any markup in the payload", () => {
        const escaped = escapeJsonForScript('["</script><script>alert(1)</script>"]');

        assertExcludes(escaped, "<");
        assertExcludes(escaped, ">");
        assertIncludes(escaped, "\\u003c");
    });

    test("escapeJsonForScript keeps the JSON parseable", () => {
        const payload = JSON.parse(
            escapeJsonForScript(
                JSON.stringify([{ title: '<b>"نکته"</b>' }])
            )
        );

        assertEqual(payload[0].title, '<b>"نکته"</b>');
    });
});

describe("slug", () => {
    test("slugify keeps ASCII names", () => {
        assertEqual(slugify("Bone Marrow-on-a-Chip"), "bone-marrow-on-a-chip");
        assertEqual(slugify("My_Note  (v2).md"), "my-note-v2");
    });

    test("slugify reduces Persian text to an empty string", () => {
        assertEqual(slugify("سیستم عصبی"), "");
    });

    test("toSlugSource drops the extension", () => {
        assertEqual(toSlugSource("lab-safety.html"), "lab-safety");
    });

    test("requested slug wins over the file name", () => {
        assertEqual(
            createNoteSlug({
                requestedSlug: "custom-slug",
                fileName: "source-file.md",
                takenSlugs: new Set()
            }),
            "custom-slug"
        );
    });

    test("falls back to the file name when the override is Persian", () => {
        assertEqual(
            createNoteSlug({
                requestedSlug: "تست",
                fileName: "nervous-system.md",
                takenSlugs: new Set()
            }),
            "nervous-system"
        );
    });

    test("never returns a reserved folder name", () => {
        assertEqual(
            createNoteSlug({
                fileName: "notes.md",
                takenSlugs: new Set()
            }),
            "note-1"
        );
    });

    test("suffixes duplicates instead of overwriting", () => {
        assertEqual(
            createNoteSlug({
                fileName: "same.md",
                takenSlugs: new Set(["same"])
            }),
            "same-2"
        );

        assertEqual(
            createNoteSlug({
                fileName: "same.md",
                takenSlugs: new Set(["same", "same-2"])
            }),
            "same-3"
        );
    });
});

describe("noteHtml path rewriting", () => {
    test("re-anchors root-relative references to the page depth", () => {
        assertEqual(
            rewriteReferencePath("../styles/base.css", 2),
            "../../styles/base.css"
        );

        assertEqual(
            rewriteReferencePath("../src/search.js", 2),
            "../../src/search.js"
        );

        assertEqual(
            rewriteReferencePath("../data/assets/whale.png", 2),
            "../../data/assets/whale.png"
        );
    });

    test("maps node_modules assets onto the vendored copies", () => {
        assertEqual(
            rewriteReferencePath(
                "../node_modules/katex/dist/katex.min.css",
                2
            ),
            "../../vendor/katex/katex.min.css"
        );

        assertEqual(
            rewriteReferencePath(
                "../node_modules/lucide/dist/umd/lucide.js",
                2
            ),
            "../../vendor/lucide/lucide.min.js"
        );
    });

    test("honours a different depth", () => {
        assertEqual(
            rewriteReferencePath("../styles/base.css", 3),
            "../../../styles/base.css"
        );
    });

    test("leaves anchors, absolute URLs and unrelated relative paths alone", () => {
        assertEqual(rewriteReferencePath("#heading-1", 2), "#heading-1");
        assertEqual(
            rewriteReferencePath("https://example.com/a.css", 2),
            "https://example.com/a.css"
        );
        assertEqual(
            rewriteReferencePath("data:image/png;base64,AAA", 2),
            "data:image/png;base64,AAA"
        );
        assertEqual(
            rewriteReferencePath("../other/index.html", 2),
            "../other/index.html"
        );
    });

    test("is idempotent: a rewritten page never gains extra ../", () => {
        const once = rewriteNoteAssetPaths(
            '<link href="../styles/base.css"><script src="../src/print.js"></script>',
            { depth: 2 }
        );

        const twice = rewriteNoteAssetPaths(once, { depth: 2 });

        assertEqual(twice, once);
        assertIncludes(once, 'href="../../styles/base.css"');
    });

    test("collectNoteAssetReferences lists href/src only", () => {
        const references = collectNoteAssetReferences(
            '<a href="a.html">x</a><img src="b.png"><a href="#c">c</a>'
        );

        assertDeepEqual(references, ["a.html", "b.png", "#c"]);
    });

    test("injects the site layer's note assets", () => {
        const html = finalizeNoteHtml(
            "<html><head></head><body></body></html>",
            { slug: "demo", depth: 2 }
        );

        assertIncludes(
            html,
            '<script src="../../site/assets/noteStorageScope.js" data-note-scope="demo"></script>'
        );
        assertIncludes(html, 'href="../../site/assets/noteNav.css"');
        assertIncludes(html, 'src="../../site/assets/noteHomeLink.js"');
    });

    test("omits the storage scope script when it is disabled", () => {
        const html = finalizeNoteHtml(
            "<html><head></head><body></body></html>",
            { slug: "demo", depth: 2, enableStorageScoping: false }
        );

        assertExcludes(html, "noteStorageScope.js");
        assertIncludes(html, "noteNav.css");
    });

    test("insertBefore / insertAfter append when the marker is missing", () => {
        assertEqual(insertBefore("abc", "</head>", "X"), "abcX");
        assertEqual(insertAfter("abc", "<head>", "X"), "abcX");
        assertEqual(insertBefore("a</head>b", "</head>", "X"), "aX</head>b");
        assertEqual(insertAfter("a<head>b", "<head>", "X"), "a<head>Xb");
    });
});

describe("registry", () => {
    test("returns an empty object for an unknown note", () => {
        assertDeepEqual(getRegistryEntry({ notes: {} }, "missing.md"), {});
        assertDeepEqual(getRegistryEntry({}, "missing.md"), {});
    });

    test("normalises and drops invalid entries", () => {
        const entry = normalizeRegistryEntry({
            slug: "  custom  ",
            title: "",
            order: "7",
            featured: "yes",
            hidden: 0,
            tags: ["زیست", "سلول"],
            unknown: "dropped"
        });

        assertDeepEqual(entry, {
            slug: "custom",
            order: 7,
            featured: true,
            hidden: false
        });
    });

    test("looks a source up by full path first, then by file name", () => {
        const registry = {
            notes: {
                "index.html": { title: "by file name" },
                "output/index.html": { title: "by path" }
            }
        };

        assertEqual(
            lookupRegistryEntry(registry, "output/index.html", "index.html")
                .title,
            "by path"
        );

        assertDeepEqual(
            lookupRegistryEntry(
                registry,
                "content/notes/other.md",
                "other.md"
            ),
            {}
        );

        assertEqual(
            lookupRegistryEntry(registry, "other/index.html", "index.html")
                .title,
            "by file name"
        );
    });

    test("the removal list blocks a note from coming back", () => {
        const registry = {
            notes: {},
            removed: [
                { slug: "gone", source: "content/notes/gone.md" },
                "by-string"
            ]
        };

        assertEqual(
            isNoteRemoved(registry, {
                slug: "gone",
                sourceFile: "content/notes/gone.md"
            }),
            true
        );

        assertEqual(
            isNoteRemoved(registry, {
                slug: "other",
                sourceFile: "content/notes/gone.md"
            }),
            true,
            "a matching source file also counts as removed"
        );

        assertEqual(
            isNoteRemoved(registry, { slug: "by-string" }),
            true,
            "the shorthand string form is supported"
        );

        assertEqual(
            isNoteRemoved(registry, {
                slug: "alive",
                sourceFile: "content/notes/alive.md"
            }),
            false
        );
    });

    test("add and remove removal entries", () => {
        const registry = { notes: {}, removed: [] };

        assertEqual(
            addRemovedEntry(registry, {
                slug: "a",
                sourceFile: "content/notes/a.md",
                removedAt: "2026-10-03"
            }),
            true
        );

        assertEqual(
            addRemovedEntry(registry, {
                slug: "a",
                sourceFile: "content/notes/a.md"
            }),
            false,
            "adding twice must not duplicate the entry"
        );

        assertEqual(registry.removed.length, 1);

        assertEqual(
            removeRemovedEntry(registry, {
                slug: "a",
                sourceFile: "content/notes/a.md"
            }),
            true
        );

        assertEqual(registry.removed.length, 0);

        assertEqual(
            removeRemovedEntry(registry, { slug: "a" }),
            false
        );
    });

    test("normalises an empty entry to an empty object", () => {
        assertDeepEqual(normalizeRegistryEntry({}), {});
    });
});

describe("noteMetadata", () => {
    const preRenderedHtml = `<!DOCTYPE html>
        <html data-theme="dark">
        <head><title>یک عنوان</title></head>
        <body>
        <h2>فهرست مطالب</h2>
        <main class="noteContainer">
        <section class="noteSection introductionSection">
            <h2>۱. مقدمه و کلیات</h2>
            <p>${"متن معرفی بسیار طولانی برای آزمون. ".repeat(6)}</p>
        </section>
        </main>
        <span class="metadataValue">درس نمونه</span>
        <span class="metadataValue">مبحث نمونه</span>
        <span class="metadataValue">استاد نمونه</span>
        <span class="metadataValue">۱۴۰۴/۰۱/۰۱</span>
        <span class="metadataValue">2026-01-01</span>
        </body></html>`;

    test("reads title, metadata values, headings and theme from HTML", () => {
        const extracted = extractPreRenderedMetadata(preRenderedHtml);

        assertEqual(extracted.title, "یک عنوان");
        assertEqual(extracted.metadata.courseName, "درس نمونه");
        assertEqual(extracted.metadata.topic, "مبحث نمونه");
        assertEqual(extracted.metadata.instructor, "استاد نمونه");
        assertEqual(extracted.metadata.sessionDate, "۱۴۰۴/۰۱/۰۱");
        assertEqual(extracted.metadata.generatedDate, "2026-01-01");
        assertEqual(extracted.theme, "dark");
        assertEqual(extracted.headings.length, 1);
        assertEqual(extracted.headings[0], "۱. مقدمه و کلیات");
    });

    test("captures body text for the card summary", () => {
        const extracted = extractPreRenderedMetadata(preRenderedHtml);

        assert(extracted.summarySource.includes("متن معرفی"));
    });

    test("falls back gracefully on a document without metadata", () => {
        const extracted = extractPreRenderedMetadata("<html><body>x</body></html>");

        assertEqual(extracted.title, "بدون عنوان");
        assertEqual(extracted.metadata.courseName, "");
        assertEqual(extracted.theme, null);
    });

    test("createSummary truncates on a word boundary", () => {
        const summary = createSummary("یک دو سه چهار پنج شش هفت هشت نه ده", 10);

        assert(summary.length <= 12);
        assert(summary.endsWith("…"));
    });

    test("createSummary keeps short text untouched", () => {
        assertEqual(createSummary("کوتاه", 50), "کوتاه");
    });
});