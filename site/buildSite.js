// Site build entry point.
//
//   node site/buildSite.js              → full build
//   node site/buildSite.js --render     → run the original renderer first, then build
//   node site/buildSite.js --keep       → keep existing notes/ and only add/refresh
//   node site/buildSite.js --no-storage-scope
//
// Steps:
//   1. vendor third-party assets (KaTeX + Lucide) out of node_modules
//   2. rebuild notes/<slug>/index.html from
//        content/notes/*.md            (rendered through src/main.js)
//        content/pre-rendered/*.html   (imported as they are)
//        output/*.html                 (whatever `node src/main.js` produced)
//   3. generate the home page (index.html) with the notes menu and search
//   4. write site/notes.generated.json (build artefact used by the tests)
//
// Nothing inside src/, styles/, templates/, config/ or data/ is modified. With
// --render the original CLI is *executed*, never edited: it still reads
// data/input/note.md and writes output/index.html, and the build then imports
// that file like any other pre-rendered note.
//
// Removing a note: node site/removeNote.js <slug>

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { SITE_CONFIG } from "./config.js";
import { PROJECT_ROOT, toAbsolute } from "./paths.js";
import { syncVendorAssets } from "./vendorAssets.js";
import { buildAllNotes, resetNotesDirectory } from "./notesBuilder.js";
import { readRegistry } from "./registry.js";
import { writeHomePage } from "./homePage.js";

const runCommand = promisify(execFile);

const KEEP_FLAG = "--keep";
const RENDER_FLAG = "--render";
const NO_STORAGE_SCOPE_FLAG = "--no-storage-scope";

function logMessage(message) {
    console.log(message);
}

/**
 * Run the note renderer's own CLI (src/main.js) untouched, so
 * `node site/buildSite.js --render` behaves exactly like
 * "put the markdown in data/input/note.md → node src/main.js".
 */
async function renderWithOriginalModule(log) {
    const entryPath = toAbsolute("src/main.js");

    log("▸ Rendering with the original module (node src/main.js)");

    try {
        const { stdout, stderr } = await runCommand(
            process.execPath,
            [entryPath],
            { cwd: PROJECT_ROOT }
        );

        if (stdout.trim()) {
            log(`    ${stdout.trim()}`);
        }

        if (stderr.trim()) {
            log(`    ${stderr.trim()}`);
        }
    } catch (error) {
        throw new Error(
            `The original renderer failed:\n${error.stdout ?? ""}${
                error.stderr ?? ""
            }${error.message}`
        );
    }
}

async function loadRendererInputs() {
    const template = await readFile(
        toAbsolute("templates/note.html"),
        "utf8"
    );

    const rendererConfig = JSON.parse(
        await readFile(
            toAbsolute("config/renderer_config.json"),
            "utf8"
        )
    );

    return { template, rendererConfig };
}

export async function buildSite({
    keepExistingNotes = false,
    renderFirst = false,
    enableStorageScoping = SITE_CONFIG.enableStorageScoping,
    quiet = false
} = {}) {
    const log = quiet ? () => {} : logMessage;

    if (renderFirst) {
        await renderWithOriginalModule(log);
    }

    log("▸ Vendoring third-party assets");
    const vendorResults = await syncVendorAssets();

    for (const result of vendorResults) {
        log(`    ${result.target} — ${result.result}`);
    }

    const { template, rendererConfig } = await loadRendererInputs();

    if (!keepExistingNotes) {
        log("▸ Resetting notes/");
        await resetNotesDirectory();
    }

    log("▸ Building notes");
    const registry = await readRegistry();
    const { notes, issues } = await buildAllNotes({
        template,
        rendererConfig,
        registry,
        enableStorageScoping
    });

    for (const note of notes) {
        log(
            `    notes/${note.slug}/  (${note.source.kind}) — ${note.title}`
        );
    }

    for (const issue of issues) {
        const prefix = issue.level === "warn" ? "    ⚠" : "    ·";

        log(`${prefix} ${issue.source}: ${issue.message}`);
    }

    log("▸ Generating home page");
    const homePagePath = await writeHomePage(notes);

    const generatedIndex = {
        generatedBy: "site/buildSite.js",
        noteCount: notes.length,
        visibleNoteCount: notes.filter((note) => !note.hidden).length,
        issues,
        notes: notes.map((note) => ({
            ...note,
            url: path.posix.join(SITE_CONFIG.notesDirectoryName, note.slug, "")
        }))
    };

    const generatedIndexPath = toAbsolute(
        SITE_CONFIG.generatedIndexFilePath
    );

    await writeFile(
        generatedIndexPath,
        `${JSON.stringify(generatedIndex, null, 2)}\n`,
        "utf8"
    );

    log("▸ Done");
    log(`    home page      : ${path.relative(PROJECT_ROOT, homePagePath)}`);
    log(`    notes index    : ${SITE_CONFIG.generatedIndexFilePath}`);
    log(`    notes published: ${generatedIndex.visibleNoteCount}`);

    return { notes, vendorResults, issues, generatedIndex };
}

const isDirectRun =
    process.argv[1] &&
    path.resolve(process.argv[1]) === toAbsolute("site/buildSite.js");

if (isDirectRun) {
    buildSite({
        keepExistingNotes: process.argv.includes(KEEP_FLAG),
        renderFirst: process.argv.includes(RENDER_FLAG),
        enableStorageScoping: !process.argv.includes(NO_STORAGE_SCOPE_FLAG)
    }).catch((error) => {
        console.error("Site build failed:");
        console.error(error);
        process.exit(1);
    });
}