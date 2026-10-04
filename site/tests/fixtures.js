// Test fixtures for the site layer.
//
// The integration tests need extra notes (a Markdown one and a pre-rendered one)
// and a registry that exercises the override features. Everything installed here
// is removed again by `restoreFixtures()`.

import { readFile, rm, writeFile } from "node:fs/promises";
import { SITE_CONFIG } from "../config.js";
import { toAbsolute } from "../paths.js";

export const registryPath = toAbsolute(SITE_CONFIG.registryFilePath);

export const fixtureMarkdownPath = toAbsolute(
    `${SITE_CONFIG.markdownNotesDirectoryName}/fixture-math.md`
);

export const fixturePreRenderedPath = toAbsolute(
    `${SITE_CONFIG.preRenderedNotesDirectoryName}/fixture-pre-rendered.html`
);

/** A file in output/ — where the original renderer's CLI writes. */
export const fixtureRendererOutputPath = toAbsolute(
    `${SITE_CONFIG.rendererOutputDirectoryName}/fixture-alpha.html`
);

/** A byte-identical copy (beta) of fixture-alpha.html — must be skipped. */
export const fixtureRendererOutputDuplicatePath = toAbsolute(
    `${SITE_CONFIG.rendererOutputDirectoryName}/fixture-beta.html`
);

/** Same title as fixture-alpha.html but different content — must be published with a warning. */
export const fixtureRendererOutputSameTitlePath = toAbsolute(
    `${SITE_CONFIG.rendererOutputDirectoryName}/fixture-gamma.html`
);

/** A note that is listed as removed but whose source file still exists. */
export const fixtureRemovedNotePath = toAbsolute(
    `${SITE_CONFIG.markdownNotesDirectoryName}/fixture-removed-note.md`
);

let originalRegistryContent = null;

const FIXTURE_MARKDOWN = `# ریاضی آزمایشگاهی

**درس:** فیزیک آزمایشگاهی
**مبحث:** اندازه‌گیری و خطا
**استاد:** دکتر آزمایش
**تاریخ جلسه:** 1404/05/12
**تاریخ تولید جزوه:** 2026-08-03

## ۱. مقدمه و کلیات

این یک جزوهٔ آزمایشی برای تست است و نباید در خروجی نهایی باقی بماند.

## ۲. متن اصلی جزوه

فرمول معروف اینشتین:

$$
E = mc^2
$$

و درون متن هم $a^2 + b^2 = c^2$ داریم.

> [!TIP] نکتهٔ تست
> بدنهٔ باکس تست.

| کمیت | نماد |
|---|---|
| جرم | m |
| انرژی | E |
`;

const FIXTURE_PRE_RENDERED = `<!DOCTYPE html>
<html lang="fa" dir="rtl" data-theme="forest">

<head>
    <meta charset="UTF-8">
    <title>جزوهٔ پیش‌رندر آزمایشی</title>

    <link rel="stylesheet" href="../styles/base.css">
    <link rel="stylesheet" href="../node_modules/katex/dist/katex.min.css">
    <script src="../node_modules/lucide/dist/umd/lucide.js"></script>
    <script src="../src/print.js"></script>
</head>

<body>

    <header class="appHeader">
        <div class="appTitle">جزوهٔ پیش‌رندر آزمایشی</div>
        <div class="headerControls">
            <button class="printButton" type="button"><i data-lucide="printer"></i></button>
        </div>
    </header>

    <main class="noteContainer">

        <section class="noteHeader">
            <span class="metadataItem">
                <span class="metadataValue">درس آزمایشی</span>
            </span>
            <span class="metadataItem">
                <span class="metadataValue">مبحث آزمایشی</span>
            </span>
        </section>

        <section class="noteSection mainSection">
            <h2 id="heading-1">متن از پیش رندر شده</h2>
            <p>![تصویر آزمایشی](../data/assets/whale.png)</p>
        </section>

    </main>

</body>

</html>
`;

/*
 * Mimics what `node src/main.js` writes into output/: a fully rendered note
 * document that still points at depth-1 paths.
 */
const FIXTURE_RENDERER_OUTPUT = `<!DOCTYPE html>
<html lang="fa" dir="rtl" data-theme="forest">

<head>
    <meta charset="UTF-8">
    <title>خروجی تازهٔ رندرر</title>

    <link rel="stylesheet" href="../styles/base.css">
    <script src="../src/print.js"></script>
</head>

<body>
    <header class="appHeader">
        <div class="appTitle">خروجی تازهٔ رندرر</div>
        <div class="headerControls">
            <button class="printButton" type="button"><i data-lucide="printer"></i></button>
        </div>
    </header>

    <main class="noteContainer">
        <section class="noteHeader">
            <span class="metadataItem">
                <span class="metadataValue">درس رندر</span>
            </span>
        </section>
        <section class="noteSection mainSection">
            <h2 id="heading-1">متن رندر تازه</h2>
            <p>این فایل شبیه خروجی <code>node src/main.js</code> است.</p>
        </section>
    </main>
</body>
</html>
`;

const FIXTURE_RENDERER_OUTPUT_ALT = FIXTURE_RENDERER_OUTPUT.replace(
    "متن رندر تازه",
    "متن رندر تازه ولی با محتوای متفاوت"
);

const FIXTURE_REMOVED_NOTE = `# یادداشت حذف‌شده

این فایل هنوز روی دیسک است ولی از سایت حذف شده است.
`;

const FIXTURE_REGISTRY = {
    notes: {
        "fixture-math.md": {
            description: "توضیح آزمایشی برای تست.",
            tags: ["آزمایشی", "ریاضی"],
            order: 1,
            hidden: true
        },
        "fixture-pre-rendered.html": {
            slug: "custom-prerendered-slug",
            title: "عنوان جایگزین جزوه",
            description: "توضیح جایگزین برای جزوهٔ پیش‌رندر شده.",
            tags: ["پیش‌رندر", "آزمایشی"],
            order: 0,
            featured: true
        },
        "fixture-render.html": {
            description: "توضیح جزوهٔ رندرشده توسط ماژول اصلی.",
            order: 15
        },
        "nervous-system.md": {
            description: "توضیح دستی برای تست اولویت‌ها.",
            order: 5
        }
    },
    removed: [
        {
            slug: "fixture-removed-note",
            source: "content/notes/fixture-removed-note.md",
            removedAt: "2026-10-03"
        }
    ]
};

/** Snapshot the real registry and write the fixture notes + registry. */
export async function installFixtures() {
    originalRegistryContent = await readFile(registryPath, "utf8");

    await writeFile(fixtureMarkdownPath, FIXTURE_MARKDOWN, "utf8");
    await writeFile(fixturePreRenderedPath, FIXTURE_PRE_RENDERED, "utf8");
    await writeFile(fixtureRendererOutputPath, FIXTURE_RENDERER_OUTPUT, "utf8");

    // Byte-identical copy: the build must recognise it and publish it once.
    await writeFile(
        fixtureRendererOutputDuplicatePath,
        FIXTURE_RENDERER_OUTPUT,
        "utf8"
    );

    // Same title, different content: the build must warn but still publish it.
    await writeFile(
        fixtureRendererOutputSameTitlePath,
        FIXTURE_RENDERER_OUTPUT_ALT,
        "utf8"
    );

    // Listed in the registry as removed while the source file still exists.
    await writeFile(
        fixtureRemovedNotePath,
        FIXTURE_REMOVED_NOTE,
        "utf8"
    );

    await writeFile(
        registryPath,
        `${JSON.stringify(FIXTURE_REGISTRY, null, 2)}\n`,
        "utf8"
    );
}

/**
 * Remove every fixture and put the real registry back.
 * Safe to call when no fixtures were installed.
 */
export async function restoreFixtures() {
    await cleanupFixtureArtifacts();

    if (originalRegistryContent !== null) {
        await writeFile(registryPath, originalRegistryContent, "utf8");
        originalRegistryContent = null;
    }
}

/**
 * Unconditional cleanup, used as a safety net at the start of a test run in
 * case a previous run was interrupted before it could restore anything.
 */
export async function cleanupFixtureArtifacts() {
    await rm(fixtureMarkdownPath, { force: true });
    await rm(fixturePreRenderedPath, { force: true });
    await rm(fixtureRendererOutputPath, { force: true });
    await rm(fixtureRendererOutputDuplicatePath, { force: true });
    await rm(fixtureRendererOutputSameTitlePath, { force: true });
    await rm(fixtureRemovedNotePath, { force: true });
}