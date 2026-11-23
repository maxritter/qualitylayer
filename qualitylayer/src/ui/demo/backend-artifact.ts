// The story's richest lasting artifact (`?story`): acme/platform's backend model, the kind of page a
// team keeps beside its code. What runs where, what each store keeps, who may call what and where the
// work stands, drawn for the example company: no real service, account or address.

const CSS = `
:root{color-scheme:light dark;--bg:#fafaf9;--panel:#ffffff;--ink:#18181b;--dim:#5f5f67;--line:#e4e4e7;--edge:#71717a;--soft:#f4f4f5;--accent:#2563eb;--amber:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f10;--panel:#171719;--ink:#ededef;--dim:#a1a1aa;--line:#2e2e33;--edge:#8b8b94;--soft:#1f1f23;--accent:#7aa7ff;--amber:#f5a524}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Geist,system-ui,sans-serif}
main{max-width:1240px;margin:0 auto;padding:40px 44px 64px}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.01em}h2{font-size:22px;margin:44px 0 6px}
.lead{color:var(--dim);max-width:820px;margin:0 0 24px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.card b{display:block;font-size:17px;margin-bottom:4px}.card span{color:var(--dim);font-size:14px}
.frame{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px 28px 18px;margin-top:16px}
svg{width:100%;height:auto;display:block}
.box{fill:var(--panel);stroke:var(--line)}.store{fill:var(--panel);stroke:var(--ink);stroke-opacity:.55}
.region{fill:none;stroke:var(--edge);stroke-dasharray:5 5}
.t{fill:var(--ink);font:600 17px Geist,system-ui,sans-serif}.s{fill:var(--dim);font:14px Geist,system-ui,sans-serif}
.lbl{fill:var(--dim);font:600 12.5px Geist,system-ui,sans-serif;letter-spacing:.07em}
.edge{stroke:var(--edge);fill:none;stroke-width:1.4}.events{stroke-dasharray:4 4}
.chip{fill:none;stroke:var(--ink);stroke-opacity:.6}.chipt{fill:var(--ink);font:500 12.5px Geist,system-ui,sans-serif}
.soft{fill:var(--soft);stroke:none}.risk{stroke:var(--amber);stroke-width:1.6}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--dim);font-weight:500;font-size:13px}
tr:last-child td{border-bottom:0}
ul.state{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:8px}
ul.state li{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px}
ul.state b{margin-right:8px}.done{color:var(--accent)}.open{color:var(--amber)}
.legend{display:flex;gap:22px;align-items:center;color:var(--dim);font-size:13px;margin-top:10px}
.legend i{display:inline-block;width:36px;border-top:1.5px solid var(--edge);margin-right:8px;vertical-align:middle}
.legend i.ev{border-top-style:dashed}.legend em{font-style:normal;border:1px solid var(--edge);border-radius:12px;padding:0 8px;margin-right:6px}
@media (max-width:900px){.cards{grid-template-columns:1fr 1fr}}
@media (max-width:600px){main{padding:24px 16px 40px}h1{font-size:26px}.cards{grid-template-columns:1fr}.frame{padding:14px;overflow-x:auto}.frame svg{min-width:760px}
.legend{flex-wrap:wrap;gap:10px 16px}table{display:block;overflow-x:auto}th,td{padding:8px 10px}}
`

/** A box with a title and lines of text, at x, y; `lines` are drawn 24 px apart under the title. */
function box(spec: {
  x: number
  y: number
  w: number
  h: number
  title: string
  lines: string[]
  cls?: string
}) {
  const { x, y, w, h, title, lines, cls = "box" } = spec
  const text = lines
    .map((line, i) => `<text class="s" x="${x + 22}" y="${y + 58 + i * 23}">${line}</text>`)
    .join("")
  return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><text class="t" x="${x + 22}" y="${y + 32}">${title}</text>${text}`
}
const chip = (x: number, y: number, label: string) => {
  const w = 18 + label.length * 7.1
  return `<rect class="chip" x="${x}" y="${y}" width="${w}" height="26" rx="13"/><text class="chipt" x="${x + 9}" y="${y + 17.5}">${label}</text>`
}
const edge = (x1: number, y1: number, x2: number, y2: number, events = false) => {
  const mid = (x1 + x2) / 2
  return `<path class="edge${events ? " events" : ""}" d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" marker-end="url(#arrow)"/>`
}
const down = (x1: number, y1: number, x2: number, y2: number) =>
  `<path class="edge" d="M${x1} ${y1} C${x1} ${y1 + 40} ${x2} ${y2 - 40} ${x2} ${y2}" marker-end="url(#arrow)"/>`

const DIAGRAM = `<svg viewBox="0 0 1220 720" role="img" aria-label="How a request travels through acme/platform">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--edge)"/></marker></defs>
<text class="lbl" x="40" y="52">WHO CALLS</text>
${box({ x: 40, y: 70, w: 320, h: 112, title: "Customer apps and SDKs", lines: ["API key per account", "Retries keep x-request-id"] })}
${box({ x: 40, y: 226, w: 320, h: 112, title: "Admin console", lines: ["Finance and support, SSO", "Billing mode is Finance-only"] })}
${box({ x: 40, y: 382, w: 320, h: 112, title: "Customer portal", lines: ["Plan and limits, usage", "Alerts at 80 % and 100 %"] })}
<rect class="region" x="420" y="38" width="380" height="476" rx="14"/>
<text class="lbl" x="444" y="64">AWS · EU-CENTRAL-1 AND US-EAST-1</text>
<rect class="box" x="440" y="82" width="340" height="412" rx="10"/>
<text class="t" x="462" y="114">Gateway · 9 services · Go and Node</text>
<text class="s" x="462" y="150">API keys · scoped per account</text>
<text class="s" x="462" y="180">Plan cache · 60 s per account</text>
<text class="s" x="462" y="210">Meter · one event per request id</text>
<text class="s" x="462" y="240">Rate limits · per plan tier</text>
<text class="s" x="462" y="270">Admin API · audited, Finance-only</text>
<rect class="soft" x="462" y="300" width="296" height="30" rx="15"/><text class="s" x="478" y="320">WAF · 2,000 req/s per account</text>
<rect class="soft" x="462" y="340" width="296" height="30" rx="15"/><text class="s" x="478" y="360">Metering adds under 2 ms at p99</text>
<rect class="soft risk" x="462" y="380" width="296" height="30" rx="15" fill="none"/><text class="s" x="478" y="400">Risky: every request passes the meter</text>
${edge(360, 126, 440, 150)}${edge(360, 282, 440, 270)}${edge(360, 438, 440, 330)}
<text class="lbl" x="860" y="52">STORES</text>
${box({ x: 860, y: 70, w: 340, h: 132, title: "Postgres · ledger and accounts", lines: ["41 tables: accounts, plans, invoices,", "usage windows written once, audit log"], cls: "store" })}
${chip(882, 160, "EU · eu-central-1")}${chip(1030, 160, "Write-once keys")}
${box({ x: 860, y: 222, w: 340, h: 132, title: "Kafka · meter events", lines: ["12 partitions per region, kept 7 days;", "a late event becomes a correction"], cls: "store" })}
${chip(882, 312, "EU + US")}${chip(966, 312, "Out of order")}
${box({ x: 860, y: 374, w: 340, h: 132, title: "Redis · what may vanish", lines: ["Plan cache, rate counters, idempotency", "keys for 24 hours, rebuilt on restart"], cls: "store" })}
${chip(882, 464, "Per region")}
${edge(780, 150, 860, 136)}${edge(780, 240, 860, 288, true)}${edge(780, 300, 860, 440)}
<text class="lbl" x="40" y="566">OUTSIDE SERVICES</text>
${box({ x: 40, y: 584, w: 220, h: 96, title: "Stripe", lines: ["Invoices and payments,", "through the outbox"] })}${chip(196, 596, "US")}
${box({ x: 280, y: 584, w: 220, h: 96, title: "Postmark", lines: ["Limit alerts and", "invoice e-mails"] })}${chip(436, 596, "US")}
${box({ x: 520, y: 584, w: 220, h: 96, title: "Slack", lines: ["Finance digest", "each morning"] })}${chip(676, 596, "US")}
${box({ x: 760, y: 584, w: 220, h: 96, title: "Grafana Cloud", lines: ["Traces and p99", "per route"] })}${chip(916, 596, "EU")}
${box({ x: 1000, y: 584, w: 200, h: 96, title: "PagerDuty", lines: ["On-call for the", "gateway and ledger"] })}${chip(1136, 596, "US")}
${down(520, 494, 150, 584)}${down(580, 494, 390, 584)}${down(640, 494, 630, 584)}${down(700, 494, 870, 584)}${down(750, 494, 1100, 584)}
</svg>`

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Backend · acme/platform</title>
<meta name="description" content="acme/platform's backend: services, stores, callers and where the work stands">
<meta name="viewport" content="width=1240"><style>${CSS}</style></head><body><main>
<h1>Backend</h1>
<p class="lead">acme/platform · the services behind every API request: what runs where, what each store keeps, who may call what, and where the work stands.</p>
<section class="cards" data-screen-label="Summary">
<div class="card"><b>11 services · 2 regions</b><span>one gateway per region, one ledger for both</span></div>
<div class="card"><b>Usage billing · 1 November</b><span>4 schema changes, built and in review</span></div>
<div class="card"><b>2 open risks</b><span>meter latency at p99, the ninety-day backfill window</span></div>
<div class="card"><b>~$4,900 a month</b><span>at today's volume; usage billing adds about $310</span></div>
</section>
<h2>How a request travels</h2>
<p class="lead">Customers' requests enter one gateway per region. Usage leaves the request path as events, and the ledger is the only place that decides money.</p>
<div class="frame" data-screen-label="How a request travels">${DIAGRAM}
<div class="legend"><span><i></i>HTTPS call</span><span><i class="ev"></i>events</span><span><em>EU</em>processed in the EU</span><span><em>US</em>leaves the EU</span></div></div>
<h2>Environments</h2>
<table data-screen-label="Environments"><thead><tr><th>Environment</th><th>Regions</th><th>Data</th><th>Deploys</th></tr></thead><tbody>
<tr><td>Production</td><td>eu-central-1, us-east-1</td><td>Customer data; the ledger in the EU</td><td>From main, after the checks and one approval</td></tr>
<tr><td>Staging</td><td>eu-central-1</td><td>Generated accounts, a copy of the plans</td><td>Every merge to main</td></tr>
<tr><td>Preview</td><td>per pull request</td><td>Seeded fixtures only</td><td>Each push to a branch</td></tr>
</tbody></table>
<h2>Who may call what</h2>
<table data-screen-label="Who may call what"><thead><tr><th>Caller</th><th>Reaches</th><th>Never</th></tr></thead><tbody>
<tr><td>Customer API key</td><td>The account's own API, usage and limits</td><td>Another account, the admin API</td></tr>
<tr><td>Finance (SSO)</td><td>Billing mode, invoice previews, refunds</td><td>Customer data outside billing</td></tr>
<tr><td>Support (SSO)</td><td>Accounts, plans, the audit log to read</td><td>Billing mode, refunds</td></tr>
<tr><td>Services</td><td>Kafka topics and tables they own</td><td>Another service's tables</td></tr>
</tbody></table>
<h2>Where the work stands</h2>
<ul class="state" data-screen-label="Where the work stands">
<li><b class="done">Done</b>Meter events keyed by request id, five-minute windows written once</li>
<li><b class="done">Done</b>Usage lines through the existing invoice outbox; seat invoices unchanged</li>
<li><b class="open">In review</b>Finance's billing-mode switch, with both invoices side by side</li>
<li><b class="open">Before launch</b>Rebuild ninety days of usage from the access logs before they age out</li>
</ul>
</main></body></html>`

const DATA = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Data and retention · acme/platform</title>
<meta name="viewport" content="width=1240"><style>${CSS}</style></head><body><main>
<h1>Data and retention</h1>
<p class="lead">What each store keeps, for how long, and who may read it.</p>
<table><thead><tr><th>Data</th><th>Where</th><th>Kept</th><th>Read by</th></tr></thead><tbody>
<tr><td>Accounts and plans</td><td>Postgres, EU</td><td>While the account exists, then 30 days</td><td>Services, support</td></tr>
<tr><td>Usage windows</td><td>Postgres, EU</td><td>7 years, as invoices need</td><td>Billing, Finance</td></tr>
<tr><td>Meter events</td><td>Kafka, per region</td><td>7 days</td><td>The aggregator</td></tr>
<tr><td>Access logs</td><td>Warehouse, EU</td><td>90 days</td><td>The backfill, on-call</td></tr>
<tr><td>Idempotency keys</td><td>Redis, per region</td><td>24 hours</td><td>The gateway</td></tr>
</tbody></table>
</main></body></html>`

/** The backend artifact's pages, by page file. */
export const BACKEND_PAGES: Record<string, string> = { "index.html": PAGE, "data.html": DATA }
