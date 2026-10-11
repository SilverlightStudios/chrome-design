/** Styles for the exported handoff document (not the snapshot itself). */
export const VIEWER_CSS = `
:root{
  color-scheme: light dark;
  --bg:#f6f7f9; --panel:#ffffff; --ink:#0f172a; --muted:#5b6474; --line:#e3e6eb;
  --accent:#2563eb; --accent-ink:#ffffff; --prompt-bg:#0f172a; --prompt-ink:#e2e8f0;
  --warn-bg:#fff7e6; --warn-line:#f5c26b; --warn-ink:#7a4b00;
  --chip:#eef1f5; --stage:#e9ecf1;
  --change:#2563eb; --decision:#7c3aed; --question:#d97706; --note:#475569; --resolved:#16a34a;
  --radius:12px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#0b0d12; --panel:#13161d; --ink:#e7eaf0; --muted:#98a1b2; --line:#252a34;
    --prompt-bg:#05070b; --chip:#1c2029; --stage:#0f1218; --warn-bg:#2a2010; --warn-line:#6b4f1a; --warn-ink:#f5d08a; }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font)}
a{color:var(--accent)}
code,pre{font-family:var(--mono);font-size:.86em}
.wrap{max-width:1440px;margin:0 auto;padding:24px 16px 64px}
header.top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 24px;justify-content:space-between;margin-bottom:20px}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font-size:clamp(22px,3vw,30px);line-height:1.2;margin:4px 0 6px;text-wrap:balance}
h2{font-size:18px;margin:0 0 12px}
.page-url{color:var(--muted);word-break:break-all;font-size:14px}
.stats{display:flex;flex-wrap:wrap;gap:8px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--muted)}
.stat b{color:var(--ink)}
section.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:20px}
.prompt{background:var(--prompt-bg);color:var(--prompt-ink);border:0;position:relative}
.prompt h2{color:#fff;display:flex;align-items:center;gap:10px}
.prompt h2::before{content:"";width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.25)}
.prompt pre{white-space:pre-wrap;word-break:break-word;margin:0;font-size:13.5px;line-height:1.6;max-height:none}
.prompt .actions{position:absolute;top:16px;right:16px;display:flex;gap:8px}
.btn{appearance:none;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:6px 12px;font:600 13px var(--font);cursor:pointer}
.btn:hover{border-color:var(--accent)}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.prompt .btn{background:#1e293b;border-color:#334155;color:#e2e8f0}
.warnings{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn-ink)}
.warnings ul{margin:8px 0 0;padding-left:20px;font-size:13px}
.warnings li{word-break:break-all}
.layout{display:grid;grid-template-columns:minmax(300px,420px) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:900px){.layout{grid-template-columns:1fr}}
.changes{max-height:calc(100vh - 40px);overflow:auto;position:sticky;top:20px}
@media (max-width:900px){.changes{position:static;max-height:none}}
.changes ol{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.change{border:1px solid var(--line);border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color .15s, box-shadow .15s}
.change:hover{border-color:color-mix(in srgb,var(--accent) 50%,var(--line))}
.change.is-active{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 20%,transparent)}
.change:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.change-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.num{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:12px 12px 12px 3px;background:var(--change);color:#fff;font-weight:700;font-size:12px;padding:0 6px}
.chip{font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--muted)}
.intent-change .num{background:var(--change)} .intent-decision .num{background:var(--decision)}
.intent-question .num{background:var(--question)} .intent-note .num{background:var(--note)}
.status-resolved .num{background:var(--resolved)}
.intent-chip-decision{background:color-mix(in srgb,var(--decision) 16%,transparent);color:var(--decision)}
.intent-chip-change{background:color-mix(in srgb,var(--change) 14%,transparent);color:var(--change)}
.intent-chip-question{background:color-mix(in srgb,var(--question) 16%,transparent);color:var(--question)}
.status-chip-resolved{background:color-mix(in srgb,var(--resolved) 16%,transparent);color:var(--resolved)}
.target{margin:8px 0 6px;font-size:12.5px;color:var(--muted);word-break:break-word}
.target code{background:var(--chip);padding:1px 5px;border-radius:4px;color:var(--ink)}
.msg{margin:6px 0 0;padding-left:10px;border-left:2px solid var(--line)}
.msg p{margin:0;white-space:pre-wrap;word-break:break-word}
.msg time{display:block;font-size:11px;color:var(--muted)}
.change details{margin-top:8px;font-size:12.5px}
.change summary{cursor:pointer;color:var(--muted)}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:6px 0 0}
.kv dt{color:var(--muted)} .kv dd{margin:0;word-break:break-word;font-family:var(--mono);font-size:12px}
.empty{color:var(--muted);font-style:italic}
.viewer{padding:0;overflow:hidden}
.viewer-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.viewer-bar h2{margin:0 auto 0 4px;font-size:15px}
.viewer-bar label{font-size:13px;color:var(--muted);display:inline-flex;gap:6px;align-items:center}
.zoom{display:inline-flex;align-items:center;gap:4px}
.zoom output{min-width:48px;text-align:center;font:600 12px var(--mono)}
.stage{position:relative;height:min(78vh,900px);background:var(--stage);overflow:hidden;touch-action:none;cursor:grab;outline:none}
.stage:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.stage.is-panning{cursor:grabbing}
.canvas{position:absolute;left:0;top:0;transform-origin:0 0;background:#fff;box-shadow:0 2px 24px rgba(15,23,42,.18)}
.canvas iframe{display:block;border:0;width:100%;height:100%;pointer-events:none;background:#fff}
.cd-overlay{position:absolute;inset:0;overflow:visible}
.cd-pin{cursor:pointer}
.cd-pin:focus{outline:none}
.cd-pin.is-active path,.cd-pin:focus-visible path{stroke:#0f172a;stroke-width:3}
.cd-target.is-active{stroke-width:3;fill-opacity:.14}
.cd-hide-annotations .cd-overlay{display:none}
.cd-hide-drawings .cd-layer-shapes{display:none}
.noscript-note{padding:16px;color:var(--muted)}
html:not(.cd-js) .stage{display:none}
.screenshot img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;display:block}
.meta dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0;font-size:13px}
.meta dt{color:var(--muted)} .meta dd{margin:0;word-break:break-all}
.blocks li{margin:4px 0;font-size:13px}
.drawings{font-size:13px;color:var(--muted);margin:14px 0 0;padding-left:18px}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
`;
