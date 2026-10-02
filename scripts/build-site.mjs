// Assembles the publishable site in ./docs from the rendered notes.
//
// A note in renderedNotes/<slug>/index.html refers to shared assets from the
// project root ("../../styles/base.css"), because that is where they sit in the
// repository. The published site keeps the same shape — shared assets at the
// site root, notes under renderedNotes/ — so publishing is a directory rename
// (src/ -> js/, data/assets/ -> assets/, vendored bundles -> vendor/) plus the
// home page, all expressed as one table in siteLib.mjs.
//
//   npm run render   → renderedNotes/ (one folder per note)
//   npm run build    → docs/ (the site that gets deployed)

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    browserScripts,
    renderHomePage,
    rewriteAssetReferences,
    verifySite
} from "./siteLib.mjs";
import { resolveTemplateIncludes } from "../src/templateIncludes.js";

const projectDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    ".."
);

const renderedNotesDirectory = "renderedNotes";

const paths = {
    renderedNotes: join(projectDirectory, renderedNotesDirectory),
    siteDirectory: join(projectDirectory, "docs"),
    styles: join(projectDirectory, "styles"),
    scripts: join(projectDirectory, "src"),
    assets: join(projectDirectory, "data", "assets"),
    katex: join(projectDirectory, "node_modules", "katex", "dist"),
    lucide: join(projectDirectory, "node_modules", "lucide", "dist", "umd"),
    homeTemplate: join(projectDirectory, "templates", "home.html"),
    manifest: join(projectDirectory, renderedNotesDirectory, "notes.json")
};

/**
 * Copy a file or directory into the site.
 *
 * Every asset here is required — a missing stylesheet or script produces a
 * subtly broken page rather than an obvious error — so a missing source is
 * reported instead of skipped.
 */
async function copyRequired(from, to) {
    try {
        await cp(from, to, { recursive: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            const missing = new Error(
                `Cannot publish ${to.slice(projectDirectory.length + 1)}: ` +
                `source not found (${from}). Run \`npm install\` or \`npm run render\` first.`
            );
            missing.code = "MISSING_SOURCE";
            throw missing;
        }

        throw new Error(
            `Cannot publish ${to.slice(projectDirectory.length + 1)}: ${error.message}`
        );
    }
}

async function readManifest() {
    try {
        return JSON.parse(await readFile(paths.manifest, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(
                "renderedNotes/notes.json is missing. Run `npm run render` first."
            );
        }
        throw error;
    }
}

/**
 * Copy a rendered note into the site, repointing its asset references.
 *
 * A note that owns assets keeps them in its own folder so its images travel
 * with it rather than depending on whatever else shares their file name.
 *
 * @param {Object} note - Manifest entry.
 */
async function publishNote(note) {
    const source = join(projectDirectory, note.path);
    const target = join(paths.siteDirectory, note.path);

    const html = await readFile(source, "utf8");

    await mkdir(dirname(target), { recursive: true });
    await writeFile(
        target,
        rewriteAssetReferences(html, note.path),
        "utf8"
    );

    const noteAssets = join(
        projectDirectory,
        renderedNotesDirectory,
        note.slug,
        "assets"
    );

    try {
        await copyRequired(
            noteAssets,
            join(
                paths.siteDirectory,
                renderedNotesDirectory,
                note.slug,
                "assets"
            )
        );
    } catch (error) {
        // Only assets the note claims to own are required; the rest may simply
        // not exist, which the link check below would report if it mattered.
        if (!(error.code === "MISSING_SOURCE")) {
            throw error;
        }
    }
}

async function publishHomePage(notes) {
    const template = await resolveTemplateIncludes(
        await readFile(paths.homeTemplate, "utf8")
    );

    const html = rewriteAssetReferences(
        renderHomePage({ template, notes }),
        "index.html"
    );

    await writeFile(
        join(paths.siteDirectory, "index.html"),
        html,
        "utf8"
    );
}

export async function buildSite() {
    const manifest = await readManifest();

    await rm(paths.siteDirectory, {
        recursive: true,
        force: true
    });
    await mkdir(paths.siteDirectory, { recursive: true });

    // Shared assets, in the same relative position the notes reference them.
    await copyRequired(paths.styles, join(paths.siteDirectory, "styles"));
    await copyRequired(paths.assets, join(paths.siteDirectory, "assets"));

    // Only the browser-side scripts are published; the rest of src/ is the
    // renderer itself and has no place in a static site.
    for (const script of browserScripts) {
        await copyRequired(
            join(paths.scripts, script),
            join(paths.siteDirectory, "js", script)
        );
    }
    await copyRequired(
        join(paths.katex, "katex.min.css"),
        join(paths.siteDirectory, "vendor", "katex", "katex.min.css")
    );
    await copyRequired(
        join(paths.katex, "fonts"),
        join(paths.siteDirectory, "vendor", "katex", "fonts")
    );
    await copyRequired(
        join(paths.lucide, "lucide.min.js"),
        join(paths.siteDirectory, "vendor", "lucide.min.js")
    );

    await publishHomePage(manifest.notes);

    for (const note of manifest.notes) {
        await publishNote(note);
    }

    // The manifest travels with the site: it is a ready-made index of every
    // note and a convenient thing to link to from the home page.
    await cp(paths.manifest, join(paths.siteDirectory, "renderedNotes", "notes.json"));

    await writeFile(join(paths.siteDirectory, ".nojekyll"), "", "utf8");

    const { errors, checkedFiles } = await verifySite(
        paths.siteDirectory
    );

    if (errors.length > 0) {
        console.error(
            `Site build failed verification (${errors.length} problem(s)) in ${checkedFiles} page(s):`
        );
        for (const error of errors) {
            console.error(`  - ${error}`);
        }
        throw new Error("Built site did not pass verification.");
    }

    return {
        noteCount: manifest.notes.length,
        checkedFiles
    };
}

const invokedDirectly =
    process.argv[1] &&
    resolve(process.argv[1]) ===
        resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
    buildSite()
        .then(({ noteCount, checkedFiles }) => {
            console.log(
                `Site built in ./docs — ${noteCount} note(s), ${checkedFiles} page(s) verified.`
            );
        })
        .catch((error) => {
            console.error(error.message ?? error);
            process.exit(1);
        });
}