<div align="right">

# جزوه‌ساز — Note Renderer

**Turns structured educational Markdown into a readable, responsive, themeable
HTML lecture note — and publishes a whole library of them as a static site.**

[![Pages](https://img.shields.io/badge/site-live-4c8d2c)](https://itsamir-hs.github.io/noteGenerator-Website/)
[![Tests](https://img.shields.io/badge/tests-18%20passing-2ea043)](#tests)
[![License](https://img.shields.io/badge/license-ISC-blue)](#license)

</div>

---

## Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [Quick start](#quick-start)
- [How a note is authored](#how-a-note-is-authored)
- [Project layout](#project-layout)
- [Output layout](#output-layout)
- [The npm scripts](#the-npm-scripts)
- [Notes without a source file](#notes-without-a-source-file)
- [Rendering as a library](#rendering-as-a-library)
- [Themes](#themes)
- [How publishing works](#how-publishing-works)
- [Tests](#tests)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

Feed it a Markdown lecture note and it produces a single self-contained HTML
page: right-to-left Persian typography, KaTeX formulas, a generated table of
contents, sticky notes, text search, highlighting, five themes, and a print
stylesheet.

One note is one HTML file. A whole *library* of notes is a folder per note plus
a home page that lists them, so a course, a semester or a personal study archive
can all live at the same address.

The site it produces is plain static files — no framework, no runtime, no
server. It is published with GitHub Pages.

---

## Features

### Content

| | |
|---|---|
| Markdown → HTML | via [marked](https://marked.js.org/), output sanitised with [DOMPurify](https://github.com/cure53/DOMPurify) |
| Persian & RTL | `dir="rtl"`, RTL-aware layout, Latin text and code kept LTR |
| Mathematics | `$inline$` and `$$display$$` rendered by [KaTeX](https://katex.org/) |
| Tables | styled in every theme |
| Code blocks | fenced blocks with language classes |
| Images | resolved from `data/assets/`, and a path prefix that works from any folder depth |
| Callout boxes | `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]`, `> [!NOTE]`, `> [!CAUTION]`, `> [!EXAMPLE]`, `> [!DEFINITION]`, `> [!KEY-POINT]`, `> [!EXAM-TIP]`, `> [!REVIEW]` |
| Definition boxes | detected from `> **تعریف…**` blocks and from definition sections |
| Ten sections | matched to a fixed template, with a positional fallback so a renamed heading never silently drops content |

### Reading

- **Table of contents** in a sidebar, generated from `h2`/`h3`, with sub-items styled
- **Quick navigation** rail that tracks the section you are reading
- **Search** (`Ctrl`/`Cmd` + `F`) with match count, next/previous and highlighting
- **Highlighting** in eight colours, plus a custom colour, stored per note
- **Sticky notes** you can create, drag, resize, delete and come back to — stored per note
- **Font size** control
- **Back to top**, revealed after scrolling
- **Print stylesheet** that drops the whole interface and prints the note

### Per note, not per site

A note's highlights, sticky notes and scroll position are namespaced with its
own slug, so switching notes never leaks one note's state into another. Theme
and font size *are* shared, because those are yours, not the note's.

---

## Quick start

```bash
git clone https://github.com/itsamir-hs/noteGenerator-Website.git
cd noteGenerator-Website
npm install
npm run site      # render every note, then build the site
npm run serve     # preview at http://localhost:8000
```

That is the whole loop. Add a `.md` file to `data/input/`, run `npm run site`,
and the new note appears on the home page.

---

## How a note is authored

A note is a Markdown file. The H1 is its title, and the lines directly beneath
it are its metadata:

```markdown
# اصول کلی ایمنی و بهداشت آزمایشگاه

**درس:** ایمنی و بهداشت آزمایشگاه
**مبحث:** اصول کلی ایمنی و بهداشت فضا، کارکنان و محیط آزمایشگاه
**استاد:** دکتر …
**تاریخ جلسه:** 1405/07/10
**تاریخ تولید جزوه:** 2026-10-01T18:37:36
**نامک:** lab-safety

## ۱. مقدمه و کلیات
```

| Field | Meaning | Required |
|---|---|---|
| `درس` | Course — shown in the header and on the home page | no |
| `مبحث` | Topic — used to derive the folder name | no |
| `استاد` | Instructor | no |
| `تاریخ جلسه` | Session date | no |
| `تاریخ تولید جزوه` | When the note was generated | no |
| `نامک` | **Explicit folder name.** Set this when you want a short ASCII URL. | no |

The folder a note is published under is resolved in this order: `نامک`, then
`مبحث`, then `درس`, then the H1 title. Slugs keep the letters of their script,
so a Persian title gives a Persian folder; punctuation and spaces are dropped
and the name is capped at 48 characters. Two notes that resolve to the same
folder get `-2`, `-3` suffixes rather than overwriting each other.

---

## Project layout

```text
.
├── data/
│   ├── input/            ← your notes go here (Markdown)
│   ├── imported/         ← notes rendered elsewhere, kept as HTML
│   └── assets/           ← images and the favicon notes reference
├── renderedNotes/        ← output: one folder per note, each with index.html
│   └── notes.json        ← manifest: every note, in order
├── docs/                 ← output: the publishable site
│   ├── index.html        ← the home page
│   └── renderedNotes/    ← one folder per note
├── templates/
│   ├── note.html         ← note document template
│   └── home.html         ← home page template
├── styles/               ← base, theme, responsive, RTL, home
├── src/                  ← renderer (Node) and browser scripts
├── scripts/              ← site build, verification, local preview
├── tests/                ← fixtures and assertions
└── config/renderer_config.json
```

`renderedNotes/` and `docs/` are build output. Both are committed so the site
is browsable and deployable straight from the repository, and both are
regenerated from `data/` by `npm run site`.

---

## Output layout

```text
renderedNotes/
├── سیستم-عصبی/
│   └── index.html
├── bone-marrow-on-a-chip/
│   └── index.html
└── notes.json
```

Every note is a folder containing an `index.html`, which is what makes
`/renderedNotes/<slug>/` a clean URL and leaves room for a note to grow its own
assets later.

---

## The npm scripts

| Script | What it does |
|---|---|
| `npm run render` | Renders every source in `data/input/` and `data/imported/` into `renderedNotes/<slug>/index.html`, and writes `renderedNotes/notes.json` |
| `npm run build` | Publishes the site into `docs/`: home page, notes, styles, scripts, KaTeX, images — then verifies it |
| `npm run site` | `render` followed by `build` |
| `npm test` | Runs the test suite |
| `npm run serve` | Serves `docs/` at `http://localhost:8000` for a local preview |

`npm run build` is also a verifier. It walks every published page, follows every
relative link, and checks each note still carries its stylesheets, KaTeX, Lucide,
storage helper, search panel, sticky-note layer, highlight switcher, table of
contents and back-to-top button. A template edit that drops a script fails the
build instead of shipping a quietly broken page.

---

## Notes without a source file

Some notes in this library were rendered by a toolchain that is not in this
repository. Rather than lose them, they live in `data/imported/` as finished
HTML and are carried into the site as-is — only re-pointed at this site's
assets, given their slug, and given the same navigation as everything else.

**The file name is the URL.** Renaming `data/imported/bone-marrow-on-a-chip.html`
changes the folder the note is published under, which is how you claim an
address for a note that has no Markdown source.

---

## Rendering as a library

`renderNoteHtml` is the single rendering entry point, so another tool produces
byte-for-byte the same document instead of a second, drifting implementation.

```js
import { readFile } from "node:fs/promises";
import { renderNoteHtml } from "./src/main.js";

const { html, title, metadata, tocItems } = renderNoteHtml(
    await readFile("./data/input/note.md", "utf8"),
    {
        template: await readFile("./templates/note.html", "utf8"),
        rendererConfig: { theme: "light", language: "fa", enableMath: true },

        // Where the note will be written decides how assets are referenced.
        // "../" for a flat folder, "../../" for renderedNotes/<slug>/.
        assetPrefix: "../../",

        noteSlug: "lab-safety",
        noteNavigation: "<nav>…</nav>"
    }
);
```

Lower level, if you only want a fragment:

```js
import { renderMarkdown } from "./src/renderer.js";

const html = renderMarkdown(
    markdown,
    { enableMath: true },
    { assetPrefix: "../../" }
);
```

---

## Themes

Five themes, switched by `data-theme` on `<html>` and remembered between
visits:

| Key | Name | File |
|---|---|---|
| `light` | روشن | `styles/base.css` |
| `dark` | تاریک | `styles/dark.css` |
| `forest` | جنگل | `styles/forest.css` |
| `paperLike` | کاغذی | `styles/paperLike.css` |
| `neon` | نئون | `styles/neon.css` |

A theme name that does not match one of these — including a wrong-case one like
`paperlike` — falls back to `light` instead of rendering with no palette at all.
Adding a theme means a stylesheet, a `<link>` in both templates, and a button.

---

## How publishing works

```text
data/input/*.md  ──┐
                   ├──►  npm run render  ──►  renderedNotes/<slug>/index.html
data/imported/  ──┘                             renderedNotes/notes.json
                                                          │
                                                          ▼
                                                  npm run build
                                                          │
                                    ┌─────────────────────┴──────────────────┐
                                    ▼                                        ▼
                         docs/index.html (home)              docs/renderedNotes/<slug>/
```

A note references shared assets from the project root, because that is where
they live in the repository. The published site keeps the same shape — shared
assets at the site root, notes underneath — so publishing is a directory rename
(`src/` → `js/`, `data/assets/` → `assets/`, vendored bundles → `vendor/`)
declared once in `scripts/siteLib.mjs`.

GitHub Actions renders, tests, builds and deploys on every push to `main`:

```text
.github/workflows/pages.yml
```

The live site is at **<https://itsamir-hs.github.io/noteGenerator-Website/>**.
Pages itself is enabled with source *GitHub Actions*; the workflow only deploys,
because a workflow token is not allowed to create the Pages site in the first
place.

---

## Tests

```bash
npm test
```

No test framework — a plain script that throws on failure, so it runs anywhere
Node does and is equally at home in CI.

It covers Markdown rendering per fixture (headings, lists, code, images, math,
tables, RTL, callouts, definition boxes), sanitisation (script tags, event
handler attributes and `javascript:` URLs must not survive), math toggling, note
identity (metadata parsing, slugging, uniqueness, theme names), the rendered
note document (no unresolved placeholders, per-note storage id, asset prefix,
navigation, heading ids), literal `$` substitution, metadata escaping, and site
assembly (path mapping, reference rewriting, the home page).

Add a fixture to `tests/sample_notes/` and declare its expectations in
`expectedContent` or `forbiddenContent` in `tests/testRenderer.js`.

---

## Configuration

`config/renderer_config.json`:

```json
{
    "theme": "light",
    "language": "fa",
    "enableMath": true
}
```

`theme` names one of the five themes above, `enableMath` turns KaTeX on or off.
`language` is carried for the renderer's config shape and is not currently read
by the Markdown pipeline.

---

## Project structure

### The pipeline

```text
Markdown
   │
   ├─► prepareMath / restoreMath   ← $…$ becomes a placeholder, then KaTeX HTML
   ├─► parseMarkdown               ← marked
   ├─► applyCallouts               ► [!TYPE] and definition blocks
   ├─► definition boxes            ► DOM pass over h3s in definition sections
   ├─► DOMPurify                   ← sanitise
   └─► resolveImagePath            ← local images prefixed for this note's depth
   │
   ▼
tableOfContents                    ← stable heading ids
   │
   ▼
mapSectionsToTemplate              ← sections onto the template's placeholders
   │
   ▼
templates/note.html                ← substituted and written
```

### Browser scripts

`src/` holds two kinds of file, and the build only publishes the second kind:

| Node modules | Browser scripts |
|---|---|
| `main.js` — render API and CLI | `noteStorage.js` — per-note storage keys |
| `renderer.js` — the pipeline | `themeSwitcher.js` |
| `parser.js` — marked | `fontSizeSwitcher.js` |
| `math_renderer.js` — KaTeX | `search.js` |
| `callouts.js` | `highlight.js` |
| `sanitizer.js` | `stickyNotes.js` |
| `image_handler.js` | `quickNavigation.js` |
| `tableOfContents.js` | `aboutModal.js` |
| `noteIdentity.js` — slugs and metadata | `print.js` |
|  | `backToTop.js` |
|  | `viewPersistence.js` |
|  | `noteLibrary.js` — home page filter |

The list is declared in `scripts/siteLib.mjs`; a new browser script has to be
added there to be published.

---

## Roadmap

- [ ] Source-level note management: a small editor or dashboard that writes
      `data/input/*.md` through the same `renderNoteHtml` path
- [ ] Grouping the home page by course, with a collapsible list per course
- [ ] Full-text search across notes from the home page
- [ ] Export a note to PDF, alongside the existing print stylesheet
- [ ] Optional per-note `index.json` for notes that ship their own attachments

---

## Contributing

1. Fork, branch, make the change.
2. Add or update a fixture and its expectations if you touched the pipeline.
3. Run `npm test` and `npm run site` — the build must verify cleanly.
4. Open a pull request describing what changed and why.

Two things the build will stop you shipping: a note with an unresolved template
placeholder, and a note that has lost a stylesheet, script or control. If the
build complains about a broken reference, that reference is already broken for a
reader.

---

## License

ISC. The notes, images and any third-party content under `data/` are the
property of their authors.

Built with [marked](https://marked.js.org/),
[DOMPurify](https://github.com/cure53/DOMPurify),
[KaTeX](https://katex.org/),
[Lucide](https://lucide.dev/) and [jsdom](https://github.com/jsdom/jsdom).
