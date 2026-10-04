/* Builds the site home page (index.html).

   The home page deliberately re-uses the note module's own stylesheets and its
   `src/themeSwitcher.js`, so `data-theme` and the `noteTheme` localStorage key
   behave exactly like they do inside a note.

   The notes index is baked into the document as JSON instead of being fetched:
   it keeps the page working from `file://`, from a project sub-path on GitHub
   Pages, and behind any static file server without extra configuration. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SITE_CONFIG } from "./config.js";
import { toAbsolute } from "./paths.js";
import { escapeHtml, escapeJsonForScript, toSingleLine } from "./textUtils.js";

function createThemeButtons() {
    return SITE_CONFIG.themes
        .map((theme) => {
            return `
                    <button
                        class="themeButton"
                        type="button"
                        data-theme="${escapeHtml(theme.key)}"
                        aria-label="${escapeHtml(theme.label)}"
                    >
                        <i data-lucide="${escapeHtml(theme.icon)}"></i>
                    </button>
            `;
        })
        .join("");
}

function createContributorCards() {
    return SITE_CONFIG.contributors
        .map((contributor) => {
            return `
                <article class="developerCard">
                    <h3>${escapeHtml(contributor.name)}</h3>
                    <p>${escapeHtml(contributor.role)}</p>
                </article>
            `;
        })
        .join("");
}

/**
 * Metadata line under the card title (course / topic / instructor / date).
 *
 * Values are wrapped in <bdi> so a Latin or ISO date keeps its own direction
 * inside the RTL card instead of being reordered by the bidi algorithm.
 */
function createCardMeta(note) {
    const items = [
        note.course ? { label: "درس", value: note.course } : null,
        note.topic && note.topic !== note.course && note.topic !== note.title
            ? { label: "مبحث", value: note.topic }
            : null,
        note.instructor ? { label: "استاد", value: note.instructor } : null,
        note.sessionDate || note.generatedDate
            ? { label: "تاریخ", value: note.sessionDate || note.generatedDate }
            : null
    ].filter(Boolean);

    if (items.length === 0) {
        return "";
    }

    const markup = items
        .map(
            (item) =>
                `<span class="noteCardMetaItem"><span class="noteCardMetaLabel">${escapeHtml(
                    item.label
                )}:</span> <bdi>${escapeHtml(item.value)}</bdi></span>`
        )
        .join("");

    return `<div class="noteCardMeta">${markup}</div>`;
}

function createSourceBadge() {
    // Kept as an explicit no-op: the home page deliberately shows neither the
    // note's source kind ("پیش‌رندر شده") nor category tags.
    return "";
}

/**
 * Render one note card.
 *
 * `searchText` is *not* rendered: it stays in the JSON index so the browser can
 * match it, while the visible markup only ever contains the real title,
 * description and metadata.
 */
function createNoteCard(note) {
    const title = toSingleLine(note.title);
    const description = toSingleLine(note.description);

    const heading = description
        ? `${escapeHtml(title)} — ${escapeHtml(description)}`
        : escapeHtml(title);

    return `
                <a
                    class="noteCard${note.featured ? " isFeatured" : ""}"
                    href="${escapeHtml(note.url)}"
                    data-note-slug="${escapeHtml(note.slug)}"
                    aria-label="${escapeHtml(heading)}"
                >
                    <div class="noteCardHeader">

                        <h3 class="noteCardTitle">
                            ${escapeHtml(title)}
                        </h3>

                        ${createSourceBadge()}
                    </div>

                    ${createCardMeta(note)}

                    ${description ? `<p class="noteCardDescription">${escapeHtml(description)}</p>` : ""}

                    <span class="noteCardAction">
                        <i data-lucide="book-open"></i>
                        <span>خواندن جزوه</span>
                    </span>
                </a>
            `;
}

function createNotesCountLabel(visibleNotes) {
    return `${visibleNotes.toLocaleString("fa-IR")} جزوه`;
}

/** Replace every `{{placeholder}}` in the home template. */
function applyTemplate(template, replacements) {
    let output = template;

    for (const [key, value] of Object.entries(replacements)) {
        output = output.replace(
            new RegExp(`\\{\\{${key}\}\\}`, "g"),
            value ?? ""
        );
    }

    return output;
}

/**
 * Generate the home page HTML.
 *
 * @param {Array} notes - Note entries from the build.
 * @returns {Promise<string>} the finished HTML.
 */
export async function renderHomePage(notes) {
    const template = await readFile(
        toAbsolute(SITE_CONFIG.homeTemplatePath),
        "utf8"
    );

    const visibleNotes = notes.filter((note) => !note.hidden);

    const searchIndex = visibleNotes.map((note) => ({
        slug: note.slug,
        title: note.title,
        description: note.description,
        course: note.course,
        topic: note.topic,
        instructor: note.instructor,
        url: note.url,
        searchText: note.searchText
    }));

    const replacements = {
        siteTitle: escapeHtml(SITE_CONFIG.title),
        siteTagline: escapeHtml(SITE_CONFIG.tagline),
        siteDescription: escapeHtml(SITE_CONFIG.tagline),
        defaultTheme: escapeHtml(SITE_CONFIG.defaultTheme),
        searchPlaceholder: escapeHtml(SITE_CONFIG.searchPlaceholder),
        emptySearchResultMessage: escapeHtml(SITE_CONFIG.emptySearchResultMessage),
        notesMenuTitle: escapeHtml(SITE_CONFIG.notesMenuTitle),
        notesCountLabel: escapeHtml(createNotesCountLabel(visibleNotes.length)),
        contributorsButtonLabel: escapeHtml(SITE_CONFIG.contributorsButtonLabel),
        contributorsModalTitle: escapeHtml(SITE_CONFIG.contributorsModalTitle),
        contributorsIntroduction: escapeHtml(SITE_CONFIG.contributorsIntroduction),
        contributorsFooter: escapeHtml(SITE_CONFIG.contributorsFooter),
        themeButtons: createThemeButtons(),
        contributorCards: createContributorCards(),
        noteCards: visibleNotes.map((note) => createNoteCard(note)).join(""),
        notesJson: escapeJsonForScript(JSON.stringify(searchIndex)),
        themeSwitcherScriptPath: SITE_CONFIG.themeSwitcherScriptPath,
        homeScriptPath: SITE_CONFIG.homeScriptPath
    };

    return applyTemplate(template, replacements);
}

/** Generate the home page and write it to the project root. */
export async function writeHomePage(notes) {
    const html = await renderHomePage(notes);
    const outputPath = toAbsolute(SITE_CONFIG.homePageFileName);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, "utf8");

    return outputPath;
}