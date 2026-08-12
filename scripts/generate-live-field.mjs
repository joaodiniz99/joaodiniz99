#!/usr/bin/env node
/**
 * generate-live-field.mjs
 * Fetches joaodiniz99 contribution calendar and emits assets/live-field.svg
 * Minimal LIVE.FIELD panel — dark cabinet, contribution grid, quiet HUD.
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
const H = 260;

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

function buildSvg({ weeks, total, currentStreak, generatedAt, offline }) {
  const padX = 36;
  const padTop = 44;
  const padBottom = 36;
  const gridTop = padTop + 10;
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

  const cells = [];
  weeks.forEach((week, wi) => {
    week.contributionDays.forEach((day, di) => {
      const count = day.contributionCount ?? 0;
      const level = levelFor(count, thresholds);
      const x = gridLeft + wi * (cellW + cellGap);
      const y = gridTop + di * (cellH + cellGap);
      const fill = fillForLevel(level);
      cells.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellW.toFixed(2)}" height="${cellH.toFixed(2)}" rx="${cellR}" fill="${fill}"/>`,
      );
    });
  });

  const mono =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
  const statusLabel = offline ? "OFFLINE" : "ONLINE";
  const statusFill = offline ? C.dim : C.peak;
  const generated = generatedAt.slice(0, 10);

  // Soft scan: one slow vertical wash, very low opacity — optional calm motion only
  const scanX = gridLeft - 4;
  const scanY = gridTop - 4;
  const scanW = gridW + 8;
  const scanH = gridH + 8;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Live field — ${total} contributions, streak ${currentStreak}">
  <defs>
    <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.hairline}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${C.hairline}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="${C.hairline}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="gridClip">
      <rect x="${(gridLeft - 4).toFixed(1)}" y="${(gridTop - 4).toFixed(1)}" width="${(gridW + 8).toFixed(1)}" height="${(gridH + 8).toFixed(1)}" rx="4"/>
    </clipPath>
    <style>
      <![CDATA[
        .hud-title { font-family: ${mono}; font-size: 12px; font-weight: 600; fill: ${C.text}; letter-spacing: 3.6px; }
        .hud-meta { font-family: ${mono}; font-size: 11px; fill: ${C.muted}; letter-spacing: 1.8px; }
        .hud-num { font-family: ${mono}; font-size: 11px; fill: ${C.text}; letter-spacing: 1.4px; }
        .foot { font-family: ${mono}; font-size: 10px; fill: ${C.dim}; letter-spacing: 0.9px; }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .pulse { animation: pulse 2.8s ease-in-out infinite; }
      ]]>
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.bg}" rx="10"/>
  <rect x="14" y="12" width="${W - 28}" height="${H - 24}" rx="8" fill="none" stroke="${C.bezel}" stroke-width="1"/>

  <text x="36" y="32" class="hud-title">LIVE.FIELD</text>
  <text x="200" y="32" class="hud-meta">TOTAL //</text>
  <text x="276" y="32" class="hud-num">${escapeXml(String(total))}</text>
  <text x="380" y="32" class="hud-meta">STREAK //</text>
  <text x="466" y="32" class="hud-num">${escapeXml(String(currentStreak))}</text>

  <g transform="translate(${W - 126}, 16)">
    <rect x="0" y="0" width="88" height="20" rx="10" fill="${C.panel}" stroke="${C.dim}" stroke-opacity="0.4" stroke-width="1"/>
    <circle class="pulse" cx="12" cy="10" r="2.8" fill="${statusFill}"/>
    <text x="22" y="14" font-family="${mono}" font-size="9" font-weight="600" fill="${C.muted}" letter-spacing="1.6">${statusLabel}</text>
  </g>

  <rect x="${(gridLeft - 10).toFixed(1)}" y="${(gridTop - 8).toFixed(1)}" width="${(gridW + 20).toFixed(1)}" height="${(gridH + 16).toFixed(1)}" rx="6" fill="${C.panel}" stroke="${C.bezel}" stroke-width="1"/>

  <g id="field">
    ${cells.join("\n    ")}
  </g>

  <g clip-path="url(#gridClip)" opacity="0.85" pointer-events="none">
    <rect x="${scanX.toFixed(1)}" y="${scanY.toFixed(1)}" width="${scanW.toFixed(1)}" height="18" fill="url(#scanGrad)">
      <animate attributeName="y" from="${scanY.toFixed(1)}" to="${(scanY + scanH - 18).toFixed(1)}" dur="14s" repeatCount="indefinite"/>
    </rect>
  </g>

  <text x="36" y="${H - 16}" class="foot">&gt; contributions · regenerates daily · generated: ${escapeXml(generated)}</text>
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
  const { current } = computeStreaks(days);
  const generatedAt = new Date().toISOString();

  const svg = buildSvg({
    weeks: cal.weeks,
    total: cal.totalContributions ?? 0,
    currentStreak: current,
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
