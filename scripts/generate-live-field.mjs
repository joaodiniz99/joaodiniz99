#!/usr/bin/env node
/**
 * generate-live-field.mjs
 * Fetches joaodiniz99 contribution calendar and emits assets/live-field.svg
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

  const beamW = Math.max(18, cellW * 2.2);
  const beamX0 = gridLeft - beamW;
  const beamX1 = gridRight + 4;
  const mono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
  const statusLabel = offline ? "OFFLINE" : "ONLINE";
  const statusFill = offline ? C.dim : C.peak;
  const generated = generatedAt.slice(0, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Live contribution field — ${total} contributions, current streak ${currentStreak}">
  <defs>
    <linearGradient id="scanGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.peak}" stop-opacity="0"/>
      <stop offset="45%" stop-color="${C.peak}" stop-opacity="0.14"/>
      <stop offset="50%" stop-color="${C.hairline}" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="${C.peak}" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="${C.peak}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="gridClip">
      <rect x="${gridLeft - 1}" y="${gridTop - 1}" width="${gridW + 2}" height="${gridH + 2}" rx="4"/>
    </clipPath>
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

  <g clip-path="url(#gridClip)">
    <rect x="${beamX0}" y="${gridTop - 1}" width="${beamW.toFixed(1)}" height="${gridH + 2}" fill="url(#scanGrad)" opacity="0.95">
      <animate attributeName="x" from="${beamX0}" to="${beamX1}" dur="9.5s" repeatCount="indefinite"/>
    </rect>
    <rect x="${beamX0 + beamW * 0.48}" y="${gridTop - 1}" width="1.2" height="${gridH + 2}" fill="${C.peak}" opacity="0.35">
      <animate attributeName="x" from="${beamX0 + beamW * 0.48}" to="${beamX1 + beamW * 0.48}" dur="9.5s" repeatCount="indefinite"/>
    </rect>
  </g>

  <text x="36" y="${H - 16}" class="foot">&gt; contributions · public graph · regenerates daily · generated: ${escapeXml(generated)}</text>

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
