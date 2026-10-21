// Converts LaTeX expressions into safe placeholders and restores their KaTeX HTML after Markdown parsing.

import katex from "katex";

const mathExpressions = new Map();

function prepareMath(markdownContent) {
    mathExpressions.clear();

    const blockPattern = /\$\$([\s\S]+?)\$\$/g;
    const inlinePattern = /\$([^$\n]+?)\$/g;

    let expressionIndex = 0;

    let processedContent = markdownContent.replace(
        blockPattern,
        (_, expression) => {
            const placeholder = `MATH_BLOCK_${expressionIndex}`;

            mathExpressions.set(
                placeholder,
                katex.renderToString(expression.trim(), {
                    displayMode: true,
                    throwOnError: false
                })
            );

            expressionIndex++;

            return placeholder;
        }
    );

    processedContent = processedContent.replace(
        inlinePattern,
        (_, expression) => {
            const placeholder = `MATH_INLINE_${expressionIndex}`;

            mathExpressions.set(
                placeholder,
                katex.renderToString(expression.trim(), {
                    displayMode: false,
                    throwOnError: false
                })
            );

            expressionIndex++;

            return placeholder;
        }
    );

    return processedContent;
}

function restoreMath(htmlContent) {
    let renderedContent = htmlContent;

    for (const [placeholder, mathHtml] of mathExpressions) {
        renderedContent = renderedContent.replace(
            placeholder,
            mathHtml
        );
    }

    return renderedContent;
}

export { prepareMath, restoreMath };
