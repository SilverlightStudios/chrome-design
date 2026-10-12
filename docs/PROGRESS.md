# Build progress (resumable notes)

## Status (2026-10-11)
Feature-complete prototype. All checks pass: typecheck, Oxlint, Biome, 55 unit tests, 3 Playwright e2e
tests against the real unpacked extension. Verified on the demo page in desktop Chromium and the
iPhone (WebKit) emulator.

## Architecture decisions
- Content script = single IIFE (`dist/content.js`) injected on demand via `chrome.scripting` (activeTab). UI is React inside an open Shadow DOM host `<chrome-design-root>` appended to `<html>`; removed entirely on close.
- Page-space annotation layer: absolutely positioned 0×0 container at document origin (scrolls natively). Toolbar/rulers/grid/inspector use fixed positioning.
- Service worker: injection, `captureVisibleTab`, optional cross-origin asset fetch (only with optional `<all_urls>` granted from the popup).
- Export: `src/export/build.ts` is pure (tested in Node/jsdom). Snapshot stored raw in `<script type="text/html" id="chrome-design-snapshot">` (escaping in `src/shared/escape.ts`), payload `application/json`, schema `application/schema+json`, source DOM as JSON string. Viewer runtime is one self-contained function embedded with `fn.toString()` (must not reference module scope); CSP `default-src 'none'` + script hash; snapshot iframe `sandbox="allow-same-origin"`.
- Remote assets that can't be embedded are replaced by a placeholder (`data-cd-original-*` keeps the URL) so the export never touches the network.
- vh/dvh/svh/lvh/vw units in declarations are rewritten to px for the full-height snapshot iframe.

## Ideas / not done
- Live style/text "edit" proposals applied to the page (recorded as structured edits) — not implemented; feedback is comments/decisions/drawings.
- Same-origin iframe content could be captured recursively instead of a placeholder.
