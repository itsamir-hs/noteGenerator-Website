// Text helpers shared by the build (search index) and the home page (search box).
//
// Persian notes mix Persian digits, Arabic ی/ک, ZWNJ and diacritics heavily, so
// a naive `indexOf` search misses almost every match. Everything is folded to a
// single canonical form first.

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const LETTER_FOLDING = [
    // Arabic letter variants that must behave exactly like their Persian form.
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

// Arabic diacritics / tashkeel and the zero-width non-joiner.
const DIACRITICS_PATTERN = /[ً-ٰٟۖ-ۭـ]/g;

/** Convert every digit flavour to ASCII digits. */
export function foldDigits(value) {
    return String(value).replace(/[۰-۹٠-٩]/g, (digit) => {
        const persianIndex = PERSIAN_DIGITS.indexOf(digit);

        if (persianIndex !== -1) {
            return String(persianIndex);
        }

        return String(ARABIC_DIGITS.indexOf(digit));
    });
}

/**
 * Canonical, case/punctuation-insensitive form used for indexing and matching.
 * The result is never shown to the user — it only powers matching.
 */
export function normalizeSearchText(value) {
    let normalized = String(value ?? "");

    normalized = foldDigits(normalized);
    normalized = normalized.toLowerCase();

    for (const [from, to] of LETTER_FOLDING) {
        normalized = normalized.split(from).join(to);
    }

    normalized = normalized
        .replace(DIACRITICS_PATTERN, "")
        .replace(/ـ/g, "")
        .replace(/‌/g, " ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

    return normalized;
}

/** Split a query the way a reader would expect: on whitespace, after folding. */
export function toSearchTerms(query) {
    return normalizeSearchText(query)
        .split(" ")
        .filter((term) => term.length > 0);
}

/** True when every term appears in the normalized haystack. */
export function matchesTerms(normalizedHaystack, terms) {
    return terms.every((term) => normalizedHaystack.includes(term));
}

/** Collapse whitespace so extracted titles stay single-line. */
export function toSingleLine(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Strip every HTML tag and decode the few entities the renderer emits. */
export function toPlainText(htmlFragment) {
    return String(htmlFragment ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

/** Escape a value for safe interpolation into HTML text or an attribute. */
export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Escape a value for embedding inside a <script type="application/json"> block.
 * Angle brackets are emitted as < / > escapes so the payload can never close
 * the tag early nor start a new element.
 */
export function escapeJsonForScript(jsonText) {
    return String(jsonText)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/** Convert Persian/Arabic digits to ASCII (used for filesystem-friendly ids). */
export function toAsciiDigits(value) {
    return foldDigits(value);
}