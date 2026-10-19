# Chrome Design

A Chrome extension (Manifest V3) for reviewing a live web page the way you would a Figma file: click anything to comment on it, sketch on top of the page, move and resize what you drew, then **send everything to an AI assistant as one self-contained HTML file**. The file holds a static snapshot of the page, every comment and drawing, a JSON payload with a versioned schema, and clear instructions for the assistant.

It is made for designers, so the interface stays quiet and plain: elements are named the way you would say them (“Button “Start free””, “Heading”, “Image”), not as CSS selectors. The selectors and computed styles still go into the file for the AI.

**Live demo:** [silverlightstudios.github.io/chrome-design](https://silverlightstudios.github.io/chrome-design/) — the real toolbar on a sample page (no extension needed; pictures of the screen need the extension). Rebuilt on every push to `main`.

Personal-use prototype. No accounts, no server, no analytics: page content never leaves your machine unless you send the exported file to someone yourself (a walkthrough goes only to your own voice recorder, on the same computer, when you turn the voice link on).

**Walkthroughs** (after [Scrawl](https://github.com/kitlangton/scrawl)): talk a page through while it follows along — laser pointer, ink, numbered pins, clicks — and get numbered pictures plus a summary for the agent, with what you said lined up by time. Audio stays in your own voice recorder; the two connect through a small local bridge ([docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)).

## Using it

Click the Chrome Design icon (or press `⌥⇧D`) on any page to open the toolbar; click again to close it. The first time, a short three-step welcome explains the basics and puts the Comment tool in your hand. While the tools are on, a thin blue line with a soft fade frames the screen; it fades away when you pause.

The toolbar is one row: **Close · Select · Comment · Pencil · Shapes · Text · Image · Walkthrough · More ⋯ · Send to AI**. Hover a button for its name and shortcut (on touch screens, press and hold, then slide along the bar to read the others).

| Tool | Key | What it does |
| --- | --- | --- |
| Select | `V` | Click any element to select it. A small Liquid Glass bar above it names it and offers **Comment** (the blue button), **Hide**, **Details** (size, text style, colours you can copy, spacing, corners), **↑** to select the element around it and **↓** to step back in (to the element you came up from, otherwise the first one inside; the arrow keys do the same). The selection shows its outline, its size and a spacing line from each side to the next thing on the page: a neighbour in line with it, the inside edge of the box it sits in, or the page edge (dashed), each with its gap in px (pills sit just above horizontal lines and beside vertical ones; the size label moves aside for the bottom line). Drag over empty page to select an area. Hold `⌥` to see padding and margin (labelled the same way, in green and orange), or the distance to whatever you hover. Click a drawing to select it (`⇧`-click adds more, dragging over empty page selects every drawing wholly inside the box, `⌘A` selects them all; on touch, press and hold a drawing to add it): drag to move, pull a handle to resize (several selected move, scale, restyle and delete together), `⌘C` / `⌘X` / `⌘V` copy, cut and paste drawings and images (also between pages, tabs and shared files), `⌘D` or the Duplicate button duplicates, `⌥`-drag drags a copy. The ⋯ in the style bar arranges the selection (bring to front / forward, send backward / to back: `⌥⌘]` `⌘]` `⌘[` `⌥⌘[`), locks it (`⇧⌘L`: shown, but clicks go through to the page) or hides it (`⇧⌘H`). More → Layers lists every drawing and image front to back: tap to select, the eye to show or hide, the lock to lock, drag the grip to reorder (`⇧` keeps proportions, or snaps lines to 45°), double-click a label to edit it, arrow keys nudge, `⌫` deletes (with Undo). `Enter` comments on the selection. |
| Comment | `C` | Hover to see what you'll comment on, click to open a comment bubble, type and press `Enter` (`⇧Enter` for a new line). Drag to comment on an area. Each comment is a Change, Decision, Question or Note, and can have replies, be resolved or deleted (with Undo). Drag a pin to move it. Each comment remembers the window width it was written at, and the size chip in the bubble limits it to Phone, Tablet or Desktop (tap to step through); pins meant for another size fade. Click a placed image or drawing to comment on it (or press `Enter` / the Comment button with it selected): the pin then travels with it, and stays on the page if it's deleted. Attach images with the picture button in the bubble, by dropping them onto the bubble (files, or a picture dragged from another website), or by pasting into it (up to 6 per message; a message can be just images). Tap an attached image to see it full size. |
| Pencil | `P` | Freehand drawing. It stays selected so you can keep sketching; the eraser (`E`) is in the style bar. |
| Shapes | `R` `O` `A` `L` `B` | Rectangle, ellipse, arrow, line and **Blur** (a frosted box that hides private content: solid in screenshots, and in the download the text under it becomes dots, pictures become grey boxes, quoted text in comments is dotted, and the page code is left out). A selected page element or area also has a **Hide** button that covers it with a Blur box. The button shows the last shape you used; press and hold (or right-click) it for the others. `⇧` makes squares and circles and snaps lines to 45°. After drawing, you're back in Select with the new shape selected, ready to adjust. |
| Text | `T` | Click to place a text label. |
| Image | `⇧⌘K` | Pick images to place on the page, like on a canvas. While any tool is on you can also drag images straight onto the page (they land where you drop them), including a picture dragged from another website, or paste an image or an image link with `⌘V` (it lands in the middle of the screen). A linked picture is copied in when its site allows it; otherwise the link is kept and embedded at download time if possible. A placed image is selected right away: drag to move, pull a corner to resize (proportions kept; `⇧` frees them), `⌫` deletes. Large pictures are scaled down to 1600 px on the long edge before they're saved. When the tools are paused, drops and pastes go to the page as usual. |
| Style bar | | Appears above the toolbar while drawing or when a drawing is selected: colour, stroke width, dashed, eraser, delete, undo and redo. Changes apply to the selected drawing. |
| More ⋯ | | Comments list (`F`, filter by open or resolved, click to jump to one), Use the page (pauses the tools so the page works normally), Open file (bring a downloaded handoff `.html` or `.zip` back onto the live page: its comments, replies, drawings and images join yours as one undoable step; a file for another page asks first; dropping the file on the page does the same), Rulers (`M`, drag from a ruler to add a guide), Columns (`G` toggles; the ⋯ on the tile opens its settings: Stretch / Left / Center / Right / Space between / around / evenly, DialKit-style sliders for count, width, gutter, margin and opacity where a typed number can go past the slider, colour swatches), Screen size (with the extension, on a computer: resize the window to Phone 390 / Tablet 834 / Laptop 1280 / Desktop 1440 so the page's own breakpoints apply, with a live width readout and a way back), Shortcuts (`?`, desktop only), Quick tour, Settings and Clear this page. Panels opened from More have a back button. |
| Send to AI | `⇧E` | Shows what will be included, takes an optional note for the assistant, and downloads the file. |
| Walkthrough | `W` | Talk a page through while Chrome Design follows along (the ◉ button; More → Walkthrough reopens the last one). The page stays usable; hold `⇧` and move for a laser pointer, `⇧`-drag for red ink (circles, underlines and arrows are recognised), `⇧`-click for a numbered pin, and **Flag** (`⌥⇧F`) for "look here": a picture now and a comment pinned where the pointer is (it gets what you said then, once there's a transcript). Clicks, scrolling, typing (which field, never what was typed), page changes and things that appear by themselves (toasts, dialogs, popovers, live messages) are noted, and pictures are taken at those moments; a picture of something appearing is kept only if it shows something new. Following a link doesn't end it: it carries on on the next page, on the same clock. Each picture is cropped to where its moment happened (Scrawl's auto-crop; the full pictures are kept in `frames-full/`), and page details are read from the page (what screen it's on: dialog, selected tab, page heading; the route; a Next.js route pattern; language, theme, size). On a touch screen the bar's **Draw** does what `⇧` does. **Stop** (`⌥⇧W`) shows the whole walkthrough as one picture: a header (page, length, how the voice lines up) and every numbered picture with what happened, what was said and what else happened then. Add what you said from any speech-to-text tool (.srt, .vtt, .json or .txt; the **Voice starts** dial lines it up), then **Download .zip** (`summary.md`, `walkthrough.json`, `contact-sheet.jpg`, `frames/`), **Copy for AI** (the picture plus the same text) or **Save image** (just the picture). With the voice link on, your own voice recorder starts and stops it and gets it back: see [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md). |
| Undo / redo | `⌘Z` / `⇧⌘Z` | Applies to every change: comments, drawings, guides, moves and deletes. |
| Step back | `Esc` | Each press goes back one level: closes bubbles and panels, deselects, returns to Select, then pauses the tools. While paused the page gets all its keys back. |

Annotations are saved in extension storage (`chrome.storage.local`) per page URL, so you can close the toolbar and come back later. Nothing is written to the site itself. The only page change is the toolbar's own shadow-DOM host element, and closing the toolbar removes it (it plays a short exit animation first).

### Phones, tablets and narrow windows

Below 640 px wide (or on touch screens up to 900 px) the layout switches to touch:

- The toolbar sits at the bottom. Panels open as **bottom sheets** with a handle: drag down to close, flick to dismiss, pull up for a rubber-band stretch, or tap outside. The toolbar steps aside while a sheet is open.
- Sheets keep their content on screen for the whole animation: switching panels crossfades, and closing slides the sheet away with its content still drawn.
- Element details open in a sheet instead of a floating card, so they never cover the selection bar.
- Drawings have larger touch targets. Pressing and holding a toolbar button shows its name without triggering it.
- Text fields use a 16 px font, so iOS doesn't zoom in when you type, and sheets rise above the on-screen keyboard.

Chrome extensions don't run on iPhone or Android Chrome. The touch layout is for touch-screen laptops and tablets, narrow windows, and the demo page (`pnpm demo`), which runs the real in-page UI and is how the phone experience gets tested.

## Look and motion

The look follows the owner's Remote Desktop viewer (`studio-hub/assist/public/desk`): Liquid Glass toolbar, chips, segmented controls and tiles. The motion follows Spark (`Repos/Spark`): the fluid tooltips, the StackableDrawer springs and, on phones, Spark's own scrubbed drawer. Everything is CSS except the sheet springs, which need velocity-preserving retargeting.

- **Liquid Glass toolbar.** An SVG displacement map used as `backdrop-filter` (a port of the Remote Desktop's WebGL glass: 30 px edge refraction, frost, rim). This works in Chromium. Safari, and pages whose CSP blocks the map, get a frosted CSS glass instead. The glass tone adapts to light and dark pages.
- **Tooltips** are Spark's fluid tooltips, on every control (toolbar, style bar, selection bar, comment bubble, details, rulers): one dark label with an arrow that slides and resizes between controls (200 ms, `cubic-bezier(0.22, 1, 0.36, 1)`) while the text slides in from the side it came from; 350 ms to appear, instant while one is showing. On touch, press and hold a control for its name and slide along to read the others (letting go presses nothing); labels stay on screen at the edges with the arrow still on the control. Clicking keeps the label and resizes it to the new one; menus (Colour, Stroke, Shapes, Arrange) open out of the same dark surface.
- **Liquid Glass** is shared: the selection bar uses the toolbar's glass, and both turn dark in dark mode (over a light page too) so they match the panels.
- **Panels** spring from the toolbar (Spark's drawer). On phones they are Spark's app drawer: one morph plays the opening, a finger dragging it anywhere, and the close.

Measured in Chrome DevTools (`document.getAnimations()`, rAF sampling) against the reference values:

| Motion | Reference | Chrome Design |
| --- | --- | --- |
| Tooltip open delay / pour / travel / close delay / sink | 350 / 450 / 518 / 100–120 / 324 ms (Spark) | 372 / 450 / 518 / 137 / 324 ms |
| Panel open (spring, starts at 38% × 58%) | 384 ms, 10 px overshoot (Spark drawer) | settles at 388 ms; overshoot 6 px wide, 2 px tall (the same 10 px spread over the size change) |
| Panel close (content stays visible) | 180 ms (Spark drawer) | 180 ms, removed at 188 ms, content opacity 1 throughout |
| Panel switch | crossfade, never blank | old panel fades out by ~180 ms, new one is fully in by ~260 ms, no restart |
| Phone sheet open | Spark app drawer (iPhone emulator): from 39% wide, 78% of its height by ~233 ms, settles ~400 ms, ~1 px overshoot | from 39% wide, 79% by ~221 ms, settles ~407 ms, 1 px overshoot |
| Phone sheet close | Spark: shrinks to the card and drops away, content until ~340 ms, gone ~480–530 ms | content until ~344 ms, gone ~494–544 ms |
| Phone sheet drag | follows the finger 1:1, 36 px overpull, 0.18 s velocity projection | same (60 px slow drag springs back, flick or past half closes) |
| Comment bubble close | — | fades out and shrinks back toward its pin over ~140 ms |
| Whole toolbar close | — | fades out over 200 ms and slides down 24 px over 240 ms, then everything is removed |

`prefers-reduced-motion` turns the springs and morphs into instant changes.

## The handoff file

**Send to AI → Download file** saves `chrome-design-<host>-<yyyymmdd-hhmm>.html`. It is one file, it works offline, and it is meant to be shared:

- **It is the page.** The file *is* the page copy (scripts removed, images, fonts and CSS embedded) with the Chrome Design toolbar built in. Whoever opens it in a browser sees the page with every comment, drawing and placed image on top and the tools already on: they can read, reply, resolve, draw, place images, and **Download** an updated file. No extension is needed. Close pauses the tools. Edits made in a copy are remembered per file in that browser.
- **Lined up in any window.** The page is held at the width it was reviewed at, and every media query is answered the way the designer's screen answered it (recorded at capture, applied when the file opens; the stored CSS keeps its original queries). On a phone you see the page 1:1 and pan sideways, with the normal phone toolbar.
- **Without JavaScript** (file previews, mail apps) it still shows the page with pins, outlines, drawings and placed images drawn on top, plus a corner list of the comments and their pictures (declarative shadow DOM, so page CSS can't touch it).
- **For AI agents.** An HTML comment at the very top holds the instructions and the whole feedback in plain text (every comment with replies and attached pictures, every drawing, every placed image with where it sits). The instructions explain that the board is a scratch board (nothing is pixel-perfect unless a comment says so), and that a placed image is usually a screenshot of the intended design, often a component from Figma. It tells the agent *what* to build (what the picture shows, with nearby comments), *how* it should look (in the page's own design system), and *where* it goes: where it was dropped, `placement.inside` (the section it belongs in) and `placement.covers` (what it sits on). The top comment also carries a short Python script that unpacks every picture into `images/`, the clean page into `page.html` and the payload into `handoff.json`.
- **A picture of the whole page.** With the extension, the download also takes a top-to-bottom picture of the page with every drawing, placed image and comment pin drawn on (it scrolls a screen at a time, hides the toolbar, and hides fixed headers after the first screen so they don't repeat). It's in the file (`#chrome-design-fullpage`, unpacked as `page-annotated.jpg`).
- **Copy for AI** copies one chat-ready message instead of a file: the page, how to read a scratch board, and every comment, drawing and placed image with where it sits (plus an HTML copy carrying the pictures, for editors that take them).
- **Download .zip with images** saves the same thing as a folder for coding agents and chat uploads: the `.html`, `AGENTS.md` (instructions + feedback), `handoff.json`, `page.html`, `screenshot.jpg`, `page-annotated.jpg`, `images/placed-NN-….png` / `images/comment-NN-k-….png`, and `images/placed-NN-…-in-context.jpg` (each placed image cropped from the page picture with what's around it).

What's inside the file:

- The handoff wrapper is everything between `<!--chrome-design:begin-->` and `<!--chrome-design:end-->`, plus `data-chrome-design-handoff` on `<html>`. Remove those and you have the page copy byte for byte. Anchored elements carry `data-cd-ref="cd-N"`.
- `#chrome-design-payload` (`application/json`): metadata (including the recorded media-query answers), annotations, `images` (every picture with its file name), guides, grid, sanitize report and warnings.
- `#chrome-design-schema` (`application/schema+json`): JSON Schema draft 2020-12, `$id` `urn:chrome-design:handoff:2.0.0` (source: `src/shared/schema.ts`).
- `#chrome-design-source`: the original rendered DOM as a JSON string, for reference only, never executed.
- `#chrome-design-screenshot`: the designer's viewport with the feedback visible.
- `#chrome-design-runtime`: the toolbar (the extension's own `content.js`).

Annotation coordinates are CSS pixels from the document's top-left corner at the recorded viewport width.

### Safety of the exported file

- **Sanitized page copy.** Scripts, `noscript`, event-handler attributes, `javascript:`/`vbscript:`/HTML `data:` URLs, `srcdoc`, `<base>`, meta refresh, form actions and SVG `href` animations are removed. Iframes, objects and embeds become same-size placeholders. Canvases and videos are flattened to images. Password values are masked. Images that couldn't be embedded keep their on-page box.
- **CSP.** The file is under `default-src 'none'` with `connect-src 'none'`: only data/blob URLs for images and fonts, and exactly one script, the built-in toolbar, allowed by its SHA-256 hash. Nothing in the page copy can run.
- **No network.** Opening the file makes no requests (the end-to-end test checks this).
- **Escaped data.** JSON blocks escape `<`, `>`, `&`, U+2028 and U+2029; the inline toolbar script has `</script` and `<!--` neutralised. Comment text is HTML-escaped wherever it is shown.

## Setup

Requirements: Node 20+ (tested on Node 26) and pnpm 8+.

```bash
pnpm install
pnpm build          # → dist/
```

### Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder. A welcome and settings page opens.
4. Pin **Chrome Design**, open any http(s) page and click the icon (or press `⌥⇧D`). Click again to close. On pages Chrome doesn't allow extensions on, the icon opens a short explanation instead.
5. Optional: turn on **Images from other websites** in Settings. It requests `<all_urls>` at runtime so the file can include images, fonts and stylesheets from CDNs that don't send CORS headers. Without it, those show up as placeholders and are listed in the file's warnings.
6. Optional: enable **Allow access to file URLs** on the extension's details page to use it on local `file://` pages.

After changing code, run `pnpm build` again and click the reload icon on the extension card. `pnpm dev` rebuilds on save (watch mode).

### Scripts

| Command | Purpose |
| --- | --- |
| `pnpm build` | Production build into `dist/` |
| `pnpm dev` | Watch build into `dist/` |
| `pnpm demo` | Runs the real in-page UI on a sample site at http://127.0.0.1:5173 (open it on a phone to test the touch layout). There is no extension runtime there, so screenshots are skipped and annotations go to `localStorage`. It also serves `/chrome-design.js` (the content script, built on request) so files downloaded from the demo open with the toolbar too. |
| `pnpm demo:build` | Static build of the demo into `demo-dist/` (`.github/workflows/demo.yml` publishes it to GitHub Pages on every push to `main`) |
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7) |
| `pnpm lint` | Oxlint + Biome check |
| `pnpm lint:fix` / `pnpm format` | Auto-fix / format |
| `pnpm test` | Vitest unit tests (schema/export, sanitizer, CSS rewriting, geometry incl. resize handles, store history, shortcuts, plain-language element names) |
| `pnpm e2e:install` | One-time project-local Chromium download for e2e (`PLAYWRIGHT_BROWSERS_PATH=0`, stored in `node_modules`) |
| `pnpm test:e2e` | Builds `dist-e2e/` and runs Playwright against the real unpacked extension: welcome, comment, select and comment from the selection bar, draw then move and resize, undo/redo, export (then opens the file offline and asserts zero network requests), hostile pages (transformed root, max z-index widgets, page shortcuts, inner scrollers, modal dialogs), single-page apps, strict CSP, an image dropped on a strict-CSP page (placed, painted, undoable), the .zip download, opening the downloaded file offline (toolbar on, pins exactly where they were on the live page, a reply, a re-download, zero network requests and console errors),, phone-width bottom sheets, a walkthrough (laser, ink read as a circle, a pin, clicks, typing without the text, the .zip, a transcript, Copy for AI), and the voice link through the real bridge with a stand-in recorder. |
| `pnpm check` | typecheck + lint + unit tests + build |
| `node tools/walkthrough-merge.ts <folder or .zip> <transcript>` | Write a walkthrough's `summary.md` with what was said (for voice tools; see docs/WALKTHROUGH.md) |
| `bridge/install.sh <extension id>` | Register the voice link's bridge with Chrome (macOS) |
| `node bridge/example-recorder.mjs` | A stand-in voice recorder for trying the voice link |

`dist-e2e/` is a test-only build that adds `<all_urls>` host access, because automated tests can't click the toolbar icon to grant `activeTab`. Don't load it for real use.

## Architecture

```
src/
  shared/      typed models (model.ts), JSON Schema (schema.ts), escaping, geometry (hit tests, resize handles), measurement, messages
  background/  service worker: icon click / ⌥⇧D toggle, captureVisibleTab, optional asset fetch; inject.ts (restricted-page checks + on-demand injection)
  popup/       restricted-page explainer (popup.html) and the welcome & settings page (options.html)
  content/     content script (IIFE, injected on demand) with React UI in a shadow root (top layer)
    store.ts        editor state + undo/redo history (external store, framework-free)
    describe.ts     plain-language names for elements (“Button “Start free””)
    keyboard.ts     Figma-style single-key tools and the Esc chain
    overlay/        capture layer (pointer logic), page-space drawings/pins/selection handles,
                    hover + selection outlines, selection bar + details, comment bubble, text editor, rulers/grid
    ui/             toolbar (tools, Shapes menu, style bar), panels (More, Comments, Columns, Send to AI, Settings, Shortcuts, Welcome), `Dial` slider, Paused chip
    motion/         spring.ts (Spark's spring), glass.tsx (Liquid Glass, `<LiquidGlass>` bars), Tooltip (fluid tooltips), MorphSheet (desktop sheets + phone bottom sheets), presence.ts (exit animations)
    exporter.ts     capture → build → download
    walkthrough/    recorder.ts (laser, ink, pins, flags, clicks, scrolls, page changes, pictures on one clock),
                    crop.ts (feeds the auto-crop), pageContext.ts (page details), bundle.ts (annotated and
                    cropped pictures, contact sheets, .zip, Copy for AI), voice.ts (the page's side of the voice link)
  capture/     DOM → sanitized snapshot: stylesheets (CSSOM, @import, adopted sheets, shadow roots),
               asset embedding with byte budget, viewport-unit rewriting, element anchors/selectors
  export/      pure document builder (build.ts), agent prompt, SVG overlay, self-contained viewer runtime
  walkthrough/ pure, also runs in Node: model.ts (walkthrough.json), shapes.ts (ink → circle / underline / arrow / pin,
               ported from Scrawl), transcript.ts (SRT, VTT, Whisper / NeMo JSON, text), summary.ts (summary.md), protocol.ts
               autocrop.ts (Scrawl's auto-crop, ported), scene.ts (Scrawl's "did the screen change")
bridge/        the voice link's native messaging host (host.mjs), its installer, and a stand-in voice recorder
tools/         walkthrough-merge.ts: transcript + walkthrough → summary.md, for voice tools
demo/          sample site + harness for the in-page UI (also the phone preview)
tests/         Vitest unit tests; tests/e2e Playwright extension tests
scripts/       build.mjs (three Vite builds + manifest), make-icons.mjs (dependency-free PNG icons)
```

- **Permissions:** `activeTab`, `scripting`, `storage` and `unlimitedStorage` (no install warning; placed and attached images would outgrow `chrome.storage.local`'s 10 MB), plus the optional `<all_urls>` that Settings requests only when you turn on **Images from other websites**, and the optional `nativeMessaging` it requests only when you turn on **Voice recorder**. There are no static content scripts and no host permissions by default.
- **Messages:** only the content script talks to the service worker, to ask for a screenshot or an asset fetch. The service worker checks that the sender is this extension.
- **Living on any page:** the UI is a `popover="manual"` host in the top layer, so page transforms and `z-index: 2147483647` widgets can't cover it. When the page opens a modal `<dialog>`, the host moves into it to stay usable. The stylesheet is a constructable stylesheet, which strict CSPs allow. While a tool is active, our single-key shortcuts don't reach the page; while paused, the page gets every key. Single-page-app navigations swap to that URL's notes. Pins follow elements inside inner scrollers and fixed headers.
- **Snapshot fidelity:**
  - Stylesheets are inlined in their original cascade order.
  - CSS-in-JS rules are read from the CSSOM.
  - `@font-face` keeps one format, preferring woff2.
  - `vh`/`dvh`/`svh`/`lvh`/`vw`/`vmin`/`vmax` in declarations are converted to px so `100vh` sections keep their size inside the full-height iframe. Selectors are left alone.
  - Animations jump to their end state and transitions are disabled.
  - Form values, `<details open>` and inner scroll offsets are preserved.
  - Open shadow roots become declarative shadow DOM. Closed ones are captured via `chrome.dom.openOrClosedShadowRoot`.

## Browser limitations

- Chrome doesn't allow extensions on `chrome://` pages, the New Tab page, the Chrome Web Store, other extensions' pages or the built-in PDF viewer. The popup explains this instead of failing silently.
- `activeTab` is granted when you click the icon or press the shortcut. It lasts until the tab navigates to another origin.
- Cross-origin iframes are not captured; they show up as placeholders with a warning.
- Canvases with cross-origin pixels can't be read; they become placeholders with a warning.
- WebGL canvases without `preserveDrawingBuffer` may export blank.
- Stylesheets and assets on other origins without CORS headers can't be read unless you grant the optional permission. They are listed as warnings and show up as hatched placeholders.
- The snapshot is a single static state: hover/focus states, JS-driven menus and carousels are flattened. `position: fixed` elements render relative to the top of the snapshot. Media queries based on viewport height see the full document height.
- Custom elements stay undefined in the snapshot (scripts are removed). Pages that hide `:not(:defined)` elements may lose those parts. The screenshot shows how they looked.
- Drawings live in document coordinates, so they don't follow an inner scroller (comment pins anchored to elements do).
- The Liquid Glass refraction needs Chromium's SVG `backdrop-filter`; elsewhere, and on pages whose CSP blocks `data:` images, the toolbar uses the frosted CSS glass.
- Very large pages are capped at an 80 MB embed budget (8 MB per asset). Anything over the cap is listed as a warning.

## Attribution

Walkthroughs follow [Scrawl](https://github.com/kitlangton/scrawl) by Kit Langton (MIT): the ⇧ laser and ink gestures, the stroke-shape rules (`src/walkthrough/shapes.ts`, from its `sketch.rs`), the auto-crop (`src/walkthrough/autocrop.ts`, from its `autocrop.rs`, with its settings and tests), the screen-change measures (`src/walkthrough/scene.ts`, from its `keyframes.rs`), the 1.5 s ink fade, flags, and the summary format (a line per picture, with what was said then, ⟨screen⟩ markers). No Scrawl code ships beyond those ports; recording, pictures, page details and the voice link are this project's own.

Chrome Design is an original implementation inspired by the workflow in [Squints](https://x.com/andreaskatzmann/status/2109119904351924379) by Andreas Katzmann: design inspection tools (inspect, rulers and guides, column grid, drawing) layered over live web pages. I studied the public demo video and the public feature description. No Squints source code, branding, logos, icons or assets were used. The interface, extension icon, code and the AI-handoff export format are original to this project. The visual language and motion follow the owner's own projects: the Remote Desktop viewer (Liquid Glass) and Spark (fluid tooltips, StackableDrawer springs, the scrubbed phone drawer, DialKit sliders).

Toolbar and panel icons use [Lucide](https://lucide.dev) geometry (ISC, © Lucide Icons and Contributors), animated after [Lucide Animated](https://lucide-animated.com) (MIT, © 2024-2026 pqoqubbw), the animated icon reference in Spark's resources. Its motion/react variants are re-implemented as CSS keyframes (`src/content/ui/icons.tsx`, `.ai-*` in `styles.css`); no animation library ships in the extension. Pressing a control plays its icon; hovering plays it too, and a few icons (download, trash, settings) hold a pose while hovered.

## License

Private, for personal use (`UNLICENSED`).
