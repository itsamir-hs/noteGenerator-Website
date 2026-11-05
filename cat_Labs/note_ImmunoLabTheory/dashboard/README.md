# Human Editing Dashboard

A human-in-the-loop editing workstation for the lecture notes this project
generates. It sits between the automatic note generator and Bashligh's HTML
renderer:

## Windows and layout

The **Windows** button in the header (grid icon) opens a menu with a checkbox
per window — sidebar, document editor, live preview — so the operator chooses
which windows are open. Every pane also has a minimize button in its header,
and minimized panes come back via floating restore chips at the bottom-left.
The layout is remembered in `localStorage`.

* At least one window always stays open; minimizing the last one is refused.
* The document editor's header has a **maximize** button that temporarily
  hides the other windows (the chosen layout is restored when un-maximized).
* Closing the sidebar or preview gives the space to the editor, so focusing on
  the document means a substantially larger editing window.

The table editor is fully visual: click a cell to edit, then use the
**Row / Column ▾** menu (insert/duplicate/move/delete rows and columns relative
to the selected cell) plus the quick buttons. Questions (`[QUESTION:*]`) edit
as prompt, options and answer fields.

```text
PDF + Audio
    ↓
Note Generator (integrate.py)
    ↓
generated Markdown + assets
    ↓
★ Human Editing Dashboard  ← you are here
    ↓
edited Markdown + assets
    ↓
Bashligh Renderer (src/main.js → renderNoteHtml)
    ↓
final HTML
```

The operator opens a generated note, edits it in a visual document editor with
a live Bashligh-rendered preview, manages images, boxes, tables and formulas,
validates the result and exports it **through the existing renderer** — no raw
Markdown editing required (every block still has a `</>` **Edit as Markdown**
action for exact corrections; it re-parses instead of overwriting).

---

## Setup, run, test

No new runtime dependencies: the dashboard reuses the packages already
installed for `note_renderer` (`marked`, `katex`, `dompurify`, `jsdom`).

```bash
cd Bashligh/note_renderer/dashboard
npm install        # optional: the parent node_modules already satisfy everything
npm start          # http://127.0.0.1:4600
```

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DASHBOARD_HOST` | `127.0.0.1` | Bind address (keep it local). |
| `DASHBOARD_PORT` | `4600` | HTTP port. |

Tests:

```bash
npm test
```

The suite has two parts:

1. `tests/testDashboard.js` — round-trip integrity, block/image/box/table/LaTeX
   edits, search & replace, review markers, validation, undo/redo, export
   through the renderer, the browser import graph and the HTTP API.
2. `tests/domSmokeTest.js` — boots the **real front-end modules** in jsdom
   against the real server (opened note, rendered blocks, typing → Markdown,
   Enter splits a block, toolbar, undo, panels, per-block Markdown editing,
   window maximize, preview) and fails on any uncaught front-end error.

---

## What the dashboard reuses from Bashligh

| Concern | Reused component |
|---------|------------------|
| Markdown parsing | `marked` (the parser `src/parser.js` uses), imported with an import map in the browser |
| Markdown → HTML | `src/main.js → renderNoteHtml()` — the same entry point the CLI uses, so preview and export are byte-identical to `node src/main.js` |
| Callout/definition boxes | the renderer's `[BOX:TYPE]` / `[QUESTION:*]` blockquote syntax (`src/callouts.js` renders them; the dashboard models the same syntax without importing renderer internals) |
| Math | `katex` — the renderer renders formulas server-side, the editor shows a live KaTeX preview for display formulas |
| Sanitization | DOMPurify inside `src/renderer.js` (preview/export) — the dashboard never ships unsanitized HTML |
| Template, CSS/JS bundle, themes | `templates/note.html`, `styles/*.css`, `src/*.js` — served as-is; the dashboard's own stylesheet is built on the same CSS variables (`--accentColor`, `--radiusMedium`, …), so the shell follows the note's visual language and theme switcher (`data-theme`, `localStorage` key `noteTheme`) |
| Output location | `note_renderer/output/` — the renderer's own output folder |

Nothing in the renderer was rewritten: the only additions are the dashboard
folder and a handful of static file routes on the dashboard server.

---

## Project structure

```text
dashboard/
├── server.js              # HTTP server: static files, note API, preview, export
├── src/                   # shared modules (used by the server AND the browser)
│   ├── documentModel.js   # Markdown → block model → Markdown (lossless)
│   ├── inlineMarkup.js    # inline Markdown ⇄ editable HTML, LaTeX protection
│   ├── validation.js      # pre-export checks (issues the operator can jump to)
│   ├── history.js         # undo/redo stack + save tracker
│   ├── noteStore.js       # open/save/asset file access, path safety
│   └── exporter.js        # renderNoteHtml + image path resolution for export
├── public/
│   ├── index.html         # application shell
│   ├── styles/dashboard.css
│   └── js/
│       ├── app.js                 # bootstrap, shortcuts, save/autosave, drafts
│       ├── state.js, bus.js, ui.js, api.js
│       ├── documentController.js  # loads/commits/undoes the document
│       ├── editorView.js          # block surface: render, keyboard, drag&drop
│       ├── blockViews.js          # per-type editors (heading…table, image…)
│       ├── inlineEditor.js        # contenteditable caret operations
│       ├── toolbar.js
│       ├── outlineView.js, assetPanel.js, reviewView.js, validationView.js
│       ├── previewView.js, findReplaceView.js, exportDialog.js, assetPicker.js
└── tests/
    ├── testDashboard.js   # model, validation, export, API tests
    ├── domSmokeTest.js    # boots the front-end in jsdom
    ├── moduleLoader.mjs, registerLoader.mjs   # browser-path import support
    └── fixtures/completeNote.md (+ assets/manifest.json)
```

`src/` is deliberately framework-free and side-effect-free: the browser loads
it from `/dashboard/src/…`, Node imports it from disk, and the tests load the
very same files.

---

## The document model and Markdown round-tripping

`parseDocument(markdown)` uses `marked.lexer()` and turns each top-level token
into a block. **Every block keeps the exact source slice it was parsed from**
(`raw`), and blank-line separators are kept as `space` blocks. The blockquote
forms the renderer understands — `[BOX:DEFINITION|EXAMPLE|IMPORTANT|REVIEW]`
and `[QUESTION:ESSAY|MCQ:n]` (with `[ANSWER]`, `[OPTION:X]`, `[CORRECT:X]`)
—are parsed into dedicated editable blocks:

```js
{ id, type, raw, originalRaw, dirty, …type-specific fields }

heading    → { depth, text }
paragraph  → { variant: "text" | "formula" | "image" | "placeholder" | "metadata", … }
blockquote → { kind: "box" | "definition" | "quote", boxType, title, lines }
question   → { questionType: "essay" | "mcq", questionNumber, promptLines, options, answerLines, correctAnswer }
list       → { ordered, start, loose, items: [{ raw, text, dirty }] }
table      → { header: [{ text, align }], rows }
code       → { lang, text }
html/unknown/hr/space → raw only (never rewritten)
```

`serializeDocument(doc)` simply concatenates the blocks' `raw` values. Editing a
block rebuilds **only that block** from its fields (`editBlock` →
`buildBlockRaw`); if the rebuilt source happens to equal the original, the block
is marked unedited again.

Consequences:

* Opening and saving without changes is **byte-identical** to the source
  (asserted for every Markdown file in the repository, including `output.md`).
* Syntax the visual editor does not model (raw HTML, link definitions, exotic
  constructs) is emitted verbatim instead of being normalised away.
* Inline editing renders Markdown to HTML (`renderInlineForEditing`) and reads
  it back (`serializeInlineHtml`). Inline `$…$` formulas are swapped for a
  placeholder token before parsing, so `marked` can never reinterpret `_` or
  `*` inside LaTeX.
* Each block has a `</>` **Edit as Markdown** action (in the floating block
  toolbar) that opens its source in a dialog; applying it re-parses instead of
  overwriting, so one block can become several and nothing else is touched.

Unsupported constructs are never dropped silently: `html` and `unknown` blocks
are shown as read-write source with a banner, and the Issues panel points at
them.

---

## Images and assets

* The server resolves the note's asset folder (`<noteDir>/assets`, the
  renderer's `data/assets`, or the note folder itself) and serves files at
  `/data/:noteId/…` with path-traversal checks.
* Assets panel: thumbnails, **used / not used** state, insert, upload
  (PNG/JPEG/GIF/WebP/BMP) and explicit deletion (with confirmation).
* Image blocks show the real image, alt text, the caption block that follows
  (when the generator wrote one), and offer **replace** (keeps position and
  caption), **remove from note** (only drops the reference, undoable) and
  **delete asset file** (destructive, confirmed, never automatic).
* `[IMAGE_n]` placeholders are understood: they are resolved through
  `assets/manifest.json`, rendered like normal images and can be converted to a
  plain `![…](…)` reference when the operator picks a file.
* Image blocks (and any other block) move by drag handle, `↑/↓`, or
  `Alt+↑ / Alt+↓`.

---

## Saving

* **Ctrl/Cmd+S** and the Save button write the edited copy to
  `<noteDir>/edited/<note>.md`. The generated original is never touched.
* **Ctrl/Cmd+Shift+S** (confirmed) overwrites the original explicitly.
* Autosave every 20 s when there are changes; the header pill shows
  `All changes saved / Unsaved changes… / Save failed`, and the status bar shows
  the last save time.
* A draft of unsaved changes is kept in `localStorage`; reopening the note
  offers to restore it (accidental refresh recovery) and `beforeunload` warns
  before closing the tab.

---

## Live preview and export

Both go through `renderNoteHtml(markdown, { template, rendererConfig })`:

* **Preview** — `POST /api/render` caches the rendered document and the iframe
  loads `/preview/<noteId>.html`. Relative asset URLs written by the renderer
  (`../data/assets/…`) are rewritten to `/data/<noteId>/…` so images resolve
  while the operator edits; nothing else about the HTML is changed. Updates are
  debounced (350 ms) and the scroll position is preserved.
* **Export** — `POST /api/export` runs the shared validation, then renders with
  the same template/config and writes
  `note_renderer/output/<note>.html`, which the dialog opens at
  `/exports/<note>.html`. The only adjustment is resolving each `<img src>`
  against the note's real assets and making it relative to the export folder —
  for the standard `data/input/note.md` layout this yields exactly
  `../data/assets/…`, i.e. the renderer's own output.

Export is blocked only by **errors** (missing image, empty heading…); warnings
are listed but never stop the operator, and blocking errors can be overridden
after an explicit confirmation.

* **Share bundle** — `POST /api/share` builds the zip handed to an editor and
  writes `note_renderer/output/<note>-share.zip` (or `-editable.zip`), which the
  dialog downloads from `/exports/<note>-share.zip`. The default review bundle
  contains only `note.md`, a self-contained `note.html` (styles, scripts, KaTeX
  fonts and images embedded) and the used images: no `node_modules`, no tests,
  logs, backups or other notes. Tick “include the editing dashboard” to also ship
  the dashboard/renderer runtime files; editors then run `npm install` once.
  The command-line equivalent is `node Bashligh/shareNote.mjs`.

---

## Validation

`src/validation.js` runs in the browser (Issues panel, live, debounced) and
again on the server before export. Checks: missing/broken image references,
unknown `[IMAGE_n]` placeholders, duplicated placeholders, empty headings,
empty sections, the ten standard sections, unbalanced `$$`, unbalanced braces
in formulas, unclosed code fences, unknown box types, empty boxes, empty table
headers. Every issue carries a level, a human-readable message and the block id
so **Go to** can jump straight to it.

Review markers produced by the generator (`⚠`, `**وضعیت:** نیازمند بررسی`) are
listed in the Review panel with **Open** and **Mark reviewed**; markers are
preserved on load and only change when the operator acts.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+S` | Save (edited copy) |
| `Ctrl/Cmd+Shift+S` | Overwrite the original (confirmed) |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo (whole document) |
| `Ctrl/Cmd+F` / `Ctrl/Cmd+Shift+F` | Find / find & replace |
| `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+K` | Bold, italic, link |
| `Ctrl/Cmd+O` | Open a note |
| `Ctrl/Cmd+Enter` | Render the preview now |
| `Alt+↑` / `Alt+↓` | Move the current block |
| `Enter` / `Shift+Enter` | Split the block / line break |
| `Tab` (table cells) | Move to the next cell |

The same list is available in the app under **?**.

---

## Security

* Every filesystem path is resolved inside the project folder; uploads only
  accept image extensions, are renamed to safe names and are written into the
  note's asset folder; deletion only reaches files directly inside it.
* The preview runs in an iframe served by the renderer's own pipeline, and all
  note HTML passes through the renderer's DOMPurify sanitization. The dashboard
  never injects note content as executable HTML.
* The server binds to `127.0.0.1` by default and logs events (open/save/export,
  errors) to `dashboard/logs/dashboard.log` — paths and counts only, never note
  content.

---

## Limitations / possible next steps

* A lightweight "Changes" view against the generated original (the original is
  already loaded and kept for restore) is not implemented yet.
* Dragging items in the outline reorders sections through the ↑/↓ buttons;
  outline drag-and-drop itself is not implemented (block-level drag-and-drop in
  the editor is).
* Nested sub-lists are edited as their Markdown text inside the list item, which
  is visible to the operator rather than indented visually.
