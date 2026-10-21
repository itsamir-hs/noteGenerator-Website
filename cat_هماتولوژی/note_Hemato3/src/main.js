// Renders a Markdown lecture note into Bashligh's final HTML document.
//
// `renderNoteHtml` is the single reusable entry point for the renderer: the CLI
// below uses it, and external tools (e.g. the editing dashboard) import it so
// they produce byte-for-byte the same note format instead of a second, drifting
// HTML implementation.

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { renderMarkdown } from "./renderer.js";
import { createTableOfContents } from "./tableOfContents.js";

/**
 * Template placeholders, in the order they appear inside templates/note.html.
 * The reference/definition numbering intentionally follows the template
 * (section ۹ precedes ۸).
 */

const SECTION_DEFINITIONS = [
    {
        key: "introductionContent",
        title: "۱. مقدمه و کلیات"
    },
    {
        key: "mainContent",
        title: "۲. متن اصلی جزوه"
    },
    {
        key: "quickTablesContent",
        title: "۳. جداول مرور سریع"
    },
    {
        key: "keyTermsContent",
        title: "۴. اصطلاحات و تعاریف"
    },
    {
        key: "selfAssessmentContent",
        title: "۵. خود‌ارزیابی"
    },
    {
        key: "reviewContent",
        title: "۶. موارد نیازمند بررسی"
    },
    {
        key: "editorAndSourcesContent",
        title: "۷. ادیتور و منابع استفاده‌شده"
    },
    {
        key: "completionContent",
        title: "۸. گزارش تکمیل بودن محتوا"
    }
];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function extractNoteTitle(markdownContent) {
    const titleMatch = markdownContent.match(/^# (.+)$/m);

    return titleMatch
        ? titleMatch[1].trim()
        : "Untitled Note";
}

function extractMetadata(markdownContent) {
    const metadata = {
        courseName: "",
        topic: "",
        instructor: "",
        sessionDate: "",
        generatedDate: ""
    };

    const lines = markdownContent.split("\n");

    for (const line of lines) {
        const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);

        if (!match) {
            continue;
        }

        const label = match[1].trim();
        const value = match[2].trim();

        if (label === "درس") {
            metadata.courseName = value;
        } else if (label === "مبحث") {
            metadata.topic = value;
        } else if (label === "استاد") {
            metadata.instructor = value;
        } else if (label === "تاریخ جلسه") {
            metadata.sessionDate = value;
        } else if (label === "تاریخ تولید جزوه") {
            metadata.generatedDate = value;
        }
    }

    return metadata;
}

/**
 * Strip HTML tags/entities to plain text so a rendered heading can be compared
 * against a template section title.
 */
function toPlainText(htmlFragment) {
    return String(htmlFragment)
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

/** Fold Persian/Latin digits and punctuation so "۱. متن اصلی" equals "1 متن اصلی". */
function normalizeTitle(title) {
    return toPlainText(title)
        .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
        .replace(/[.．۔،,،:؛;()\[\]{}«»"'\-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** Leading numeral of a heading ("۴. نکات مهم" → 4), or null when absent. */
function leadingNumeral(title) {
    const match = normalizeTitle(title).match(/^(\d+)/);
    return match ? Number(match[1]) : null;
}

/** Split rendered note HTML into top-level H2 sections, preserving order. */
function splitIntoSections(htmlContent) {
    const sections = [];
    const headingPattern = /<h2[^>]*>([\s\S]*?)<\/h2>/g;

    let match;
    let lastIndex = 0;
    let current = null;

    while ((match = headingPattern.exec(htmlContent)) !== null) {
        if (current) {
            current.html = htmlContent.slice(current.start, match.index).trim();
            sections.push(current);
        }

        current = {
            title: toPlainText(match[1]),
            start: match.index,
            html: ""
        };

        lastIndex = match.index;
    }

    if (current) {
        current.html = htmlContent.slice(current.start).trim();
        sections.push(current);
    } else if (htmlContent.trim() !== "") {
        // No H2 at all — keep the whole body so nothing is lost on export.
        sections.push({ title: "", start: 0, html: htmlContent.trim() });
    }

    return sections;
}

/**
 * Map rendered H2 sections onto the template's fixed placeholders.
 *
 * Matching is intentionally defensive because the operator may rename a
 * heading. Order of preference per placeholder: exact title, leading numeral,
 * then positional. Any leftover sections are appended to `mainContent` so an
 * edited note can never silently lose content during export.
 */
function mapSectionsToTemplate(htmlContent) {
    const sections = splitIntoSections(htmlContent);
    const used = new Array(sections.length).fill(false);
    const result = {};

    const takeSection = (index) => {
        used[index] = true;
        return sections[index].html;
    };

    const findIndex = (predicate) => {
        for (let i = 0; i < sections.length; i++) {
            if (!used[i] && predicate(sections[i])) return i;
        }
        return -1;
    };

    for (const definition of SECTION_DEFINITIONS) {
        const wanted = normalizeTitle(definition.title);

        let index = findIndex((section) => normalizeTitle(section.title) === wanted);
        if (index === -1) {
            const numeral = leadingNumeral(definition.title);
            index = findIndex((section) => numeral !== null && leadingNumeral(section.title) === numeral);
        }

        result[definition.key] = index === -1 ? "" : takeSection(index);
    }

    // Positional fallback for placeholders that are still empty.
    for (const definition of SECTION_DEFINITIONS) {
        if (result[definition.key] !== "") continue;
        const index = findIndex(() => true);
        if (index === -1) break;
        result[definition.key] = takeSection(index);
    }

    // Anything left over is appended to the main content section.
    const leftovers = sections.filter((_, i) => !used[i]).map((section) => section.html);
    if (leftovers.length > 0) {
        result.mainContent = [result.mainContent, ...leftovers].filter(Boolean).join("\n");
    }

    return result;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function createTableOfContentsHtml(tocItems) {
    if (tocItems.length === 0) {
        return "";
    }

    return tocItems
        .map((item) => {
            const className =
                item.level === 2
                    ? "tocItem tocItemPrimary"
                    : "tocItem tocItemSecondary";

            return `
                <a
                    class="${className}"
                    href="#${item.headingId}"
                >
                    ${item.title}
                </a>
            `;
        })
        .join("");
}

/**
 * Render Markdown into Bashligh's final HTML document.
 *
 * @param {string} markdownContent - Note source in Markdown.
 * @param {Object} options
 * @param {string} options.template - Contents of templates/note.html.
 * @param {Object} [options.rendererConfig] - { theme, language, enableMath }.
 * @returns {{html: string, title: string, metadata: Object, tocItems: Array}}
 */
export function renderNoteHtml(markdownContent, options = {}) {
    const rendererConfig = options.rendererConfig || {
        theme: "light",
        language: "fa",
        enableMath: true
    };

    const template = options.template;
    if (typeof template !== "string") {
        throw new Error("renderNoteHtml requires options.template (string).");
    }

    const noteTitle = extractNoteTitle(markdownContent);
    const metadata = extractMetadata(markdownContent);

    const renderedMarkdown = renderMarkdown(
        markdownContent,
        rendererConfig
    );

    const { htmlContent, tocItems } = createTableOfContents(
        renderedMarkdown
    );

    const replacements = {
        noteTitle,
        courseName: metadata.courseName,
        topic: metadata.topic,
        instructor: metadata.instructor,
        sessionDate: metadata.sessionDate,
        generatedDate: metadata.generatedDate,
        tableOfContents: createTableOfContentsHtml(tocItems),
        ...mapSectionsToTemplate(htmlContent)
    };

    let finalHtml = template;

    for (const [key, value] of Object.entries(replacements)) {
        finalHtml = finalHtml.replace(
            new RegExp(`{{${key}}}`, "g"),
            value ?? ""
        );
    }

    // The template ships with data-theme="light"; honour the configured theme so
    // the exported note opens in the theme the operator chose. Bashligh's own
    // config default is "light", which keeps existing output unchanged.
    const theme = rendererConfig.theme || "light";
    if (/<html[^>]*\sdata-theme="[^"]*"/.test(finalHtml)) {
        finalHtml = finalHtml.replace(
            /(<html[^>]*\sdata-theme=")[^"]*(")/,
            `$1${theme}$2`
        );
    } else {
        finalHtml = finalHtml.replace(/<html\b([^>]*)>/, `<html$1 data-theme="${theme}">`);
    }

    return {
        html: finalHtml,
        title: noteTitle,
        metadata,
        tocItems
    };
}

async function renderNote() {
    const markdownContent = await readFile(
        "./data/input/note.md",
        "utf8"
    );

    const template = await readFile(
        "./templates/note.html",
        "utf8"
    );

    const rendererConfig = JSON.parse(
        await readFile(
            "./config/renderer_config.json",
            "utf8"
        )
    );

    const { html: finalHtml } = renderNoteHtml(markdownContent, {
        template,
        rendererConfig
    });

    await writeFile(
        "./output/index.html",
        finalHtml,
        "utf8"
    );

    console.log("Note rendered successfully.");
}

// Only run the CLI when this file is executed directly (`node src/main.js`),
// so importing renderNoteHtml from another tool has no side effects.
const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
    renderNote().catch((error) => {
        console.error("Rendering failed:");
        console.error(error);
        process.exit(1);
    });
}
