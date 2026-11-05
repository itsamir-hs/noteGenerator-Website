// Coordinates Markdown parsing, explicit box/question markers,
// image paths, optional mathematical rendering, and HTML sanitization.

import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { parseMarkdown } from "./parser.js";
import { prepareMath, restoreMath } from "./math_renderer.js";
import { resolveImagePath } from "./image_handler.js";
import { applyCallouts } from "./callouts.js";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

export function renderMarkdown(
    markdownContent,
    rendererConfig
) {
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

    const contentWithMarkers =
        applyCallouts(renderedContent);

    const sanitizedContent =
        DOMPurify.sanitize(
            contentWithMarkers
        );

    return sanitizedContent.replace(
        /(<img\b[^>]*\bsrc=")([^"]+)(")/g,
        (_, prefix, imagePath, suffix) => {
            return `${prefix}${resolveImagePath(
                imagePath
            )}${suffix}`;
        }
    );
}
