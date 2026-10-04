// Path helpers for the site layer.
//
// Every path is resolved from the project root so the build behaves the same
// no matter which directory `node site/buildSite.js` is executed from.

import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the note_renderer project root. */
export const PROJECT_ROOT = path.resolve(currentDirectory, "..");

/** Resolve a project-relative path to an absolute path. */
export function toAbsolute(relativePath) {
    return path.resolve(PROJECT_ROOT, relativePath);
}

/** Resolve a project-relative path to a POSIX-style relative path. */
export function toPosix(relativePath) {
    return String(relativePath).split(path.sep).join("/");
}

/** Build a project-relative POSIX path from path segments. */
export function joinRelative(...segments) {
    return toPosix(path.join(...segments));
}