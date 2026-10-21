// Builds a table of contents from rendered note headings.

export function createTableOfContents(htmlContent) {
    const headingPattern = /<h([23])>(.*?)<\/h\1>/g;

    let headingIndex = 0;

    const updatedHtml = htmlContent.replace(
        headingPattern,
        (_, level, title) => {
            headingIndex++;

            const headingId = `heading-${headingIndex}`;

            return `<h${level} id="${headingId}">${title}</h${level}>`;
        }
    );

    const tocItems = [];

    const tocPattern = /<h([23]) id="(heading-\d+)">(.*?)<\/h\1>/g;

    for (const match of updatedHtml.matchAll(tocPattern)) {
        const [, level, headingId, title] = match;

        tocItems.push({
            level: Number(level),
            headingId,
            title
        });
    }

    return {
        htmlContent: updatedHtml,
        tocItems
    };
}
