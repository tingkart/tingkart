// Builds every generated SVG for the profile README.
//
// Data:
//   - GitHub GraphQL API (token in GH_TOKEN)
//   - Allemannsdata spot prices NO1-NO5 (no key)
// Output: generated/*.svg, one light and one dark file per graphic.
//
// Usage:
//   GH_TOKEN=... node scripts/build.mjs           real data
//   node scripts/build.mjs --mock                  fake GitHub data, for a local preview only

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const LOGIN = process.env.GH_LOGIN || "tingkart";
const MOCK = process.argv.includes("--mock");
const HC = "https://cdnjs.cloudflare.com/ajax/libs/highcharts/12.3.0";
const ADATA = "https://allemannsdata.com/wiki/api/v1";
const UA = "tingkart-profile-readme/1.0 (+https://github.com/tingkart)";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const THEMES = {
  light: {
    bg: "#ffffff", fg: "#1f2328", sub: "#59636e", grid: "#eaeef2", border: "#d1d9e0",
    key: "#bc4c00", accent: "#0969da", good: "#1a7f37", bad: "#cf222e",
    heat: ["#eff2f5", "#aceebb", "#4ac26b", "#2da44e", "#116329"],
    series: ["#0969da", "#1a7f37", "#bc4c00", "#8250df", "#cf222e"],
  },
  dark: {
    bg: "#0d1117", fg: "#f0f6fc", sub: "#9198a1", grid: "#21262d", border: "#3d444d",
    key: "#ffa657", accent: "#58a6ff", good: "#3fb950", bad: "#ff7b72",
    heat: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"],
    series: ["#58a6ff", "#3fb950", "#ffa657", "#bc8cff", "#ff7b72"],
  },
};

// ---------- data ----------

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function githubData() {
  if (MOCK) return mockGithub();
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is not set. Use --mock for a local preview.");
  const query = `query($login:String!){ user(login:$login){
    createdAt followers{totalCount}
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      totalCount nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } } }
    repositoriesContributedTo(first:1, includeUserRepositories:false, contributionTypes:[COMMIT,PULL_REQUEST,ISSUE,REPOSITORY]){ totalCount }
    contributionsCollection{
      totalCommitContributions totalPullRequestContributions restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ date weekday contributionCount } } } } } }`;
  const json = await getJson("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const u = json.data.user;
  const langs = {};
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    for (const e of r.languages.edges) {
      langs[e.node.name] ??= { size: 0, color: e.node.color };
      langs[e.node.name].size += e.size;
    }
  }
  const cc = u.contributionsCollection;
  return {
    createdAt: u.createdAt,
    followers: u.followers.totalCount,
    repos: u.repositories.totalCount,
    contributedTo: u.repositoriesContributedTo.totalCount,
    stars,
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    prs: cc.totalPullRequestContributions,
    total: cc.contributionCalendar.totalContributions,
    weeks: cc.contributionCalendar.weeks.map((w) => w.contributionDays),
    langs,
  };
}

function mockGithub() {
  // Fake numbers so the layout can be checked offline. Never committed as real output.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = new Date(Date.UTC(2025, 10, 9));
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start.getTime() + (w * 7 + d) * 864e5);
      const busy = d > 0 && d < 6 ? 1 : 0.35;
      const c = rnd() < 0.25 ? 0 : Math.round(rnd() * 14 * busy * (0.5 + w / 60));
      days.push({ date: dt.toISOString().slice(0, 10), weekday: d, contributionCount: c });
    }
    weeks.push(days);
  }
  const total = weeks.flat().reduce((s, d) => s + d.contributionCount, 0);
  return {
    createdAt: "2019-03-01T00:00:00Z", followers: 3, repos: 2, contributedTo: 4, stars: 2,
    commits: Math.round(total * 0.8), prs: 12, total, weeks,
    langs: { HTML: { size: 52000, color: "#e34c26" }, Shell: { size: 9000, color: "#89e051" },
      Python: { size: 31000, color: "#3572A5" }, TypeScript: { size: 44000, color: "#3178c6" } },
  };
}

async function spotPrices() {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
  const out = { date, areas: {}, retrievedAt: new Date().toISOString(), failed: [] };
  for (const area of ["NO1", "NO2", "NO3", "NO4", "NO5"]) {
    try {
      const j = await getJson(`${ADATA}/kilder/strompris/get_prices?date=${date}&area=${area}&limit=100`);
      out.areas[area] = j.data.prices.map((p) => [Date.parse(p.time_start_utc), +(p.NOK_per_kWh * 100).toFixed(1)]);
    } catch (e) {
      out.failed.push(area);
      console.warn(`spot price ${area} failed: ${e.message}`);
    }
  }
  return out;
}

// ---------- chart configs ----------

function base(t, w, h, title, subtitle) {
  return {
    chart: {
      width: w, height: h, backgroundColor: t.bg, borderColor: t.border, borderWidth: 1, borderRadius: 12,
      spacing: [18, 20, 14, 20], style: { fontFamily: FONT },
    },
    title: { text: title, align: "left", style: { color: t.fg, fontSize: "17px", fontWeight: "700" } },
    subtitle: { text: subtitle, align: "left", style: { color: t.sub, fontSize: "12px" } },
    credits: { enabled: false },
    legend: { itemStyle: { color: t.sub, fontWeight: "500" }, itemHoverStyle: { color: t.fg } },
    plotOptions: { series: { animation: false, enableMouseTracking: false } },
    accessibility: { enabled: false },
    exporting: { enabled: false },
  };
}

function heatmapConfig(t, gh) {
  const data = [];
  gh.weeks.forEach((days, x) => days.forEach((d) => data.push([x, d.weekday, d.contributionCount])));
  const max = Math.max(1, ...data.map((d) => d[2]));
  const best = gh.weeks.flat().reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a));
  return {
    ...base(t, 1000, 250, `${gh.total.toLocaleString("en-US")} contributions in the last year`,
      `Best day: ${best.date} with ${best.contributionCount}`),
    chart: { ...base(t, 1000, 250).chart, type: "heatmap" },
    xAxis: { visible: false },
    yAxis: {
      categories: ["", "Mon", "", "Wed", "", "Fri", ""], reversed: true, title: null, min: 0, max: 6,
      gridLineWidth: 0, tickInterval: 1, startOnTick: false, endOnTick: false,
      labels: { style: { color: t.sub, fontSize: "11px" } },
    },
    colorAxis: {
      min: 0, max, stops: t.heat.map((c, i) => [i / (t.heat.length - 1), c]),
      labels: { style: { color: t.sub } },
    },
    legend: { ...base(t, 1, 1).legend, enabled: false },
    series: [{ data, borderWidth: 3, borderColor: t.bg, borderRadius: 3, colsize: 1 }],
  };
}

function weekdayConfig(t, gh) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const sums = [0, 0, 0, 0, 0, 0, 0];
  gh.weeks.flat().forEach((d) => (sums[d.weekday] += d.contributionCount));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const top = names[sums.indexOf(Math.max(...sums))];
  return {
    ...base(t, 492, 360, "When I ship", `Contributions by weekday · peak on ${top}`),
    chart: { ...base(t, 492, 360).chart, polar: true, type: "column" },
    pane: { size: "82%", background: [{ backgroundColor: "transparent", borderWidth: 0 }] },
    xAxis: {
      categories: order.map((i) => names[i]), tickmarkPlacement: "on", lineWidth: 0,
      gridLineColor: t.grid, labels: { style: { color: t.sub, fontSize: "12px" } },
    },
    yAxis: { min: 0, gridLineColor: t.grid, labels: { enabled: false }, title: null },
    legend: { enabled: false },
    plotOptions: { ...base(t, 1, 1).plotOptions, column: { pointPadding: 0, groupPadding: 0.04, borderWidth: 0, borderRadius: 4 } },
    series: [{ data: order.map((i) => ({ y: sums[i], color: i === 0 || i === 6 ? t.key : t.accent })) }],
  };
}

function langConfig(t, gh) {
  const entries = Object.entries(gh.langs).sort((a, b) => b[1].size - a[1].size);
  const total = entries.reduce((s, [, v]) => s + v.size, 0) || 1;
  const top = entries.slice(0, 6);
  const rest = entries.slice(6).reduce((s, [, v]) => s + v.size, 0);
  const data = top.map(([name, v]) => ({ name, y: +(100 * v.size / total).toFixed(1), color: v.color || t.sub }));
  if (rest) data.push({ name: "Other", y: +(100 * rest / total).toFixed(1), color: t.grid });
  return {
    ...base(t, 492, 360, "What I write", `Language share of code in ${gh.repos} public repos`),
    chart: { ...base(t, 492, 360).chart, type: "pie" },
    plotOptions: {
      pie: {
        animation: false, enableMouseTracking: false, innerSize: "62%", borderWidth: 2, borderColor: t.bg,
        dataLabels: {
          enabled: true, distance: 14, format: "{point.name} <span style=\"opacity:.6\">{point.y}%</span>",
          style: { color: t.fg, textOutline: "none", fontSize: "12px", fontWeight: "500" }, connectorColor: t.border,
        },
      },
    },
    series: [{ data }],
  };
}

function powerConfig(t, sp) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" });
  const series = Object.entries(sp.areas).map(([area, data], i) => ({
    name: { NO1: "NO1 Oslo", NO2: "NO2 Kristiansand", NO3: "NO3 Trondheim", NO4: "NO4 Tromsø", NO5: "NO5 Bergen" }[area],
    data, color: t.series[i], lineWidth: area === "NO5" ? 3.5 : 2, step: "left", zIndex: area === "NO5" ? 5 : 1,
  }));
  const failed = sp.failed.length ? ` · missing: ${sp.failed.join(", ")}` : "";
  return {
    ...base(t, 1000, 340, `Norwegian power prices today, ${sp.date}`,
      `Live from Allemannsdata · spot price, øre/kWh excl. VAT and grid tariff · retrieved ${fmt.format(new Date(sp.retrievedAt))} Oslo time${failed}`),
    chart: { ...base(t, 1000, 340).chart, type: "line" },
    time: { timezone: "Europe/Oslo" },
    xAxis: {
      type: "datetime", lineColor: t.border, tickColor: t.border, labels: { format: "{value:%H:%M}", style: { color: t.sub } },
    },
    yAxis: { title: null, gridLineColor: t.grid, startOnTick: false, endOnTick: false, labels: { style: { color: t.sub } } },
    legend: { ...base(t, 1, 1).legend, align: "left", verticalAlign: "bottom", margin: 8 },
    plotOptions: { ...base(t, 1, 1).plotOptions, line: { marker: { enabled: false } } },
    series,
  };
}

// ---------- neofetch card ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function neofetchSvg(t, name, gh, sp) {
  const art = readFileSync(`assets/ascii_${name}.txt`, "utf8").split("\n");
  while (art.length && !art[0].trim()) art.shift();
  while (art.length && !art[art.length - 1].trim()) art.pop();
  const W = 1000, CH = 5.5, LH = 11.6;
  const WIDTH = 64; // characters per info line
  const lines = [];
  const header = (title) => lines.push({ kind: "h", title });
  const kv = (k, v, extra = "") => lines.push({ kind: "kv", k, v: String(v), extra });
  const blank = () => lines.push({ kind: "blank" });

  const yearsOnGh = ((Date.now() - Date.parse(gh.createdAt)) / (365.25 * 864e5)).toFixed(1);
  const no5 = sp.areas.NO5;
  const nowP = no5?.filter(([ts]) => ts <= Date.now()).pop();
  const topLang = Object.entries(gh.langs).sort((a, b) => b[1].size - a[1].size).slice(0, 4).map(([n]) => n).join(", ");

  header("thomas@highsoft");
  kv("OS", "macOS, Linux, the occasional fjord");
  kv("Uptime", "25+ years of shipping software");
  kv("Host", "Highsoft AS (Highcharts)");
  kv("Kernel", "Lead AI Scientist");
  kv("Shell", "MCP servers, all the way down");
  kv("Location", "Jølster, Norway");
  blank();
  kv("Projects.Data", "Allemannsdata, OffentligData");
  kv("Projects.Civic", "KommuneScan");
  kv("Projects.IoT", "Wodly");
  kv("Projects.Maps", "Tingkart, 3D Norway");
  kv("Languages.Code", topLang || "n/a");
  kv("Languages.Real", "Norwegian, English");
  kv("Interests", "Open data, digital sovereignty");
  blank();
  header("Contact");
  kv("Web", "tingkart.com");
  kv("Data", "allemannsdata.com");
  kv("LinkedIn", "sysfrog");
  blank();
  header("Live");
  kv("Repos", `${gh.repos} {Contributed: ${gh.contributedTo}}`, `Stars: ${gh.stars}`);
  kv("Contributions", gh.total.toLocaleString("en-US"), `Followers: ${gh.followers}`);
  kv("Commits (1y)", gh.commits.toLocaleString("en-US"), `GitHub: ${yearsOnGh} y`);
  kv("Power.NO5", nowP ? `${nowP[1]} øre/kWh right now` : "unavailable");

  const artX = 26, artY = 40, infoX = 470;
  const height = Math.max(art.length * LH, lines.length * 19.5) + 64;
  const infoW = W - infoX - 26;
  const dots = (n) => " " + ".".repeat(Math.max(2, n)) + " ";

  let y = artY;
  const info = lines.map((l) => {
    const row = y; y += 19.5;
    if (l.kind === "blank") return "";
    if (l.kind === "h") {
      const fill = "-".repeat(Math.max(3, WIDTH - l.title.length - 4));
      return `<text x="${infoX}" y="${row}" textLength="${infoW}" lengthAdjust="spacingAndGlyphs"><tspan fill="${t.accent}" font-weight="700">${esc(l.title)}</tspan><tspan fill="${t.border}"> ${fill}-—-</tspan></text>`;
    }
    if (l.extra) {
      // Two columns on one line, like "Repos .... 2 | Stars .... 2".
      const left = 36, right = WIDTH - left - 3;
      const [ek, ev] = l.extra.split(": ");
      const ld = left - 2 - l.k.length - l.v.length - 2;
      const rd = right - ek.length - 1 - ev.length - 2;
      return `<text x="${infoX}" y="${row}" textLength="${infoW}" lengthAdjust="spacingAndGlyphs"><tspan fill="${t.sub}">. </tspan><tspan fill="${t.key}">${esc(l.k)}:</tspan><tspan fill="${t.border}">${dots(ld - 1)}</tspan><tspan fill="${t.fg}">${esc(l.v)}</tspan><tspan fill="${t.sub}"> | </tspan><tspan fill="${t.key}">${esc(ek)}:</tspan><tspan fill="${t.border}">${dots(rd - 1)}</tspan><tspan fill="${t.fg}">${esc(ev)}</tspan></text>`;
    }
    const d = WIDTH - 2 - l.k.length - 1 - l.v.length - 2;
    const live = l.k === "Power.NO5" ? t.good : t.fg;
    return `<text x="${infoX}" y="${row}" textLength="${infoW}" lengthAdjust="spacingAndGlyphs"><tspan fill="${t.sub}">. </tspan><tspan fill="${t.key}">${esc(l.k)}:</tspan><tspan fill="${t.border}">${dots(d)}</tspan><tspan fill="${live}">${esc(l.v)}</tspan></text>`;
  }).join("\n");

  // Leading spaces become an x offset and inner spaces become no-break spaces,
  // so every viewer keeps the columns aligned.
  const artTop = artY + Math.max(0, (lines.length * 19.5 - art.length * LH) / 2);
  const artSvg = art.map((row, i) => {
    const lead = row.length - row.trimStart().length;
    const body = row.trim();
    if (!body) return "";
    return `<text x="${(artX + lead * CH).toFixed(1)}" y="${(artTop + i * LH).toFixed(1)}" textLength="${(body.length * CH).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(body.replace(/ /g, "\u00a0"))}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round(height)}" viewBox="0 0 ${W} ${Math.round(height)}">
<style>
text{font-family:${MONO};font-size:13px;white-space:pre}
.art text{font-size:9.5px;fill:${t.fg};opacity:.92}
.cur{animation:blink 1.1s steps(1) infinite}@keyframes blink{50%{opacity:0}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${Math.round(height) - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
<g class="art">${artSvg}</g>
${info}
<text x="${infoX}" y="${Math.round(height) - 22}" fill="${t.sub}">thomas@highsoft:~$ <tspan class="cur" fill="${t.fg}">█</tspan></text>
</svg>`;
}

// ---------- render ----------

async function renderCharts(configs) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<html><body>
    <script src="${HC}/highcharts.js"></script>
    <script src="${HC}/highcharts-more.js"></script>
    <script src="${HC}/modules/heatmap.js"></script>
    <script src="${HC}/modules/exporting.js"></script>
    <div id="c"></div></body></html>`, { waitUntil: "networkidle" });
  const out = {};
  for (const [key, cfg] of Object.entries(configs)) {
    out[key] = await page.evaluate(async (cfg) => {
      const chart = Highcharts.chart("c", cfg);
      const svg = await chart.getSVG();
      chart.destroy();
      return svg;
    }, cfg);
  }
  await browser.close();
  return out;
}

const gh = await githubData();
const sp = await spotPrices();
mkdirSync("generated", { recursive: true });

const configs = {};
for (const [name, t] of Object.entries(THEMES)) {
  configs[`heatmap_${name}`] = heatmapConfig(t, gh);
  configs[`weekday_${name}`] = weekdayConfig(t, gh);
  configs[`languages_${name}`] = langConfig(t, gh);
  if (Object.keys(sp.areas).length) configs[`power_${name}`] = powerConfig(t, sp);
  writeFileSync(`generated/neofetch_${name}.svg`, neofetchSvg(t, name, gh, sp));
}
if (MOCK) writeFileSync("generated/configs.json", JSON.stringify(configs, null, 1));
const svgs = await renderCharts(configs);
for (const [k, svg] of Object.entries(svgs)) writeFileSync(`generated/${k}.svg`, svg);
console.log(`built ${Object.keys(svgs).length + 2} SVGs${MOCK ? " (MOCK GitHub data)" : ""}`);
