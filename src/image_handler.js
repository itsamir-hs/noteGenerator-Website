// Normalizes Markdown image paths so generated notes can resolve local assets correctly.

export function resolveImagePath(imagePath) {
    if (
        imagePath.startsWith("http://") ||
        imagePath.startsWith("https://") ||
        imagePath.startsWith("/")
    ) {
        return imagePath;
    }

    return `../data/assets/${imagePath}`;
}
