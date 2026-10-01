// Serves ./docs locally so the published site can be checked before pushing.
//
//   npm run serve        → http://localhost:8000
//   npm run serve -- 8080

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(projectDir, "docs");

const port = Number(process.argv[2]) || 8000;

const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};

const server = createServer(async (request, response) => {
    const requestedPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relativePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(siteDir, relativePath);

    try {
        if ((await stat(filePath)).isDirectory()) {
            filePath = join(filePath, "index.html");
            await stat(filePath);
        }

        response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
        createReadStream(filePath).pipe(response);
    } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
    }
});

server.listen(port, () => {
    console.log(`Serving ./docs at http://localhost:${port}`);
});