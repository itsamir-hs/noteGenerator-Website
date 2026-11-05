// Tests the share bundle: contents, size, self-contained HTML and ZIP validity.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildShareBundle } from "../src/shareBundle.js";

const rendererRoot = path.resolve(import.meta.dirname, "..");
const workspace = await mkdtemp(path.join(tmpdir(), "share-bundle-"));

let passedTests = 0;

function check(condition, message) {
    if (!condition) throw new Error(`Test failed: ${message}`);
}

function checkEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`Test failed: ${message} (expected ${expected}, got ${actual})`);
    }
}

/* --- minimal ZIP reader so a green test proves a real archive --------------- */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let checksum = 0xffffffff;
    for (const byte of buffer) {
        checksum = CRC_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
    }
    return (checksum ^ 0xffffffff) >>> 0;
}

function readZip(buffer) {
    const entries = new Map();
    let offset = 0;

    while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const flags = buffer.readUInt16LE(offset + 6);
        const method = buffer.readUInt16LE(offset + 8);
        const checksum = buffer.readUInt32LE(offset + 14);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const uncompressedSize = buffer.readUInt32LE(offset + 22);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);

        check((flags & 0x0800) !== 0, "entry names are flagged as UTF-8");

        const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
        const dataStart = offset + 30 + nameLength + extraLength;
        const payload = buffer.subarray(dataStart, dataStart + compressedSize);
        const data = method === 8 ? inflateRawSync(payload) : payload;

        checkEqual(data.length, uncompressedSize, `uncompressed size of ${name}`);
        checkEqual(crc32(data), checksum, `CRC of ${name}`);

        entries.set(name, data);
        offset = dataStart + compressedSize;
    }

    check(
        offset + 22 <= buffer.length && buffer.readUInt32LE(offset) === 0x02014b50,
        "central directory follows the entries"
    );

    return entries;
}

/* --- fixture --------------------------------------------------------------- */

const noteDirectory = path.join(workspace, "note");
const notePath = path.join(noteDirectory, "lecture.md");
const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);

const markdown = `# درس آزمایشی

**درس:** ایمنی

## ۱. مقدمه و کلیات

متن مقدمه با یک تصویر.

![image1](image1.png)

## ۲. متن اصلی جزوه

فرمول: $a^2 + b^2 = c^2$

## ۳. جداول مرور سریع

| ستون | مقدار |
| --- | --- |
| یک | دو |

## ۴. اصطلاحات و تعاریف

تعریف‌ها اینجا هستند.

## ۵. خود‌ارزیابی

سؤال نمونه.

## ۶. موارد نیازمند بررسی

هیچ.

## ۷. ادیتور و منابع استفاده‌شده

منبع.

## ۸. گزارش تکمیل بودن محتوا

کامل.
`;

await mkdir(noteDirectory, { recursive: true });
await writeFile(notePath, markdown, "utf8");
await writeFile(path.join(noteDirectory, "image1.png"), pngBytes);

try {
    /* --- review bundle ------------------------------------------------------ */

    const review = await buildShareBundle({
        markdown,
        notePath,
        rendererRoot,
        mode: "review"
    });

    check(review.fileName.endsWith("-share.zip"), "review bundle uses the share file name");
    checkEqual(review.mode, "review", "review mode");
    check(review.stats.zipSize < 5 * 1024 * 1024, `review bundle is small (${review.stats.zipSize} bytes)`);
    checkEqual(review.warnings.length, 0, "no warnings for a complete note");

    const entries = readZip(review.buffer);
    const names = [...entries.keys()];
    const root = names[0].split("/")[0];

    check(names.includes(`${root}/note.md`), "bundle contains note.md");
    check(names.includes(`${root}/note.html`), "bundle contains note.html");
    check(names.includes(`${root}/assets/image1.png`), "bundle contains the referenced image");
    check(names.includes(`${root}/README.txt`), "bundle contains a README");

    check(
        names.every((name) => !/(^|\/)node_modules\//.test(name)),
        "bundle never ships node_modules"
    );
    check(
        names.every((name) => !/(^|\/)(src|dashboard|tests|logs|output)\//.test(name)),
        "bundle never ships renderer/dashboard source, tests, logs or outputs"
    );
    check(
        names.every((name) => !name.endsWith(".backup")),
        "bundle never ships backup files"
    );

    const sharedMarkdown = entries.get(`${root}/note.md`).toString("utf8");
    check(sharedMarkdown.includes("![image1](assets/image1.png)"), "note.md points at assets/");

    const html = entries.get(`${root}/note.html`).toString("utf8");

    check(html.includes("<!DOCTYPE html>"), "standalone HTML is a full document");
    check(html.includes('<style data-bundle-source="base.css">'), "base.css is inlined");
    check(html.includes("katex"), "KaTeX output is present");
    check(html.includes('src="data:image/png;base64,'), "images are embedded as data URIs");
    check(html.includes('<script data-bundle-source="lucide.min.js">'), "lucide is inlined minified");

    check(!/<link\b[^>]*rel="stylesheet"/i.test(html), "no stylesheet links remain");
    check(!/<script\b[^>]*\bsrc="/i.test(html), "no external scripts remain");
    check(!/\bsrc="\.\.\//i.test(html), "no relative image paths remain");
    check(!/\bhref="\.\.\//i.test(html), "no relative links remain");
    check(!html.includes("url(fonts/"), "KaTeX font URLs are embedded");
    check(!html.includes('url("../'), "stylesheet font URLs are embedded");

    // The note fonts must travel with the reader, otherwise the font switcher
    // silently falls back to the system font (both offline and in the zip).
    const bundledBaseCss = html.match(/<style data-bundle-source="base\.css">\n([\s\S]*?)\n<\/style>/)?.[1] ?? "";
    const readerFontFaces = [...bundledBaseCss.matchAll(/@font-face\s*\{[^}]*\}/g)].map((match) => match[0]);
    check(readerFontFaces.length > 0, "reader HTML keeps the note's @font-face rules");
    check(
        readerFontFaces.every((block) => block.includes("data:font/")),
        "every reader font is embedded as a data URI"
    );
    check(!/src="assets\//i.test(html), "the HTML does not depend on the assets folder");

    console.log("✓ review bundle (contents, self-contained HTML, valid zip)");
    passedTests++;

    /* --- editor bundle ------------------------------------------------------ */

    const editor = await buildShareBundle({
        markdown,
        notePath,
        rendererRoot,
        mode: "editor"
    });

    check(editor.fileName.endsWith("-editable.zip"), "editor bundle uses the editable file name");
    check(editor.stats.zipSize < 5 * 1024 * 1024, `editor bundle is small (${editor.stats.zipSize} bytes)`);

    const editorEntries = readZip(editor.buffer);
    const editorNames = [...editorEntries.keys()];
    const editorRoot = editorNames[0].split("/")[0];

    const editorApp = `${editorRoot}/Bashligh/note_renderer`;

    check(
        editorNames.includes(`${editorApp}/dashboard/server.js`),
        "editor bundle has the dashboard server"
    );
    check(
        editorNames.includes(`${editorApp}/dashboard/public/index.html`),
        "editor bundle has the dashboard shell"
    );
    check(editorNames.includes(`${editorApp}/src/main.js`), "editor bundle has the renderer");
    check(editorNames.includes(`${editorApp}/styles/base.css`), "editor bundle has the styles");

    // styles/base.css loads "../assets/fonts/…": every referenced font file has
    // to exist in the archive, or the extracted dashboard and its exports fall
    // back to a system font.
    const editorBaseCss = editorEntries.get(`${editorApp}/styles/base.css`).toString("utf8");
    const editorFontReferences = [...editorBaseCss.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)]
        .map((match) => match[1].trim());
    check(editorFontReferences.length > 0, "editor bundle stylesheet references its font files");

    for (const reference of editorFontReferences) {
        const resolved = path.posix.normalize(path.posix.join(`${editorApp}/styles`, reference));
        check(editorEntries.has(resolved), `editor bundle ships ${reference}`);
    }
    check(
        editorNames.includes(`${editorApp}/data/input/note.md`),
        "editor bundle keeps the project layout the dashboard expects"
    );
    check(
        editorNames.includes(`${editorApp}/data/assets/image1.png`),
        "editor bundle has the flat asset copy"
    );
    check(
        editorNames.includes(`${editorApp}/data/assets/assets/image1.png`),
        "editor bundle has the nested asset copy"
    );
    check(
        editorNames.every((name) => !/(^|\/)node_modules\//.test(name)),
        "editor bundle never ships node_modules"
    );
    check(
        editorNames.every((name) => !/\/(tests|logs)\//.test(name)),
        "editor bundle never ships tests or logs"
    );
    check(
        editorNames.every((name) => !/(^|\/)output\//.test(name)),
        "editor bundle never ships generated output"
    );
    check(
        editorNames.every((name) => !name.endsWith(".backup")),
        "editor bundle never ships backup files"
    );

    console.log("✓ editor bundle (runtime files only, no node_modules)");
    passedTests++;

    /* --- missing image ------------------------------------------------------ */

    const notePathWithMissingImage = path.join(noteDirectory, "missing.md");
    const missingName = "not-in-this-bundle-xyz.png";
    const markdownWithMissingImage = markdown.replace(
        "![image1](image1.png)",
        `![image9](${missingName})`
    );
    await writeFile(notePathWithMissingImage, markdownWithMissingImage, "utf8");

    const withMissing = await buildShareBundle({
        markdown: markdownWithMissingImage,
        notePath: notePathWithMissingImage,
        rendererRoot,
        mode: "review"
    });

    check(
        withMissing.warnings.some((warning) => warning.includes(missingName)),
        "a missing image is reported"
    );
    check(
        [...readZip(withMissing.buffer).keys()].every((name) => !name.endsWith(missingName)),
        "a missing image is not invented in the bundle"
    );
    check(
        readZip(withMissing.buffer)
            .get([...readZip(withMissing.buffer).keys()].find((name) => name.endsWith("note.md")))
            .toString("utf8")
            .includes(`![image9](${missingName})`),
        "a missing image keeps its original Markdown link"
    );

    console.log("✓ missing images are reported, not silently dropped");
    passedTests++;

    console.log(`\n${passedTests} share bundle tests passed.`);
} finally {
    await rm(workspace, { recursive: true, force: true });
}
