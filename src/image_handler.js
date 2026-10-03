// Normalizes Markdown image paths so generated notes can resolve local assets correctly.

/**
 * References that name their own destination and must be left alone.
 *
 * Note that a leading "/" is *not* in this list. On a project page served from
 * `https://someone.github.io/project/`, "/logo.png" would resolve to
 * `https://someone.github.io/logo.png` — outside the site entirely — so a
 * leading slash is read as "from the top of my own assets" instead.
 */
const externalImagePattern =
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Flatten a local asset reference.
 *
 * "." and ".." segments are dropped so a note cannot walk out of the asset
 * library: `../../etc/passwd` becomes `etc/passwd`, which then fails the build's
 * link check loudly instead of 404ing quietly on a published page.
 *
 * A leading `assets/` — or the whole `data/assets/` prefix — is dropped too.
 * Notes in the wild write images several ways: `![…](figure.png)`,
 * `![…](assets/figure.png)`, and even `![…](../../data/assets/figure.png)`.
 * For a long time only the second form worked, because the repository carried
 * a duplicate copy of every image under `data/assets/assets/`. Accepting all of
 * them means the duplicate is not needed, and which form an author uses stops
 * mattering.
 *
 * @param {string} imagePath - Path as written in the Markdown.
 * @returns {string} Path relative to the asset library.
 */
function normalizeAssetPath(imagePath) {
    const segments = imagePath
        .split("/")
        .filter(
            (segment) =>
                segment !== "" &&
                segment !== "." &&
                segment !== ".."
        );

    if (
        segments[0] === "data" &&
        segments[1] === "assets"
    ) {
        segments.splice(0, 2);
    } else if (segments[0] === "assets") {
        segments.shift();
    }

    return segments.join("/");
}

/**
 * Resolve a Markdown image reference against the note's location.
 *
 * Absolute URLs are left alone; everything else is treated as a local asset
 * inside `data/assets/`, reached by walking back up from wherever the note is
 * written to.
 *
 * @param {string} imagePath - Path as written in the Markdown.
 * @param {string} [assetPrefix="../"] - Relative prefix for local assets.
 * @returns {string} Path to use in the rendered `src` attribute.
 */
export function resolveImagePath(
    imagePath,
    assetPrefix = "../"
) {
    if (externalImagePattern.test(imagePath)) {
        return imagePath;
    }

    const normalized = normalizeAssetPath(imagePath);

    if (normalized === "") {
        // Nothing usable was left after flattening; leave the reference as it
        // was so the failure points at the original text.
        return imagePath;
    }

    return `${assetPrefix}data/assets/${normalized}`;
}