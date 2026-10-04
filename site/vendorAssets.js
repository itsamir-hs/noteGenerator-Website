// Copies the third-party browser assets the note template depends on out of
// node_modules and into `vendor/`, so the published GitHub Pages site is fully
// self-contained and never needs node_modules committed.

import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { SITE_CONFIG } from "./config.js";
import { toAbsolute } from "./paths.js";

/** Copy a file only when the destination is missing or stale. */
async function copyFileIfChanged(sourcePath, destinationPath) {
    const [sourceStats, destinationStats] = await Promise.all([
        stat(sourcePath),
        stat(destinationPath).catch(() => null)
    ]);

    if (
        destinationStats &&
        destinationStats.size === sourceStats.size &&
        destinationStats.mtimeMs >= sourceStats.mtimeMs
    ) {
        return "unchanged";
    }

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);

    return "copied";
}

/** Recursively copy a directory (used for the KaTeX web fonts). */
async function copyDirectory(sourceDirectory, destinationDirectory) {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });

    let copiedFiles = 0;

    for (const entry of entries) {
        const sourcePath = path.join(sourceDirectory, entry.name);
        const destinationPath = path.join(destinationDirectory, entry.name);

        if (entry.isDirectory()) {
            copiedFiles += await copyDirectory(sourcePath, destinationPath);
            continue;
        }

        const result = await copyFileIfChanged(sourcePath, destinationPath);

        if (result === "copied") {
            copiedFiles++;
        }
    }

    return copiedFiles;
}

/**
 * Sync every vendored asset.
 * @returns {Promise<Array<{target: string, result: string}>>}
 */
export async function syncVendorAssets() {
    const results = [];

    for (const asset of SITE_CONFIG.vendorAssets) {
        const sourcePath = toAbsolute(asset.from);
        const destinationPath = toAbsolute(asset.to);

        let sourceStats;

        try {
            sourceStats = await stat(sourcePath);
        } catch {
            throw new Error(
                `Missing vendor source "${asset.from}". Run \`npm install\` first.`
            );
        }

        if (asset.isDirectory) {
            if (!sourceStats.isDirectory()) {
                throw new Error(`Expected a directory at "${asset.from}".`);
            }

            await mkdir(destinationPath, { recursive: true });

            const copiedFiles = await copyDirectory(sourcePath, destinationPath);

            results.push({
                target: asset.to,
                result: copiedFiles > 0 ? `copied (${copiedFiles} files)` : "unchanged"
            });

            continue;
        }

        if (!sourceStats.isFile()) {
            throw new Error(`Expected a file at "${asset.from}".`);
        }

        const result = await copyFileIfChanged(sourcePath, destinationPath);

        results.push({ target: asset.to, result });
    }

    return results;
}