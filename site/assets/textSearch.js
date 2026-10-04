/* =========================================================
   Shared search normalization (browser side)
   =========================================================

   Plain classic script — no imports — so it can be loaded directly by
   index.html. Must stay behaviourally identical to site/textUtils.js;
   site/tests/runTests.js compares both implementations on a fixed corpus so the
   two can never silently drift apart.
*/

const BASHLIGH_PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const BASHLIGH_ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const BASHLIGH_LETTER_FOLDING = [
    ["ي", "ی"],
    ["ى", "ی"],
    ["ك", "ک"],
    ["ۀ", "ه"],
    ["ة", "ه"],
    ["ؤ", "و"],
    ["إ", "ا"],
    ["أ", "ا"],
    ["آ", "ا"],
    ["ٱ", "ا"]
];

const BASHLIGH_DIACRITICS_PATTERN = /[ً-ٰٟۖ-ۭـ]/g;

function foldDigits(value) {
    return String(value).replace(/[۰-۹٠-٩]/g, (digit) => {
        const persianIndex = BASHLIGH_PERSIAN_DIGITS.indexOf(digit);

        if (persianIndex !== -1) {
            return String(persianIndex);
        }

        return String(BASHLIGH_ARABIC_DIGITS.indexOf(digit));
    });
}

function normalizeSearchText(value) {
    let normalized = String(value === null || value === undefined ? "" : value);

    normalized = foldDigits(normalized);
    normalized = normalized.toLowerCase();

    for (const pair of BASHLIGH_LETTER_FOLDING) {
        normalized = normalized.split(pair[0]).join(pair[1]);
    }

    normalized = normalized
        .replace(BASHLIGH_DIACRITICS_PATTERN, "")
        .replace(/ـ/g, "")
        .replace(/\u200c/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

    return normalized;
}

function toSearchTerms(query) {
    return normalizeSearchText(query)
        .split(" ")
        .filter((term) => term.length > 0);
}

function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.BashlighSearch = {
    foldDigits,
    normalizeSearchText,
    toSearchTerms,
    escapeHtml
};