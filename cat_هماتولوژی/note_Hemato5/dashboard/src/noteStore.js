// File-system access for the editing dashboard: opening, saving, exporting
// notes and managing their image assets.
//
// Safety rules enforced here:
//  - every path is resolved inside the project folder (no traversal escapes)
//  - the generated original is never overwritten implicitly; saves go to an
//    `edited/` sibling unless the operator explicitly asks to overwrite
//  - assets are only deleted through an explicit call with a plain file name

import { mkdir, readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const noteRendererRoot = path.resolve(dashboardRoot, "..");
export const repositoryRoot = path.resolve(noteRendererRoot, "..", "..");

const EDITED_DIRECTORY = "edited";
const META_FILE = "dashboardMeta.json";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const UPLOAD_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

/** In-memory registry of notes opened in this server process. */
const openedNotes = new Map();

function toRepositoryRelative(absolutePath) {
    return path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
}

function assertInsideRepository(absolutePath) {
    const normalized = path.resolve(absolutePath);
    if (normalized !== repositoryRoot && !normalized.startsWith(repositoryRoot + path.sep)) {
        throw new Error("The requested path is outside of the project folder.");
    }
    return normalized;
}

/** Resolve a user supplied note path (absolute or repository-relative). */
export function resolveNotePath(requestedPath) {
    const trimmed = String(requestedPath || "").trim();
    if (!trimmed) throw new Error("No note path was provided.");

    const absolute = path.isAbsolute(trimmed)
        ? path.resolve(trimmed)
        : path.resolve(repositoryRoot, trimmed);

    return assertInsideRepository(absolute);
}

async function readJsonIfExists(filePath) {
    try {
        const content = await readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch {
        return null;
    }
}

async function pathExists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function isDirectory(filePath) {
    try {
        const info = await stat(filePath);
        return info.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Candidate notes: Markdown files at the repository root plus the renderer's
 * own input folder, which is what the pipeline and `node src/main.js` use.
 */
export async function listNoteCandidates() {
    const candidates = [];

    const collect = async (directory, kind) => {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
            candidates.push({
                path: toRepositoryRelative(path.join(directory, entry.name)),
                name: entry.name,
                kind
            });
        }
    };

    await collect(repositoryRoot, "pipeline");
    await collect(path.join(noteRendererRoot, "data", "input"), "renderer");

    return candidates.sort((a, b) => a.path.localeCompare(b.path));
}

function registerNote(noteId, note) {
    openedNotes.set(noteId, note);
    return note;
}

function getNote(noteId) {
    const note = openedNotes.get(noteId);
    if (!note) throw new Error("This note is no longer open. Please open it again.");
    return note;
}

/** Pick the directory the note's images live in, honouring both conventions. */
async function resolveAssetDirectory(noteDirectory) {
    const candidates = [
        path.join(noteDirectory, "assets"),
        path.join(noteRendererRoot, "data", "assets"),
        noteDirectory,
        path.join(noteDirectory, "data", "assets")
    ];

    for (const candidate of candidates) {
        if (await isDirectory(candidate)) {
            const entries = await readdir(candidate, { withFileTypes: true }).catch(() => []);
            const hasImages = entries.some(
                (entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
            );
            if (hasImages || candidate === noteDirectory) return candidate;
        }
    }

    return noteDirectory;
}

function isImagePath(fileName) {
    return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function encodeAssetUrl(noteId, relativeName) {
    const encoded = String(relativeName)
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    return `/data/${noteId}/${encoded}`;
}

/** Markdown path for a file inside the note's asset directory. */
export function markdownPathForAsset(note, absoluteAssetPath) {
    const assetDirectory = note.assetDirectory;
    const nameFromAssetDirectory = path.relative(assetDirectory, absoluteAssetPath).split(path.sep).join("/");
    const assetsDirectory = path.join(note.directory, "assets");

    if (assetDirectory === assetsDirectory) return `assets/${nameFromAssetDirectory}`;
    if (assetDirectory === note.directory) return nameFromAssetDirectory;
    return nameFromAssetDirectory;
}

async function listAssetFiles(note) {
    const results = [];

    const scan = async (directory, prefix) => {
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isFile() || !isImagePath(entry.name)) continue;
            const relativeName = prefix ? `${prefix}/${entry.name}` : entry.name;
            results.push({
                name: relativeName,
                fileName: entry.name,
                url: encodeAssetUrl(note.id, relativeName),
                markdownPath: markdownPathForAsset(
                    note,
                    path.join(directory, entry.name)
                )
            });
        }
    };

    await scan(note.assetDirectory, "");
    await scan(path.join(note.directory, "assets"), "assets");

    const seen = new Set();
    return results.filter((asset) => {
        const key = asset.markdownPath;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Open a note for editing.
 * Prefers the previously saved `edited/` copy and keeps the generated original
 * untouched for diffing and restore.
 */
export async function openNote(requestedPath) {
    const notePath = resolveNotePath(requestedPath);
    const noteDirectory = path.dirname(notePath);
    const baseName = path.basename(notePath);

    const originalMarkdown = await readFile(notePath, "utf8");
    const editedPath = path.join(noteDirectory, EDITED_DIRECTORY, baseName);

    let markdown = originalMarkdown;
    let editedExists = false;
    let savedAt = null;

    if (await pathExists(editedPath)) {
        markdown = await readFile(editedPath, "utf8");
        editedExists = true;
        const meta = await readJsonIfExists(path.join(path.dirname(editedPath), META_FILE));
        savedAt = meta && meta.savedAt ? meta.savedAt : null;
    }

    const noteId = createHash("sha1").update(notePath).digest("hex").slice(0, 12);
    const assetDirectory = await resolveAssetDirectory(noteDirectory);

    const manifest =
        (await readJsonIfExists(path.join(noteDirectory, "assets", "manifest.json"))) ||
        (await readJsonIfExists(path.join(assetDirectory, "manifest.json")));

    const manifestImages = manifest && Array.isArray(manifest.images) ? manifest.images : [];

    const note = registerNote(noteId, {
        id: noteId,
        path: notePath,
        relativePath: toRepositoryRelative(notePath),
        directory: noteDirectory,
        baseName,
        editedPath,
        originalMarkdown,
        assetDirectory,
        manifestImages
    });

    return {
        noteId,
        path: note.relativePath,
        markdown,
        originalMarkdown,
        editedExists,
        savedAt,
        assetDirectory: toRepositoryRelative(assetDirectory),
        assets: await listAssetFiles(note),
        manifestImages
    };
}

/** Last saved timestamp of the edited copy (or null when never saved). */
export async function getSavedState(noteId) {
    const note = getNote(noteId);
    const meta = await readJsonIfExists(path.join(path.dirname(note.editedPath), META_FILE));
    return {
        savedAt: meta && meta.savedAt ? meta.savedAt : null,
        savedPath: (await pathExists(note.editedPath)) ? toRepositoryRelative(note.editedPath) : null
    };
}

/**
 * Save the current Markdown.
 * Default target is the safe `edited/` copy; `overwriteOriginal` is an
 * explicit, opt-in decision so a generated note can never be clobbered by
 * an accidental save.
 */
export async function saveNote(noteId, markdown, options = {}) {
    const note = getNote(noteId);
    const targetPath = options.overwriteOriginal ? note.path : note.editedPath;

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, markdown, "utf8");

    const savedAt = new Date().toISOString();
    await writeFile(
        path.join(path.dirname(note.editedPath), META_FILE),
        JSON.stringify(
            {
                savedAt,
                sourcePath: note.relativePath,
                overwroteOriginal: Boolean(options.overwriteOriginal)
            },
            null,
            2
        ),
        "utf8"
    );

    return {
        savedPath: toRepositoryRelative(targetPath),
        savedAt,
        overwroteOriginal: Boolean(options.overwriteOriginal)
    };
}

/** The untouched generated note (used by the Changes view and restore). */
export function getOriginalMarkdown(noteId) {
    return getNote(noteId).originalMarkdown;
}

/**
 * Resolve an image reference from the Markdown to a real file inside the
 * project. Handles `assets/x.jpg`, `x.jpg` and absolute-style references.
 */
export async function resolveAssetFile(note, requestedReference) {
    const reference = String(requestedReference || "").trim();
    if (!reference) return null;

    const candidates = [
        path.join(note.directory, reference),
        path.join(note.assetDirectory, reference),
        path.join(note.assetDirectory, path.basename(reference)),
        path.join(repositoryRoot, reference)
    ];

    for (const candidate of candidates) {
        let resolved;
        try {
            resolved = assertInsideRepository(path.resolve(candidate));
        } catch {
            continue;
        }
        if (await pathExists(resolved)) {
            const info = await stat(resolved);
            if (info.isFile()) return resolved;
        }
    }

    return null;
}

/** Resolve a `/data/:noteId/...` asset request to a readable file. */
export async function resolveAssetRequest(noteId, requestedName) {
    const note = getNote(noteId);
    const segments = String(requestedName || "").split("/").filter(Boolean);

    for (const segment of segments) {
        if (segment === "." || segment === "..") throw new Error("Invalid asset path.");
    }

    const absolute = assertInsideRepository(path.join(note.assetDirectory, ...segments));
    if (!(await pathExists(absolute))) {
        // Also allow references that resolve against the note directory.
        const fallback = assertInsideRepository(path.join(note.directory, ...segments));
        if (await pathExists(fallback)) return fallback;
        return null;
    }
    return absolute;
}

/** Upload a new image into the note's asset directory. */
export async function uploadAsset(noteId, payload) {
    const note = getNote(noteId);
    const originalName = path.basename(String(payload.name || ""));
    const extension = path.extname(originalName).toLowerCase();

    if (!UPLOAD_EXTENSIONS.has(extension)) {
        throw new Error(
            `The selected file type is not supported (${extension || "unknown"}). Use PNG, JPEG, GIF, WebP or BMP.`
        );
    }

    const safeBase = path.basename(originalName, extension).replace(/[^\w\-.]+/g, "_") || "image";
    let fileName = `${safeBase}${extension}`;
    let counter = 1;

    while (await pathExists(path.join(note.assetDirectory, fileName))) {
        fileName = `${safeBase}-${counter}${extension}`;
        counter += 1;
    }

    const data = String(payload.data || "");
    if (!data) throw new Error("The uploaded image has no content.");

    const buffer = Buffer.from(data, "base64");
    await mkdir(note.assetDirectory, { recursive: true });
    await writeFile(path.join(note.assetDirectory, fileName), buffer);

    const absolute = path.join(note.assetDirectory, fileName);
    const markdownPath = markdownPathForAsset(note, absolute);

    return {
        fileName,
        markdownPath,
        url: encodeAssetUrl(note.id, path.relative(note.assetDirectory, absolute).split(path.sep).join("/")),
        size: buffer.length
    };
}

/**
 * Delete an asset file. This is destructive, so the caller must confirm it;
 * only files directly inside the note's asset directory are reachable.
 */
export async function deleteAsset(noteId, payload) {
    const note = getNote(noteId);
    const fileName = path.basename(String(payload.name || ""));
    const absolute = assertInsideRepository(path.join(note.assetDirectory, fileName));

    if (!(await pathExists(absolute))) {
        throw new Error("The asset file no longer exists.");
    }

    await unlink(absolute);
    return { deleted: fileName };
}

/** Refresh the asset list after uploads/deletions. */
export async function listAssets(noteId) {
    const note = getNote(noteId);
    return listAssetFiles(note);
}

export { getNote, isImagePath };
