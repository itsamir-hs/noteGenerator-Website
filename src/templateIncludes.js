// Expands `{{>partialName}}` include markers in a template.
//
// The About dialog appears on both the note page and the home page. Keeping one
// copy in templates/partials/ means the two pages cannot drift apart — the
// failure mode this project already hit once, when the whole About block was
// duplicated inside a stylesheet.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const includePattern = /\{\{>\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

const partialsDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "partials"
);

/**
 * Replace every include marker with the contents of that partial.
 *
 * Partials may include other partials. An unknown or unreadable partial is an
 * error rather than a silently empty spot, because a template that looks right
 * and ships half a dialog is worse than a failed build.
 *
 * @param {string} template - Template source, possibly with include markers.
 * @param {string} [stack] - Partial names currently being expanded, for cycle
 *   detection. Internal.
 * @returns {Promise<string>} Fully expanded template.
 */
export async function resolveTemplateIncludes(
    template,
    stack = []
) {
    const matches = [
        ...template.matchAll(includePattern)
    ];

    if (matches.length === 0) {
        return template;
    }

    let expanded = template;

    for (const match of matches) {
        const name = match[1];

        if (stack.includes(name)) {
            throw new Error(
                `Circular template include: ${[...stack, name].join(" → ")}`
            );
        }

        let partial;

        try {
            partial = await readFile(
                join(partialsDirectory, `${name}.html`),
                "utf8"
            );
        } catch {
            throw new Error(
                `Unknown template partial "{{>${name}}}" requested by ` +
                `${stack.length > 0 ? stack.join(" → ") : "the template"}. ` +
                `No ${name}.html in templates/partials/.`
            );
        }

        const resolved = await resolveTemplateIncludes(
            partial,
            [...stack, name]
        );

        expanded = expanded.split(match[0]).join(resolved);
    }

    return expanded;
}
