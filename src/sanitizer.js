// Sanitizes rendered HTML to prevent unsafe content from reaching the final note.

import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const window = new JSDOM("").window;
const purifier = DOMPurify(window);

export function sanitizeHtml(htmlContent) {
    return purifier.sanitize(htmlContent);
}
