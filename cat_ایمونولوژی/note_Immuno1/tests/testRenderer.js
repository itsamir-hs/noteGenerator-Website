// Runs sample Markdown files through the renderer and validates expected HTML features.

import { readdir, readFile } from "node:fs/promises";
import { renderMarkdown } from "../src/renderer.js";

const testDirectory = "./tests/sample_notes";

const rendererConfig = {
    theme: "light",
    language: "fa",
    enableMath: true
};

const expectedContent = {
    "basic.md": ["<h1>", "<ul>", "<blockquote>"],
    "code.md": ["<pre>", "language-python"],
    "image.md": ["<img"],
    "math.md": ["katex", "katex-display"],
    "rtl.md": ["سیستم عصبی", "Central Nervous System"],
    "table.md": ["<table>", "<th>", "<td>"]
};

const testFiles = (await readdir(testDirectory))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort();

let passedTests = 0;

console.log("Running renderer tests...\n");

for (const fileName of testFiles) {
    const markdownContent = await readFile(
        `${testDirectory}/${fileName}`,
        "utf8"
    );

    const htmlContent = renderMarkdown(
        markdownContent,
        rendererConfig
    );

    if (!htmlContent.trim()) {
        throw new Error(
            `Test failed: ${fileName} produced empty HTML.`
        );
    }

    for (const expectedValue of expectedContent[fileName] ?? []) {
        if (!htmlContent.includes(expectedValue)) {
            throw new Error(
                `Test failed: ${fileName} is missing "${expectedValue}".`
            );
        }
    }

    console.log(`✓ ${fileName}`);
    passedTests++;
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

if (
    mathDisabledHtml.includes("katex") ||
    mathDisabledHtml.includes("katex-display")
) {
    throw new Error(
        "Test failed: Math should not be rendered when enableMath is false."
    );
}

console.log("✓ math disabled");

passedTests++;

console.log(`\n${passedTests} tests passed.`);
