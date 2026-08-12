#!/usr/bin/env node
/**
 * generate-live-field.mjs
 * Fetches joaodiniz99 contribution calendar and emits assets/live-field.svg
 * LIVE.FIELD arena = real contribution grid + Tron light-cycle duel (SMIL).
 *
 * Auth: GITHUB_TOKEN env, or gh auth token fallback for local runs.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOGIN = "joaodiniz99";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets", "live-field.svg");

const W = 1200;
const H = 280;

const C = {
  bg: "#0a0a0f",
  panel: "#12121a",
  hairline: "#e2e2e8",
  text: "#e2e2e8",
  muted: "#8888a0",
  dim: "#5a5a70",
  empty: "#16161e",
  low: "#2a2a36",
  mid: "#5a5a70",
  high: "#e2e2e8",
  peak: "#4aff8a",
  bezel: "#1e1e28",
  cyan: "#4ae8ff",
  amber: "#ffa84a",
  green: "#4aff8a",
};

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
  }
}
`;

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const t = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (t) return t;
  } catch {
    /* no gh */
  }
  return null;
}

async function fetchCalendar(token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "live-field-generator",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GraphQL HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const cal = json?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!cal) throw new Error("No contributionCalendar in response");
  return cal;
}

function emptyCalendar() {
  const weeks = [];
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 52 * 7);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start);
      dt.setUTCDate(start.getUTCDate() + w * 7 + d);
      days.push({
        contributionCount: 0,
        date: dt.toISOString().slice(0, 10),
      });
    }
    weeks.push({ contributionDays: days });
  }
  return { totalContributions: 0, weeks };
}

function flattenDays(weeks) {
  const days = [];
  for (const w of weeks) {
    for (const d of w.contributionDays) {
      days.push({ date: d.date, count: d.contributionCount ?? 0 });
    }
  }
  return days;
}

function computeStreaks(days) {
  if (!days.length) return { current: 0, longest: 0 };
  let i = days.length - 1;
  if (days[i].count === 0) i -= 1;
  let current = 0;
  for (let j = i; j >= 0; j--) {
    if (days[j].count > 0) current += 1;
    else break;
  }
  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d.count > 0) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return { current, longest };
}

function weekTotals(weeks) {
  return weeks.map((w) =>
    w.contributionDays.reduce((s, d) => s + (d.contributionCount ?? 0), 0),
  );
}

function levelFor(count, thresholds) {
  if (count <= 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

function computeThresholds(days) {
  const nonzero = days.map((d) => d.count).filter((c) => c > 0).sort((a, b) => a - b);
  if (!nonzero.length) return [1, 2, 4];
  const q = (p) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * (nonzero.length - 1)))];
  const t1 = Math.max(1, q(0.35));
  const t2 = Math.max(t1 + 1, q(0.65));
  const t3 = Math.max(t2 + 1, q(0.88));
  return [t1, t2, t3];
}

function fillForLevel(level) {
  switch (level) {
    case 0: return C.empty;
    case 1: return C.low;
    case 2: return C.mid;
    case 3: return C.high;
    case 4: return C.peak;
    default: return C.empty;
  }
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Orthogonal light-cycle routes in week/day cell space (closed loops). */
function lightCycleRoutes(nWeeks) {
  const maxW = Math.max(8, nWeeks - 1);

  // Cycle A — ice/cyan: upper corridors, left-origin duel line
  const cyan = [
    [1, 1], [16, 1], [16, 3], [28, 3], [28, 0], [40, 0], [40, 2],
    [48, 2], [48, 4], [36, 4], [36, 6], [22, 6], [22, 4], [10, 4],
    [10, 2], [1, 2], [1, 1],
  ].map(([w, d]) => [Math.min(w, maxW), d]);

  // Cycle B — amber/gold: lower/right corridors, opposing vector
  const amber = [
    [maxW - 1, 5], [38, 5], [38, 3], [26, 3], [26, 5], [14, 5],
    [14, 2], [6, 2], [6, 6], [18, 6], [18, 0], [30, 0], [30, 2],
    [42, 2], [42, 6], [maxW - 1, 6], [maxW - 1, 5],
  ].map(([w, d]) => [Math.min(Math.max(0, w), maxW), d]);

  // Cycle C — green accent: tighter mid loop (house peak color)
  const mid = Math.floor(maxW * 0.55);
  const green = [
    [mid - 8, 2], [mid + 4, 2], [mid + 4, 5], [mid + 12, 5],
    [mid + 12, 1], [mid + 2, 1], [mid + 2, 4], [mid - 8, 4],
    [mid - 8, 2],
  ].map(([w, d]) => [Math.min(Math.max(0, w), maxW), Math.min(6, Math.max(0, d))]);

  return { cyan, amber, green };
}

function expandOrthogonal(waypoints) {
  if (!waypoints.length) return [];
  const out = [[waypoints[0][0], waypoints[0][1]]];
  for (let i = 1; i < waypoints.length; i++) {
    let [cw, cd] = out[out.length - 1];
    const [tw, td] = waypoints[i];
    // Prefer horizontal then vertical (classic light-cycle turn order)
    while (cw !== tw) {
      cw += tw > cw ? 1 : -1;
      out.push([cw, cd]);
    }
    while (cd !== td) {
      cd += td > cd ? 1 : -1;
      out.push([cw, cd]);
    }
  }
  return out;
}

function pathFromCells(cells, cellAt) {
  const pts = cells.map(([w, d]) => cellAt(w, d));
  if (!pts.length) return { d: "", len: 0, pts: [] };
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return { d, len, pts };
}

function buildTronGridLines({ gridLeft, gridTop, cellW, cellH, cellGap, nWeeks }) {
  const lines = [];
  const right = gridLeft + nWeeks * (cellW + cellGap) - cellGap;
  const bottom = gridTop + 7 * (cellH + cellGap) - cellGap;

  // Horizontal day lanes
  for (let d = 0; d <= 7; d++) {
    const y = gridTop + d * (cellH + cellGap) - cellGap / 2;
    lines.push(
      `<line x1="${gridLeft.toFixed(1)}" y1="${y.toFixed(1)}" x2="${right.toFixed(1)}" y2="${y.toFixed(1)}"/>`,
    );
  }
  // Vertical week lanes (every week for dense grid feel, very faint)
  for (let w = 0; w <= nWeeks; w++) {
    const x = gridLeft + w * (cellW + cellGap) - cellGap / 2;
    lines.push(
      `<line x1="${x.toFixed(1)}" y1="${gridTop.toFixed(1)}" x2="${x.toFixed(1)}" y2="${bottom.toFixed(1)}"/>`,
    );
  }
  return lines.join("\n      ");
}

function buildLightCyclesMarkup({
  gridLeft,
  gridTop,
  cellW,
  cellH,
  cellGap,
  nWeeks,
}) {
  const stepX = cellW + cellGap;
  const stepY = cellH + cellGap;
  const cellAt = (w, d) => [
    gridLeft + w * stepX + cellW / 2,
    gridTop + d * stepY + cellH / 2,
  ];

  const routes = lightCycleRoutes(nWeeks);
  const cycles = [
    {
      id: "lcCyan",
      color: C.cyan,
      glowId: "glowCyan",
      trailW: 3.2,
      coreW: 1.4,
      dur: "16s",
      begin: "0s",
      waypoints: routes.cyan,
    },
    {
      id: "lcAmber",
      color: C.amber,
      glowId: "glowAmber",
      trailW: 3.2,
      coreW: 1.4,
      dur: "18s",
      begin: "0.8s",
      waypoints: routes.amber,
    },
    {
      id: "lcGreen",
      color: C.green,
      glowId: "glowGreen",
      trailW: 2.4,
      coreW: 1.1,
      dur: "14s",
      begin: "1.4s",
      waypoints: routes.green,
    },
  ];

  const built = cycles.map((c) => {
    const cells = expandOrthogonal(c.waypoints);
    const path = pathFromCells(cells, cellAt);
    return { ...c, ...path, cells };
  });

  // Near-miss flash: midpoint corridor where cyan/amber corridors nearly cross
  const near = cellAt(Math.floor(nWeeks * 0.48), 3);

  const pathDefs = built
    .map(
      (c) =>
        `<path id="${c.id}Path" d="${c.d}" fill="none"/>`,
    )
    .join("\n    ");

  const trails = built
    .map((c) => {
      const dash = Math.max(40, c.len).toFixed(1);
      return `<g class="trail-${c.id}">
      <path d="${c.d}" fill="none" stroke="${c.color}" stroke-width="${c.trailW}" stroke-linecap="square" stroke-linejoin="miter" opacity="0.35" filter="url(#${c.glowId})" stroke-dasharray="${dash}" stroke-dashoffset="0">
        <animate attributeName="stroke-dashoffset" from="${dash}" to="0" dur="${c.dur}" begin="${c.begin}" repeatCount="indefinite"/>
      </path>
      <path d="${c.d}" fill="none" stroke="${c.color}" stroke-width="${c.coreW}" stroke-linecap="square" stroke-linejoin="miter" opacity="0.95" stroke-dasharray="${dash}" stroke-dashoffset="0">
        <animate attributeName="stroke-dashoffset" from="${dash}" to="0" dur="${c.dur}" begin="${c.begin}" repeatCount="indefinite"/>
      </path>
      <path d="${c.d}" fill="none" stroke="${c.color}" stroke-width="1.2" stroke-linecap="square" opacity="0.18" filter="url(#${c.glowId})"/>
    </g>`;
    })
    .join("\n    ");

  const bikes = built
    .map((c) => {
      return `<g>
      <animateMotion dur="${c.dur}" begin="${c.begin}" repeatCount="indefinite" rotate="auto">
        <mpath xlink:href="#${c.id}Path"/>
      </animateMotion>
      <circle r="5.5" fill="${c.color}" opacity="0.22" filter="url(#${c.glowId})"/>
      <polygon points="7,0 -5,-3.8 -3,0 -5,3.8" fill="${c.color}"/>
      <rect x="-7" y="-1.6" width="5" height="3.2" rx="0.6" fill="${c.color}" opacity="0.9"/>
      <circle cx="5.2" cy="0" r="1.35" fill="#ffffff" opacity="0.95"/>
    </g>`;
    })
    .join("\n    ");

  return {
    pathDefs,
    markup: `
  <!-- light-cycle duel layer -->
  <g id="lightCycles" clip-path="url(#gridClip)">
    ${trails}
    <circle cx="${near[0].toFixed(1)}" cy="${near[1].toFixed(1)}" r="6" fill="${C.hairline}" opacity="0">
      <animate attributeName="opacity" values="0;0;0.55;0;0;0.4;0" keyTimes="0;0.42;0.45;0.5;0.72;0.75;1" dur="16s" repeatCount="indefinite"/>
      <animate attributeName="r" values="3;3;9;4;3;8;3" keyTimes="0;0.42;0.45;0.5;0.72;0.75;1" dur="16s" repeatCount="indefinite"/>
    </circle>
    ${bikes}
  </g>`,
  };
}

function buildSvg({ weeks, total, currentStreak, longestStreak, generatedAt, offline }) {
  const padX = 36;
  const padTop = 48;
  const padBottom = 42;
  const gridTop = padTop + 8;
  const gridBottom = H - padBottom;
  const gridH = gridBottom - gridTop;
  const gridLeft = padX + 8;
  const gridRight = W - padX - 8;
  const gridW = gridRight - gridLeft;

  const nWeeks = weeks.length;
  const cellGap = 3;
  const cellW = (gridW - cellGap * (nWeeks - 1)) / nWeeks;
  const cellH = (gridH - cellGap * 6) / 7;
  const cellR = Math.min(2.5, cellW * 0.35, cellH * 0.35);

  const days = flattenDays(weeks);
  const thresholds = computeThresholds(days);
  const totals = weekTotals(weeks);
  const last12 = totals.slice(-12);
  const max12 = Math.max(1, ...last12);

  const sparkW = 120;
  const sparkH = 16;
  const sparkX = W - padX - sparkW - 8;
  const sparkY = H - 28;

  const cells = [];
  weeks.forEach((week, wi) => {
    week.contributionDays.forEach((day, di) => {
      const count = day.contributionCount ?? 0;
      const level = levelFor(count, thresholds);
      const x = gridLeft + wi * (cellW + cellGap);
      const y = gridTop + di * (cellH + cellGap);
      const fill = fillForLevel(level);
      if (level === 4) {
        cells.push(
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" rx="${cellR}" fill="${fill}" stroke="${C.peak}" stroke-opacity="0.55" stroke-width="0.6"/>`,
        );
      } else {
        cells.push(
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" rx="${cellR}" fill="${fill}"/>`,
        );
      }
    });
  });

  let sparkPath = "";
  if (last12.length) {
    const pts = last12.map((v, i) => {
      const x = sparkX + (last12.length === 1 ? sparkW / 2 : (i / (last12.length - 1)) * sparkW);
      const y = sparkY + sparkH - (v / max12) * sparkH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    sparkPath = `<polyline fill="none" stroke="${C.dim}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}"/>`;
    const last = pts[pts.length - 1].split(",");
    sparkPath += `<circle cx="${last[0]}" cy="${last[1]}" r="1.8" fill="${C.peak}"/>`;
  }

  const mono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
  const statusLabel = offline ? "OFFLINE" : "ONLINE";
  const statusFill = offline ? C.dim : C.peak;
  const generated = generatedAt.slice(0, 10);

  const tronLines = buildTronGridLines({
    gridLeft,
    gridTop,
    cellW,
    cellH,
    cellGap,
    nWeeks,
  });

  const { pathDefs, markup: lightCyclesMarkup } = buildLightCyclesMarkup({
    gridLeft,
    gridTop,
    cellW,
    cellH,
    cellGap,
    nWeeks,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Live field light cycles — ${total} contributions, current streak ${currentStreak}">
  <defs>
    <filter id="glowCyan" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowAmber" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowGreen" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="gridClip">
      <rect x="${gridLeft - 1}" y="${gridTop - 1}" width="${gridW + 2}" height="${gridH + 2}" rx="4"/>
    </clipPath>
    ${pathDefs}
    <style>
      <![CDATA[
        .hud-title { font-family: ${mono}; font-size: 13px; font-weight: 700; fill: ${C.text}; letter-spacing: 3.2px; }
        .hud-meta { font-family: ${mono}; font-size: 12px; fill: ${C.muted}; letter-spacing: 1.6px; }
        .hud-num { font-family: ${mono}; font-size: 12px; fill: ${C.text}; letter-spacing: 1.4px; }
        .hud-dim { font-family: ${mono}; font-size: 11px; fill: ${C.dim}; letter-spacing: 1.2px; }
        .foot { font-family: ${mono}; font-size: 11px; fill: ${C.dim}; letter-spacing: 0.8px; }
        @keyframes pulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
        .pulse { animation: pulse 2.2s ease-in-out infinite; }
      ]]>
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.bg}" rx="10"/>
  <rect x="14" y="12" width="${W - 28}" height="${H - 24}" rx="8" fill="none" stroke="${C.bezel}" stroke-width="1.4"/>

  <line x1="28" y1="40" x2="${W - 28}" y2="40" stroke="${C.hairline}" stroke-opacity="0.08" stroke-width="1"/>
  <line x1="28" y1="${H - 36}" x2="${W - 28}" y2="${H - 36}" stroke="${C.hairline}" stroke-opacity="0.06" stroke-width="1"/>

  <text x="36" y="30" class="hud-title">LIVE.FIELD</text>
  <text x="220" y="30" class="hud-meta">TOTAL //</text>
  <text x="300" y="30" class="hud-num">${escapeXml(String(total))}</text>
  <text x="420" y="30" class="hud-meta">STREAK //</text>
  <text x="510" y="30" class="hud-num">${escapeXml(String(currentStreak))}</text>
  <text x="548" y="30" class="hud-dim">current${longestStreak > 0 ? ` · max ${longestStreak}` : ""}</text>

  <g transform="translate(${W - 148}, 14)">
    <rect x="0" y="0" width="110" height="22" rx="11" fill="${C.panel}" stroke="${C.dim}" stroke-opacity="0.55" stroke-width="1"/>
    <circle class="pulse" cx="14" cy="11" r="3.4" fill="${statusFill}"/>
    <text x="26" y="15" font-family="${mono}" font-size="10" font-weight="700" fill="${C.muted}" letter-spacing="1.4">${statusLabel}</text>
  </g>

  <rect x="${gridLeft - 10}" y="${gridTop - 8}" width="${gridW + 20}" height="${gridH + 16}" rx="6" fill="${C.panel}" stroke="${C.bezel}" stroke-width="1"/>

  <g id="field">
    ${cells.join("\n    ")}
  </g>

  <!-- subtle Tron grid over cells -->
  <g id="tronGrid" clip-path="url(#gridClip)" fill="none" stroke="${C.cyan}" stroke-opacity="0.07" stroke-width="0.5">
    ${tronLines}
  </g>
${lightCyclesMarkup}

  <text x="36" y="${H - 16}" class="foot">&gt; light cycles · contributions · regenerates daily · generated: ${escapeXml(generated)}</text>

  <g opacity="0.9">
    <text x="${sparkX - 4}" y="${sparkY + sparkH - 2}" text-anchor="end" class="hud-dim" style="font-size:9px;letter-spacing:1px">12W</text>
    ${sparkPath}
  </g>
</svg>
`;
}

async function main() {
  const token = resolveToken();
  let cal;
  let offline = false;

  if (!token) {
    console.warn("No GITHUB_TOKEN / gh auth — emitting empty-state SVG");
    cal = emptyCalendar();
    offline = true;
  } else {
    try {
      cal = await fetchCalendar(token);
    } catch (err) {
      console.error("Fetch failed, falling back to empty-state:", err.message);
      cal = emptyCalendar();
      offline = true;
    }
  }

  const days = flattenDays(cal.weeks);
  const { current, longest } = computeStreaks(days);
  const generatedAt = new Date().toISOString();

  const svg = buildSvg({
    weeks: cal.weeks,
    total: cal.totalContributions ?? 0,
    currentStreak: current,
    longestStreak: longest,
    generatedAt,
    offline,
  });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg, "utf8");

  console.log(
    JSON.stringify(
      {
        out: OUT,
        total: cal.totalContributions ?? 0,
        currentStreak: current,
        longestStreak: longest,
        weeks: cal.weeks.length,
        days: days.length,
        offline,
        generatedAt,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
