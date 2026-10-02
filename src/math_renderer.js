// Converts LaTeX expressions into safe placeholders and restores their KaTeX HTML after Markdown parsing.

import katex from "katex";

const mathExpressions = new Map();

/**
 * KaTeX has no glyphs for Arabic-script letters, so an expression containing
 * Persian text cannot be typeset — it renders as an error box plus a wall of
 * "Unrecognized Unicode character" warnings.
 *
 * The dollar-sign heuristic cannot tell prose from a formula, and Persian notes
 * use `$` as an ordinary character often enough that a stray pair would swallow
 * a whole sentence. Where an expression is not typesettable we leave the source
 * text exactly as written, which is what a reader expects.
 */
const unTypesettableScriptPattern = /\p{Script=Arabic}/u;

function isTypesettable(expression) {
    return !unTypesettableScriptPattern.test(expression);
}

function prepareMath(markdownContent) {
    mathExpressions.clear();

    const blockPattern = /\$\$([\s\S]+?)\$\$/g;
    const inlinePattern = /\$([^$\n]+?)\$/g;

    let expressionIndex = 0;

    let processedContent = markdownContent.replace(
        blockPattern,
        (placeholderMatch, expression) => {
            if (!isTypesettable(expression)) {
                return placeholderMatch;
            }

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
        (placeholderMatch, expression) => {
            if (!isTypesettable(expression)) {
                return placeholderMatch;
            }

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
