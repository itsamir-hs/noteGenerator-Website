// Local static server for the published site.
//
//   node site/serve.js            → http://localhost:4173
//   node site/serve.js --port 8080
//   node site/serve.js --no-open
//
// It serves the project root exactly the way GitHub Pages would, so every
// relative path can be verified before pushing. Directory URLs resolve to their
// index.html, missing files are reported loudly, and `--check` mode requests
// every published page plus its assets so broken links surface without a
// browser.

import http from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, toPosix } from "./paths.js";
import { collectNoteAssetReferences } from "./noteHtml.js";
import { SITE_CONFIG } from "./config.js";

const DEFAULT_PORT = 4173;

const CONTENT_TYPES = new Map(
    Object.entries({
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".map": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".eot": "application/vnd.ms-fontobject"
    })
);

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    return CONTENT_TYPES.get(extension) || "application/octet-stream";
}

/** Decode a URL path and refuse anything that escapes the project root. */
function resolveRequestPath(requestUrl) {
    let pathname;

    try {
        pathname = decodeURIComponent(
            new URL(requestUrl, "http://localhost").pathname
        );
    } catch {
        return null;
    }

    const relativePath = toPosix(pathname).replace(/^\/+/, "");

    const absolutePath = path.resolve(PROJECT_ROOT, relativePath);

    if (absolutePath !== PROJECT_ROOT && !absolutePath.startsWith(PROJECT_ROOT + path.sep)) {
        return null;
    }

    return absolutePath;
}

/** Resolve a request to a file on disk, following directory index.html. */
async function resolveFile(absolutePath) {
    try {
        const fileStats = await stat(absolutePath);

        if (fileStats.isDirectory()) {
            const indexPath = path.join(absolutePath, "index.html");

            const indexStats = await stat(indexPath);

            return indexStats.isFile() ? indexPath : null;
        }

        return fileStats.isFile() ? absolutePath : null;
    } catch {
        return null;
    }
}

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
    response.writeHead(statusCode, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
    });

    response.end(body);
}

export function createSiteServer({ logRequests = false, logMissing = true } = {}) {
    return http.createServer(async (request, response) => {
        const absolutePath = resolveRequestPath(request.url);

        if (!absolutePath) {
            send(response, 400, "Bad request");

            return;
        }

        const filePath = await resolveFile(absolutePath);

        if (!filePath) {
            const relativePath = toPosix(
                path.relative(PROJECT_ROOT, absolutePath)
            );

            if (logMissing) {
                console.error(
                    `404  ${request.method} ${request.url}  →  ${relativePath}`
                );
            }
            send(response, 404, `404 Not Found: ${relativePath}`);

            return;
        }

        if (logRequests) {
            console.log(
                `200  ${request.method} ${request.url}  →  ${toPosix(
                    path.relative(PROJECT_ROOT, filePath)
                )}`
            );
        }

        response.writeHead(200, {
            "Content-Type": getContentType(filePath),
            "Cache-Control": "no-store"
        });

        createReadStream(filePath).pipe(response);
    });
}

/** Source templates are inputs, not published pages, so they are not checked. */
const SOURCE_ONLY_HTML_FILES = new Set([
    "site/assets/home.template.html",
    "templates/note.html"
]);

/** Every file the published site exposes, relative to the project root. */
async function listPublishedFiles() {
    const publishedFiles = [];
    const skippedDirectories = new Set([
        "node_modules",
        ".git",
        ".cache",
        "output",
        "content"
    ]);

    async function walk(absoluteDirectory) {
        const entries = await readdir(absoluteDirectory, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name.startsWith(".")) {
                continue;
            }

            const entryPath = path.join(absoluteDirectory, entry.name);

            if (entry.isDirectory()) {
                if (skippedDirectories.has(entry.name)) {
                    continue;
                }

                await walk(entryPath);
                continue;
            }

            publishedFiles.push(toPosix(path.relative(PROJECT_ROOT, entryPath)));
        }
    }

    await walk(PROJECT_ROOT);

    return publishedFiles;
}

/**
 * Request every published page and every local asset it references, then report
 * anything that 404s. This is the "does the site actually work" check.
 */
export async function runLinkCheck({ port = DEFAULT_PORT, timeoutMs = 15000 } = {}) {
    const server = createSiteServer();

    await new Promise((resolve) => server.listen(port, resolve));

    const actualPort = server.address().port;
    const origin = `http://127.0.0.1:${actualPort}`;
    const publishedFiles = await listPublishedFiles();

    const htmlFiles = publishedFiles.filter(
        (file) =>
            file.endsWith(".html") &&
            !SOURCE_ONLY_HTML_FILES.has(file)
    );

    const styleSheetFiles = publishedFiles.filter((file) =>
        file.endsWith(".css")
    );

    const failures = [];
    let checkedReferences = 0;

    async function request(pathname) {
        const response = await fetch(`${origin}${pathname}`, {
            redirect: "manual"
        });

        return { status: response.status, response };
    }

    // 1. Every published document must answer.
    for (const file of htmlFiles) {
        const { status } = await request(`/${file}`);

        if (status !== 200) {
            failures.push({ file, reference: file, status });
        }
    }

    // 2. Every local href/src of every document must resolve.
    for (const file of htmlFiles) {
        const fileResponse = await fetch(`${origin}/${file}`);
        const html = await fileResponse.text();

        const isHomePage = file === SITE_CONFIG.homePageFileName;

        for (const reference of collectNoteAssetReferences(html)) {
            if (
                !reference ||
                reference.startsWith("#") ||
                /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
                reference.startsWith("//") ||
                reference.startsWith("data:")
            ) {
                continue;
            }

            // A note page must reach another note through "../../notes/…";
            // a bare "notes/…" would resolve to notes/notes/….
            if (reference.startsWith("notes/") && !isHomePage) {
                failures.push({
                    file,
                    reference,
                    status: 404,
                    reason: "site link resolved from the wrong page depth"
                });
                continue;
            }

            checkedReferences++;

            const target = reference.endsWith("/")
                ? `${reference}index.html`
                : reference;

            const { status } = await request(`/${target}`);

            if (status !== 200) {
                failures.push({ file, reference, status });
            }
        }
    }

    // 3. Every url(...) of every stylesheet must resolve (KaTeX web fonts).
    for (const file of styleSheetFiles) {
        const fileResponse = await fetch(`${origin}/${file}`);
        const css = await fileResponse.text();

        for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
            const reference = match[1].trim();

            if (
                !reference ||
                /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
                reference.startsWith("//") ||
                reference.startsWith("#") ||
                reference.startsWith("data:")
            ) {
                continue;
            }

            checkedReferences++;

            const target = reference.startsWith("/")
                ? reference.slice(1)
                : toPosix(path.posix.join(path.posix.dirname(file), reference));

            const { status } = await request(`/${target}`);

            if (status !== 200) {
                failures.push({ file, reference, status });
            }
        }
    }

    await new Promise((resolve) => server.close(resolve));

    return {
        publishedFiles: publishedFiles.length,
        htmlFiles: htmlFiles.length,
        styleSheetFiles: styleSheetFiles.length,
        checkedReferences,
        failures,
        timeoutMs
    };
}

function parseArguments(argumentsList) {
    const options = {
        port: DEFAULT_PORT,
        hasExplicitPort: false,
        open: true,
        logRequests: false,
        check: false
    };

    for (let index = 0; index < argumentsList.length; index++) {
        const argument = argumentsList[index];

        if (argument === "--port") {
            options.port = Number(argumentsList[index + 1]);
            options.hasExplicitPort = true;
            index++;
        } else if (argument === "--no-open") {
            options.open = false;
        } else if (argument === "--log") {
            options.logRequests = true;
        } else if (argument === "--check") {
            options.check = true;
        }
    }

    return options;
}

const isDirectRun =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
    const options = parseArguments(process.argv.slice(2));

    if (options.check) {
        // A link check must never fight with a running dev server.
        const checkPort = options.hasExplicitPort ? options.port : 0;

        runLinkCheck({ port: checkPort })
            .then((result) => {
                console.log(
                    `checked ${result.checkedReferences} references in ${result.htmlFiles} documents and ${result.styleSheetFiles} stylesheets`
                );

                if (result.failures.length > 0) {
                    for (const failure of result.failures) {
                        console.error(
                            `✗ ${failure.file} → ${failure.reference} (${failure.status}${
                                failure.reason ? `, ${failure.reason}` : ""
                            })`
                        );
                    }

                    console.error(`\n${result.failures.length} broken reference(s).`);
                    process.exit(1);
                }

                console.log("✓ every local reference resolves");
            })
            .catch((error) => {
                console.error("Link check failed:", error);
                process.exit(1);
            });
    } else {
        const server = createSiteServer({ logRequests: options.logRequests });

        server.listen(options.port, () => {
            const address = server.address();

            console.log(`Serving ${PROJECT_ROOT}`);
            console.log(`→ http://localhost:${address.port}/`);
            console.log(`Notes live under ${SITE_CONFIG.notesDirectoryName}/<slug>/`);
            console.log("Press Ctrl+C to stop.");
        });
    }
}