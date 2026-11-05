// Maps the browser-style absolute import specifiers used by the dashboard
// ("/dashboard/src/…", "/src/…", "/node_modules/…") onto real files, so the
// exact same modules the browser loads can be imported by the Node tests.

import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const noteRendererRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".."
);
const dashboardRoot = path.join(noteRendererRoot, "dashboard");

const MAPPINGS = [
    { prefix: "/dashboard/", root: dashboardRoot, strip: "/dashboard/".length },
    { prefix: "/src/", root: noteRendererRoot, strip: 1 },
    { prefix: "/node_modules/", root: noteRendererRoot, strip: 1 },
    { prefix: "/styles/", root: noteRendererRoot, strip: 1 }
];

export async function resolve(specifier, context, nextResolve) {
    for (const mapping of MAPPINGS) {
        if (specifier.startsWith(mapping.prefix)) {
            const target = path.join(
                mapping.root,
                specifier.slice(mapping.strip)
            );
            return nextResolve(pathToFileURL(target).href, context);
        }
    }

    return nextResolve(specifier, context);
}
