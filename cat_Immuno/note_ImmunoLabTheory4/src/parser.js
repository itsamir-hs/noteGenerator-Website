// Converts supported Markdown into raw HTML for the rendering pipeline.

import { marked } from "marked";

export function parseMarkdown(markdownContent) {
    return marked.parse(markdownContent);
}
