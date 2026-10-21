// HTTP server for the human editing dashboard.
//
// It exposes three things: the dashboard front-end, a small JSON API for
// opening/saving/exporting notes, and a preview route that serves HTML built
// by Bashligh's own renderer so the live preview and the exported note are
// produced by exactly the same pipeline.

import { createServer } from "node:http";
import { readFile, stat, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    listNoteCandidates,
    openNote,
    saveNote,
    getOriginalMarkdown,
    listAssets,
    uploadAsset,
    deleteAsset,
    resolveAssetRequest,
    getNote
} from "./src/noteStore.js";
import { buildPreviewHtml, exportNote } from "./src/exporter.js";
import { validateDocument } from "./src/validation.js";
import { parseDocument } from "./src/documentModel.js";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const publicRoot = path.join(dashboardRoot, "public");
const noteRendererRoot = path.resolve(dashboardRoot, "..");

const HOST = process.env.DASHBOARD_HOST || "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_PORT || 4600);
const MAX_BODY_BYTES = 120 * 1024 * 1024;
const LOG_FILE = path.join(dashboardRoot, "logs", "dashboard.log");

const previewCache = new Map();

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8"
};

const STATIC_ROUTES = [
    { prefix: "/dashboard/src/", root: path.join(dashboardRoot, "src"), allow: null },
    { prefix: "/public/", root: publicRoot, allow: null },
    { prefix: "/styles/", root: path.join(noteRendererRoot, "styles"), allow: null },
    { prefix: "/src/", root: path.join(noteRendererRoot, "src"), allow: null },
    { prefix: "/templates/", root: path.join(noteRendererRoot, "templates"), allow: null },
    {
        prefix: "/node_modules/",
        root: path.join(noteRendererRoot, "node_modules"),
        // Only the libraries the note and the dashboard actually load.
        allow: ["marked/", "katex/", "lucide/", "dompurify/"]
    },
    { prefix: "/", root: publicRoot, allow: null }
];

/* =========================================================
   Logging (paths and events only — never note content)
   ========================================================= */

async function logEvent(level, message, context = {}) {
    const line = `${new Date().toISOString()} [${level}] ${message} ${JSON.stringify(context)}\n`;
    process.stdout.write(line);
    try {
        await mkdir(path.dirname(LOG_FILE), { recursive: true });
        await appendFile(LOG_FILE, line, "utf8");
    } catch {
        // Logging must never break a request.
    }
}

/* =========================================================
   Small HTTP helpers
   ========================================================= */

function sendJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(body);
}

function readRequestBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        request.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error("The request body is too large."));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });

        request.on("end", () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("The request body is not valid JSON."));
            }
        });

        request.on("error", reject);
    });
}

function isPathInside(rootDirectory, candidate) {
    const resolvedRoot = path.resolve(rootDirectory);
    const resolvedCandidate = path.resolve(candidate);
    return (
        resolvedCandidate === resolvedRoot ||
        resolvedCandidate.startsWith(resolvedRoot + path.sep)
    );
}

async function serveFile(response, absolutePath, extraHeaders = {}) {
    const info = await stat(absolutePath);
    if (!info.isFile()) throw new Error("Not a file.");

    const extension = path.extname(absolutePath).toLowerCase();
    response.writeHead(200, {
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-cache",
        ...extraHeaders
    });

    const { createReadStream } = await import("node:fs");
    createReadStream(absolutePath).pipe(response);
}

async function serveStatic(requestPath, response) {
    const decoded = decodeURIComponent(requestPath);

    for (const route of STATIC_ROUTES) {
        if (!decoded.startsWith(route.prefix)) continue;

        const relativePart = decoded.slice(route.prefix.length);
        const relativeSafe = relativePart.split("/").filter(Boolean);

        // A directory request ("/" on the catch-all route) serves the folder's
        // index file, so the bare origin loads the dashboard shell instead of
        // falling through to the 404 below.
        if (relativeSafe.length === 0) {
            relativeSafe.push("index.html");
        }

        if (route.allow && !route.allow.some((allowed) => relativePart.startsWith(allowed))) {
            continue;
        }
        if (relativeSafe.some((segment) => segment === "..")) {
            return sendJson(response, 400, { error: "Invalid path." });
        }

        const absolutePath = path.join(route.root, ...relativeSafe);
        if (!isPathInside(route.root, absolutePath)) {
            return sendJson(response, 400, { error: "Invalid path." });
        }

        try {
            await serveFile(response, absolutePath);
            return;
        } catch {
            continue; // fall through to the next route (e.g. "/" catch-all)
        }
    }

    return sendJson(response, 404, { error: "Not found." });
}

/* =========================================================
   API handlers
   ========================================================= */

const handlers = {
    async notes() {
        return { notes: await listNoteCandidates() };
    },

    async open(body) {
        const result = await openNote(body.path);
        await logEvent("info", "note opened", { path: result.path });
        return result;
    },

    async save(body) {
        const result = await saveNote(body.noteId, String(body.markdown ?? ""), {
            overwriteOriginal: Boolean(body.overwriteOriginal)
        });
        await logEvent("info", "note saved", {
            path: result.savedPath,
            overwriteOriginal: result.overwroteOriginal
        });
        return result;
    },

    async original(body) {
        return { markdown: getOriginalMarkdown(body.noteId) };
    },

    async render(body) {
        const note = getNote(body.noteId);
        const markdown = String(body.markdown ?? "");
        const html = await buildPreviewHtml(markdown, note);

        previewCache.set(note.id, html);
        await logEvent("debug", "preview rendered", { path: note.relativePath });

        return { ok: true, noteId: note.id, length: html.length };
    },

    async assets(body) {
        return { assets: await listAssets(body.noteId) };
    },

    async upload(body) {
        const result = await uploadAsset(body.noteId, body);
        await logEvent("info", "asset uploaded", { file: result.fileName });
        return result;
    },

    async removeAsset(body) {
        const result = await deleteAsset(body.noteId, body);
        await logEvent("warn", "asset deleted", { file: result.deleted });
        return result;
    },

    async validate(body) {
        const note = getNote(body.noteId);
        const document = parseDocument(String(body.markdown ?? ""));
        const assets = await listAssets(note.id);

        return {
            issues: validateDocument(document, {
                assetNames: assets.map((asset) => asset.name),
                manifestImages: note.manifestImages
            })
        };
    },

    async export(body) {
        const note = getNote(body.noteId);
        const markdown = String(body.markdown ?? "");
        const document = parseDocument(markdown);
        const assets = await listAssets(note.id);

        const issues = validateDocument(document, {
            assetNames: assets.map((asset) => asset.name),
            manifestImages: note.manifestImages
        });

        const blocking = issues.filter((issue) => issue.level === "error");
        if (blocking.length > 0 && !body.force) {
            return { blocked: true, issues, exportPath: null };
        }

        const result = await exportNote(note, markdown);
        await logEvent("info", "note exported", {
            path: result.relativePath,
            missingImages: result.missingImages.length
        });

        return {
            blocked: false,
            issues,
            exportPath: result.relativePath,
            missingImages: result.missingImages
        };
    }
};

async function handleApi(request, response, requestPath) {
    const action = requestPath.slice("/api/".length);

    if (action === "health" && request.method === "GET") {
        return sendJson(response, 200, { ok: true, service: "note-editing-dashboard" });
    }

    // Read-only actions answer to GET as well, which keeps them easy to probe.
    const isReadOnly = action === "notes";
    if (request.method === "GET" && !isReadOnly) {
        return sendJson(response, 405, { error: "Method not allowed." });
    }
    if (request.method !== "GET" && request.method !== "POST") {
        return sendJson(response, 405, { error: "Method not allowed." });
    }

    const handler = handlers[action];
    if (!handler) {
        return sendJson(response, 404, { error: `Unknown API action: ${action}` });
    }

    try {
        const body = await readRequestBody(request);
        const payload = await handler(body);
        sendJson(response, 200, payload);
    } catch (error) {
        await logEvent("error", "api failed", { action, message: error.message });
        const status = /outside of the project|no longer open|not supported/i.test(error.message)
            ? 400
            : 500;
        sendJson(response, status, { error: error.message });
    }
}

/* =========================================================
   Preview / asset / export routes
   ========================================================= */

async function handlePreview(requestPath, response) {
    const match = requestPath.match(/^\/preview\/([^/]+)\.html$/);
    if (!match) return false;

    const html = previewCache.get(match[1]);
    if (!html) {
        sendJson(response, 404, { error: "Preview not available. Edit the note first." });
        return true;
    }

    response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(html);
    return true;
}

async function handleDataAsset(requestPath, response) {
    const match = requestPath.match(/^\/data\/([^/]+)\/(.+)$/);
    if (!match) return false;

    try {
        const filePath = await resolveAssetRequest(match[1], match[2]);
        if (!filePath) {
            sendJson(response, 404, { error: "Asset not found." });
            return true;
        }
        await serveFile(response, filePath);
    } catch (error) {
        sendJson(response, 400, { error: error.message });
    }
    return true;
}

async function handleExportFile(requestPath, request, response) {
    const match = requestPath.match(/^\/exports\/([^/]+\.html)$/);
    if (!match) return false;

    const fileName = path.basename(match[1]);
    const exportRoot = path.join(noteRendererRoot, "output");
    const absolutePath = path.join(exportRoot, fileName);

    if (!isPathInside(exportRoot, absolutePath)) {
        sendJson(response, 400, { error: "Invalid path." });
        return true;
    }

    try {
        const wantsDownload = new URL(request.url, "http://localhost").searchParams.get("download");
        await serveFile(
            response,
            absolutePath,
            wantsDownload
                ? { "Content-Disposition": `attachment; filename="${fileName}"` }
                : {}
        );
    } catch {
        sendJson(response, 404, { error: "Exported file not found." });
    }
    return true;
}

/* =========================================================
   Server
   ========================================================= */

async function requestHandler(request, response) {
    const requestPath = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);

    try {
        if (requestPath.startsWith("/api/")) {
            await handleApi(request, response, requestPath);
            return;
        }

        if (await handlePreview(requestPath, response)) return;
        if (await handleDataAsset(requestPath, response)) return;
        if (await handleExportFile(requestPath, request, response)) return;

        if (request.method !== "GET" && request.method !== "HEAD") {
            sendJson(response, 405, { error: "Method not allowed." });
            return;
        }

        // Browsers auto-request /favicon.ico; the dashboard ships an SVG icon.
        if (requestPath === "/favicon.ico") {
            response.writeHead(302, { Location: "/favicon.svg", "Cache-Control": "no-cache" });
            response.end();
            return;
        }

        await serveStatic(requestPath, response);
    } catch (error) {
        await logEvent("error", "request failed", { path: requestPath, message: error.message });
        if (!response.headersSent) {
            sendJson(response, 500, { error: "Unexpected server error.", detail: error.message });
        } else {
            response.end();
        }
    }
}

export function startDashboardServer() {
    const server = createServer((request, response) => {
        requestHandler(request, response);
    });

    server.listen(PORT, HOST, () => {
        const address = `http://${HOST}:${PORT}`;
        process.stdout.write(`Human editing dashboard running at ${address}\n`);
    });

    return server;
}

// Only start listening when this file is run directly, so tests can import
// the handlers without opening a port.
const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryPath) {
    startDashboardServer();
}
