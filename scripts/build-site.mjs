// Publishes the rendered notes from ./output as a flat, GitHub Pages ready
// site in ./docs.
//
// The generator writes every page for a nested folder layout: it references
// ../styles, ../src, ../node_modules and ../data/assets. Serving those pages from
// a site root breaks all of them, so this script rewrites each reference to a
// self-contained path and copies the assets it points at (stylesheets, browser
// scripts, KaTeX css + fonts, Lucide, note images) into ./docs.

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(projectDir, "output");
const siteDir = join(projectDir, "docs");

const sourceFiles = {
    styles: join(projectDir, "styles"),
    scripts: join(projectDir, "src"),
    assets: join(projectDir, "data", "assets"),
    katex: join(projectDir, "node_modules", "katex", "dist"),
    lucide: join(projectDir, "node_modules", "lucide", "dist", "umd")
};

// Every reference the template emits, mapped to its published location.
const pathRewrites = [
    ["../node_modules/katex/dist/katex.min.css", "vendor/katex/katex.min.css"],
    ["../node_modules/lucide/dist/umd/lucide.js", "vendor/lucide.min.js"],
    ["../styles/", "styles/"],
    ["../src/", "js/"],
    ["../data/assets/", "assets/"]
];

// Source modules that run under Node (ESM imports / node: builtins) and must not
// be copied into the browser bundle. Everything else in src/ is a plain
// <script> and is published verbatim.
const isBrowserScript = (source) =>
    !/^\s*(?:import|export)\s/m.test(source) && !/from\s+["']node:/.test(source);

function rewriteReferences(html) {
    let rewritten = html;

    for (const [from, to] of pathRewrites) {
        rewritten = rewritten.split(from).join(to);
    }

    return rewritten;
}

function assertSelfContained(fileName, html) {
    const broken = [...new Set(html.match(/(?:\.\.\/|node_modules\/)[^"'()\s>]+/g) ?? [])];

    if (broken.length > 0) {
        throw new Error(
            `${fileName} still references unpublished paths: ${broken.join(", ")}`
        );
    }
}

function titleOf(html, fallback) {
    const match = html.match(/<title>([^<]*)<\/title>/);

    return match && match[1].trim() !== "" ? match[1].trim() : fallback;
}

function encodeHref(fileName) {
    return fileName.split("/").map(encodeURIComponent).join("/");
}

function renderNotesIndex(notes) {
    const items = notes
        .map((note) => {
            const date = note.modifiedAt
                .toISOString()
                .slice(0, 10);

            return `                <li>
                    <a href="./${encodeHref(note.fileName)}">
                        <span class="noteTitle">${note.title}</span>
                        <span class="noteMeta" dir="ltr">${note.fileName} &middot; ${date}</span>
                    </a>
                </li>`;
        })
        .join("\n");

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">

<head>
    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>جزوه‌ها</title>

    <style>
        :root {
            color-scheme: light dark;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 48px 20px;

            font-family: "Vazirmatn", "Segoe UI", Tahoma, sans-serif;

            background: #f6f7f9;
            color: #1f2933;
        }

        main {
            max-width: 760px;
            margin: 0 auto;
        }

        h1 {
            margin: 0 0 8px;

            font-size: 28px;
        }

        p.subtitle {
            margin: 0 0 28px;

            color: #52606d;
        }

        ul {
            margin: 0;
            padding: 0;

            list-style: none;
        }

        li + li {
            margin-top: 12px;
        }

        a {
            display: block;
            padding: 18px 20px;

            border: 1px solid #dfe3e8;
            border-radius: 14px;

            background: #ffffff;

            color: inherit;
            text-decoration: none;

            box-shadow: 0 1px 2px rgb(15 23 42 / 6%);

            transition: border-color 0.15s ease, transform 0.15s ease;
        }

        a:hover {
            border-color: #7aa2f7;

            transform: translateY(-2px);
        }

        .noteTitle {
            display: block;

            font-size: 17px;
            font-weight: 700;
        }

        .noteMeta {
            display: block;
            margin-top: 6px;

            font-size: 13px;
            color: #7b8794;
        }

        footer {
            margin-top: 28px;

            font-size: 13px;
            color: #7b8794;
        }

        @media (prefers-color-scheme: dark) {
            body {
                background: #14161a;
                color: #e6e8ec;
            }

            p.subtitle,
            .noteMeta,
            footer {
                color: #9aa4b2;
            }

            a {
                border-color: #2a2f37;
                background: #1c1f24;
                box-shadow: none;
            }

            a:hover {
                border-color: #4c7bd9;
            }
        }
    </style>
</head>

<body>

    <main>
        <h1>جزوه‌ها</h1>

        <p class="subtitle">
            فهرست جزوه‌های منتشرشده
        </p>

        <ul>
${items}
        </ul>

        <footer>
            ساخته‌شده با جزوه‌ساز
        </footer>
    </main>

</body>

</html>
`;
}

async function copyIfExists(from, to) {
    try {
        await stat(from);
    } catch {
        return false;
    }

    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: true });

    return true;
}

async function collectBrowserScripts() {
    const entries = await readdir(sourceFiles.scripts, { withFileTypes: true });
    const scripts = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

        const source = await readFile(join(sourceFiles.scripts, entry.name), "utf8");

        if (isBrowserScript(source)) {
            scripts.push(entry.name);
        }
    }

    return scripts;
}

async function buildSite() {
    const htmlFiles = (await readdir(outputDir))
        .filter((name) => name.endsWith(".html"))
        .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));

    if (htmlFiles.length === 0) {
        throw new Error("No HTML files found in ./output — render a note first (npm run render).");
    }

    await rm(siteDir, { recursive: true, force: true });
    await mkdir(siteDir, { recursive: true });

    const notes = [];

    for (const fileName of htmlFiles) {
        const source = await readFile(join(outputDir, fileName), "utf8");
        const html = rewriteReferences(source);

        assertSelfContained(fileName, html);

        await writeFile(join(siteDir, fileName), html, "utf8");

        notes.push({
            fileName,
            title: titleOf(html, fileName),
            modifiedAt: (await stat(join(outputDir, fileName))).mtime
        });
    }

    await copyIfExists(sourceFiles.styles, join(siteDir, "styles"));

    const browserScripts = await collectBrowserScripts();

    for (const scriptName of browserScripts) {
        await copyIfExists(
            join(sourceFiles.scripts, scriptName),
            join(siteDir, "js", scriptName)
        );
    }

    await copyIfExists(join(sourceFiles.katex, "katex.min.css"), join(siteDir, "vendor", "katex", "katex.min.css"));
    await copyIfExists(join(sourceFiles.katex, "fonts"), join(siteDir, "vendor", "katex", "fonts"));
    await copyIfExists(join(sourceFiles.lucide, "lucide.min.js"), join(siteDir, "vendor", "lucide.min.js"));
    await copyIfExists(sourceFiles.assets, join(siteDir, "assets"));

    await writeFile(join(siteDir, "notes.html"), renderNotesIndex(notes), "utf8");
    await writeFile(join(siteDir, ".nojekyll"), "", "utf8");

    console.log(`Site built in ./docs (${notes.length} note(s), ${browserScripts.length} script(s)).`);
}

buildSite().catch((error) => {
    console.error("Site build failed:");
    console.error(error);
    process.exit(1);
});