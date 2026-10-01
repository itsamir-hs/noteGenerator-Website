// Normalizes Markdown image paths so generated notes can resolve local assets correctly.

/**
 * Resolve a Markdown image reference against the note's location.
 *
 * Absolute URLs and root-relative paths are left alone; everything else is
 * treated as a local asset inside `data/assets/`, reached by walking back up
 * from wherever the note is written to.
 *
 * @param {string} imagePath - Path as written in the Markdown.
 * @param {string} [assetPrefix="../"] - Relative prefix for local assets.
 * @returns {string} Path to use in the rendered `src` attribute.
 */
export function resolveImagePath(
    imagePath,
    assetPrefix = "../"
) {
    if (
        imagePath.startsWith("http://") ||
        imagePath.startsWith("https://") ||
        imagePath.startsWith("/")
    ) {
        return imagePath;
    }

    return `${assetPrefix}data/assets/${imagePath}`;
}