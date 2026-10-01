// Coordinates Markdown parsing, definition boxes, image paths,
// optional mathematical rendering, and HTML sanitization.

import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { parseMarkdown } from "./parser.js";
import { prepareMath, restoreMath } from "./math_renderer.js";
import { resolveImagePath } from "./image_handler.js";
import { applyCallouts } from "./callouts.js";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

function createDefinitionBoxes(htmlContent) {
    const document = new JSDOM(
        `<body>${htmlContent}</body>`
    ).window.document;

    const body = document.body;

    body.querySelectorAll("blockquote").forEach(
        (blockquote) => {
            const firstElement =
                blockquote.firstElementChild;

            if (!firstElement) {
                return;
            }

            const firstStrong =
                firstElement.querySelector("strong");

            if (!firstStrong) {
                return;
            }

            const title =
                firstStrong.textContent.trim();

            if (!title.startsWith("تعریف")) {
                return;
            }

            blockquote.classList.add(
                "definitionBox"
            );
        }
    );

    body.querySelectorAll("h3").forEach(
        (heading) => {
            let previousHeading =
                heading.previousElementSibling;

            while (
                previousHeading &&
                previousHeading.tagName !== "H2"
            ) {
                previousHeading =
                    previousHeading.previousElementSibling;
            }

            if (!previousHeading) {
                return;
            }

            const sectionTitle =
                previousHeading.textContent.trim();

            const isDefinitionSection =
                sectionTitle.includes("تعریف") ||
                sectionTitle.includes("اصطلاح");

            if (!isDefinitionSection) {
                return;
            }

            const definitionBox =
                document.createElement("div");

            definitionBox.className =
                "definitionBox";

            heading.parentNode.insertBefore(
                definitionBox,
                heading
            );

            definitionBox.appendChild(heading);

            let nextElement =
                definitionBox.nextElementSibling;

            while (
                nextElement &&
                nextElement.tagName !== "H2" &&
                nextElement.tagName !== "H3"
            ) {
                const currentElement =
                    nextElement;

                nextElement =
                    nextElement.nextElementSibling;

                definitionBox.appendChild(
                    currentElement
                );
            }
        }
    );

    return body.innerHTML;
}

/**
 * Render Markdown into note HTML.
 *
 * @param {string} markdownContent - Note source in Markdown.
 * @param {Object} rendererConfig - `{ theme, language, enableMath }`.
 * @param {Object} [options]
 * @param {string} [options.assetPrefix="../"] - Prefix prepended to relative
 *   asset paths, so the same note works from a flat folder or a nested one.
 * @returns {string} Sanitized HTML fragment.
 */
export function renderMarkdown(
    markdownContent,
    rendererConfig,
    options = {}
) {
    const assetPrefix =
        options.assetPrefix ?? "../";

    const processedMarkdown =
        rendererConfig.enableMath
            ? prepareMath(markdownContent)
            : markdownContent;

    const htmlContent =
        parseMarkdown(processedMarkdown);

    const renderedContent =
        rendererConfig.enableMath
            ? restoreMath(htmlContent)
            : htmlContent;

    // Callout/definition boxes are converted before sanitization so the
    // generated markup is vetted by DOMPurify as well.
    const contentWithCallouts =
        applyCallouts(renderedContent);

    const contentWithDefinitions =
        createDefinitionBoxes(
            contentWithCallouts
        );

    const sanitizedContent =
        DOMPurify.sanitize(
            contentWithDefinitions
        );

    return sanitizedContent.replace(
        /(<img\b[^>]*\bsrc=")([^"]+)(")/g,
        (_, prefix, imagePath, suffix) => {
            return `${prefix}${resolveImagePath(
                imagePath,
                assetPrefix
            )}${suffix}`;
        }
    );
}