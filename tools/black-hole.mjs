#!/usr/bin/env node
// Generates assets/black-hole.svg — a lensed accretion disk built from orbital
// geometry rather than scattered arcs. Deterministic: same seed, same file.
//
//   node tools/black-hole.mjs                        > assets/black-hole.svg
//   node tools/black-hole.mjs --preset dense --seed 7 > /tmp/variant.svg

const PRESETS = {
  quiet: { rings: 150, opBase: 0.30, turb: 0.55, beamMax: 0.75, stars: 170, underOp: 0.32, wIn: 0.72 },
  halo:  { rings: 230, opBase: 0.50, turb: 0.85, beamMax: 1.00, stars: 220, underOp: 0.42, wIn: 0.85 },
  dense: { rings: 270, opBase: 0.66, turb: 1.15, beamMax: 1.00, stars: 260, underOp: 0.52, wIn: 0.95 },
};

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i === -1 ? d : argv[i + 1]; };

const P = {
  W: 1200, H: 460,
  cx: 600, cy: 250,
  Rsh: 70,                  // shadow / photon-ring radius
  rInMul: 1.42,             // ISCO as a multiple of Rsh
  rOutMul: 6.30,
  cosI: 0.255,              // disk inclination (~75 deg from face-on)
  domeQ: 0.86,              // shape of the lensed over-the-top arc
  domeGain: 3.05,           // how fast the halo climbs with radius
  falloff: 0.78,            // radial brightness decay
  scaleH: 0.028,            // disk thickness as a fraction of orbital radius
  ink: '#e2e2e8',
  bg: '#0a0a0f',
  ...PRESETS[arg('preset', 'dense')],
};
const SEED = Number(arg('seed', 20260812));

// ---------------------------------------------------------------- utilities

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = rng(SEED);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const n = (v) => {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
};

const rIn = P.Rsh * P.rInMul;
const rOut = P.Rsh * P.rOutMul;

// ------------------------------------------------------- the turbulence field
// One shared field sampled by every ring. The log(r) shear term is what makes
// neighbouring orbits bend together into arms instead of wobbling on their own.
const FIELD = Array.from({ length: 5 }, (_, j) => ({
  k: j + 1,
  a: 0.055 / (j * 0.8 + 1),
  phase: rnd() * Math.PI * 2,
  shear: lerp(1.6, 7.0, rnd()) * (rnd() < 0.5 ? -1 : 1),
}));

function warp(r, th) {
  const L = Math.log(r / rIn);
  let s = 0;
  for (const h of FIELD) s += h.a * Math.sin(h.k * th + h.phase + h.shear * L);
  return s * P.turb * Math.pow(r / rIn, 0.55);
}

// Disk plane is not flat: it tilts slowly with radius, like a warped disk.
const warpPhase = rnd() * Math.PI * 2;
const planeLift = (r) => 11 * P.turb * Math.sin(2.1 * Math.log(r / rIn) + warpPhase);

// -------------------------------------------------------------- ring geometry

// Apparent height of the lensed far side. Converges toward the photon ring as
// r grows, which is why outer orbits crowd into a bright halo band.
const domeTop = (a) => P.Rsh * 1.03 + Math.pow(a - rIn, 0.58) * P.domeGain;
const domeBot = (a) => P.Rsh * 1.05 + Math.pow(a - rIn, 0.50) * P.domeGain * 0.72;

// Orbits are ellipses, not circles, and their pericentres precess with radius.
// That shear is what turns a stack of rings into interleaved streams.
const precess = rnd() * Math.PI * 2;
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 0.9;

function orbit(a) {
  const t = (a - rIn) / (rOut - rIn);
  // Most streams cover only part of an orbit — a disk is filaments, not rings.
  const full = rnd() < 0.34;
  return {
    a,
    e: lerp(0.02, 0.30, Math.pow(t, 0.7)) * lerp(0.35, 1, rnd()),
    w: precess + 2.4 * Math.log(a / rIn) + lerp(-0.25, 0.25, rnd()),
    z: gauss() * (P.scaleH * a + 2.5),          // vertical offset within the disk thickness
    lift: planeLift(a),
    Ht: domeTop(a),
    Hb: domeBot(a),
    full,
    start: rnd() * Math.PI * 2,
    span: full ? Math.PI * 2 : Math.PI * lerp(0.30, 1.55, rnd() * rnd() + 0.15),
  };
}

// Radius of the orbit at true anomaly th, with the turbulence field on top.
const radiusAt = (o, th) => {
  const kep = (o.a * (1 - o.e * o.e)) / (1 + o.e * Math.cos(th - o.w));
  return kep * (1 + warp(o.a, th));
};

function project(o, th) {
  const rr = radiusAt(o, th);
  const sin = Math.sin(th);
  const y = sin >= 0
    ? P.cy + rr * P.cosI * sin + o.lift * sin + o.z      // near side, in front
    : P.cy - o.Ht * Math.pow(-sin, P.domeQ) - o.z * 0.5; // far side, lensed over the top
  return `${n(P.cx + rr * Math.cos(th))} ${n(y)}`;
}

function ringPath(o, samples) {
  const steps = o.full ? samples : Math.max(14, Math.round((samples * o.span) / (Math.PI * 2)) + 4);
  const pts = [];
  for (let s = 0; s <= steps; s++) pts.push(project(o, o.start + (s / steps) * o.span));
  return 'M' + pts.join(' ') + (o.full ? 'Z' : '');
}

// Underside of the far disk, bent below the shadow.
function underPath(o, samples) {
  const pts = [];
  for (let s = 0; s <= samples; s++) {
    const th = Math.PI + (s / samples) * Math.PI;
    const rr = radiusAt(o, th);
    pts.push(`${n(P.cx + rr * Math.cos(th))} ${n(P.cy + o.Hb * Math.pow(-Math.sin(th), P.domeQ) - o.z * 0.4)}`);
  }
  return 'M' + pts.join(' ');
}

function pathLength(d) {
  const nums = d.replace(/[MZ]/g, ' ').trim().split(/\s+/).map(Number);
  let L = 0;
  for (let i = 2; i + 1 < nums.length; i += 2) {
    L += Math.hypot(nums[i] - nums[i - 2], nums[i + 1] - nums[i - 1]);
  }
  return L;
}

// ------------------------------------------------------------------ animation
// pathLength="100" normalises every dash pattern, so all orbits share ten
// keyframes and twelve durations instead of one rule each.
const DASH_BUCKETS = [14, 20, 26, 34, 44, 56, 72, 92, 118, 150];
const SPEEDS = [7, 9, 11.5, 14, 17, 21, 25, 30, 36, 43, 52, 62];

function speedClass(r) {
  const t = (Math.pow(r, 1.5) - Math.pow(rIn, 1.5)) / (Math.pow(rOut, 1.5) - Math.pow(rIn, 1.5));
  return clamp(Math.round(t * (SPEEDS.length - 1)), 0, SPEEDS.length - 1);
}
function dashBucket(len) {
  let best = 0, bd = Infinity;
  DASH_BUCKETS.forEach((count, i) => {
    const d = Math.abs(len / count - 30);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

// ---------------------------------------------------------------------- build

const out = [];
out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${P.W}" height="${P.H}" viewBox="0 0 ${P.W} ${P.H}" role="img" aria-label="Accretion disk around a black hole">`);

// defs -----------------------------------------------------------------------
const defs = [];
defs.push(`<linearGradient id="beam" gradientUnits="userSpaceOnUse" x1="${n(P.cx - rOut)}" y1="0" x2="${n(P.cx + rOut)}" y2="0">
    <stop offset="0" stop-color="${P.ink}" stop-opacity="${P.beamMax}"/>
    <stop offset="0.20" stop-color="${P.ink}" stop-opacity="${(P.beamMax * 0.88).toFixed(3)}"/>
    <stop offset="0.50" stop-color="${P.ink}" stop-opacity="${(P.beamMax * 0.38).toFixed(3)}"/>
    <stop offset="0.78" stop-color="${P.ink}" stop-opacity="${(P.beamMax * 0.21).toFixed(3)}"/>
    <stop offset="1" stop-color="${P.ink}" stop-opacity="${(P.beamMax * 0.20).toFixed(3)}"/>
  </linearGradient>`);
defs.push(`<radialGradient id="halo" cx="50%" cy="50%" r="50%">
    <stop offset="0.50" stop-color="${P.ink}" stop-opacity="0.014"/>
    <stop offset="0.72" stop-color="${P.ink}" stop-opacity="0.009"/>
    <stop offset="1" stop-color="${P.ink}" stop-opacity="0"/>
  </radialGradient>`);

const css = [];
css.push(`.fl{animation-timing-function:linear;animation-iteration-count:infinite}`);
DASH_BUCKETS.forEach((count, i) => {
  css.push(`@keyframes k${i}{to{stroke-dashoffset:${(-100 / count).toFixed(4)}}}`);
  css.push(`.d${i}{animation-name:k${i}}`);
});
SPEEDS.forEach((s, i) => css.push(`.s${i}{animation-duration:${s}s}`));
css.push(`@keyframes tw{0%,100%{opacity:.10}50%{opacity:.62}}`);
css.push(`@keyframes tw2{0%,100%{opacity:.06}44%{opacity:.44}}`);
css.push(`.t0{animation:tw 5.6s ease-in-out infinite}`);
css.push(`.t1{animation:tw2 7.9s ease-in-out 1.3s infinite}`);
css.push(`.t2{animation:tw 6.7s ease-in-out .7s infinite}`);
css.push(`@keyframes bre{0%,100%{opacity:.55}50%{opacity:.82}}`);
css.push(`.ph{animation:bre 9.5s ease-in-out infinite}`);
css.push(`@media (prefers-reduced-motion:reduce){.fl,.t0,.t1,.t2,.ph{animation:none}}`);

defs.push(`<style>${css.join('')}</style>`);
out.push(`<defs>\n  ${defs.join('\n  ')}\n</defs>`);

// background -----------------------------------------------------------------
out.push(`<rect width="${P.W}" height="${P.H}" fill="${P.bg}"/>`);

// star field, deflected around the hole ---------------------------------------
const stars = [];
for (let i = 0; i < P.stars; i++) {
  let x = rnd() * P.W, y = rnd() * P.H;
  const dx = x - P.cx, dy = y - P.cy;
  const d = Math.hypot(dx, dy);
  if (d < 6) continue;
  const dPrime = d + (P.Rsh * P.Rsh * 0.92) / d;   // gravitational deflection
  if (dPrime > 900) continue;
  x = P.cx + (dx / d) * dPrime;
  y = P.cy + (dy / d) * dPrime;
  if (x < 4 || x > P.W - 4 || y < 4 || y > P.H - 4) continue;
  const near = clamp(1 - (dPrime - P.Rsh) / 260, 0, 1);
  const r = lerp(0.35, 1.05, rnd() * rnd());
  const op = lerp(0.05, 0.34, rnd()) * (1 - near * 0.45);
  const cls = rnd() < 0.34 ? ` class="t${Math.floor(rnd() * 3)}"` : '';
  // Stars close to the ring get smeared tangentially by the lens.
  if (near > 0.35 && rnd() < 0.7) {
    const ang = Math.atan2(y - P.cy, x - P.cx) + Math.PI / 2;
    const len = lerp(3, 13, near);
    stars.push(`<path${cls} d="M${n(x - Math.cos(ang) * len)} ${n(y - Math.sin(ang) * len)} ${n(x + Math.cos(ang) * len)} ${n(y + Math.sin(ang) * len)}" stroke="${P.ink}" stroke-opacity="${op.toFixed(3)}" stroke-width="${(r * 0.9).toFixed(2)}" fill="none" stroke-linecap="round"/>`);
  } else {
    stars.push(`<circle${cls} cx="${n(x)}" cy="${n(y)}" r="${r.toFixed(2)}" fill="${P.ink}" fill-opacity="${op.toFixed(3)}"/>`);
  }
}
out.push(`<g>${stars.join('')}</g>`);

// shadow + photon ring --------------------------------------------------------
out.push(`<circle cx="${P.cx}" cy="${P.cy}" r="${(P.Rsh * 2.2).toFixed(1)}" fill="url(#halo)"/>`);
out.push(`<circle cx="${P.cx}" cy="${P.cy}" r="${P.Rsh}" fill="#000000"/>`);

// the disk --------------------------------------------------------------------
const disk = [];
for (let i = 0; i < P.rings; i++) {
  const t = i / (P.rings - 1);
  const r = rIn * Math.pow(rOut / rIn, Math.pow(t, 1.05)) * lerp(0.975, 1.025, rnd());
  const samples = Math.round(lerp(104, 72, t));
  const sc = speedClass(r);
  const o = orbit(r);

  const bright = Math.pow(rIn / r, P.falloff) * lerp(0.45, 1.55, rnd() * rnd() + 0.2);
  const flare = rnd() < 0.10 ? 2.3 : 1;                      // occasional hot filament
  const w = P.wIn * Math.pow(rIn / r, 0.30);

  const d = ringPath(o, samples);
  const L = pathLength(d);
  const db = dashBucket(L);
  const count = DASH_BUCKETS[db];
  const seg = 100 / count;
  const clumpy = clamp(1 - (r - rIn) / (2.6 * P.Rsh), 0, 1);   // 1 at the ISCO, 0 further out
  const solid = rnd() < 0.14 * (1 - clumpy);
  const on = solid ? 100 : seg * lerp(lerp(0.30, 0.13, clumpy), lerp(0.86, 0.34, clumpy), rnd());
  const off = solid ? 0 : seg - on;
  const op = clamp(P.opBase * bright * flare * (1 + clumpy * 0.55), 0.012, 0.95);

  disk.push(`<path class="fl d${db} s${sc}" d="${d}" pathLength="100" fill="none" stroke="url(#beam)" stroke-opacity="${op.toFixed(3)}" stroke-width="${w.toFixed(2)}" stroke-dasharray="${on.toFixed(3)} ${Math.max(off, 0.001).toFixed(3)}" stroke-dashoffset="${(rnd() * 100).toFixed(3)}" stroke-linecap="round"/>`);

  if (P.underOp > 0 && o.full && i % 2 === 0) {
    const du = underPath(o, Math.round(samples * 0.6));
    const Lu = pathLength(du);
    const dbu = dashBucket(Lu);
    const segu = 100 / DASH_BUCKETS[dbu];
    const onu = segu * lerp(0.35, 0.8, rnd());
    disk.push(`<path class="fl d${dbu} s${sc}" d="${du}" pathLength="100" fill="none" stroke="url(#beam)" stroke-opacity="${(op * P.underOp).toFixed(3)}" stroke-width="${(w * 0.85).toFixed(2)}" stroke-dasharray="${onu.toFixed(3)} ${(segu - onu).toFixed(3)}" stroke-dashoffset="${(rnd() * segu).toFixed(3)}" stroke-linecap="round"/>`);
  }
}
out.push(`<g>${disk.join('')}</g>`);

// inner rim — the hottest material, right where the disk meets the shadow
const rim = [];
for (let k = 0; k < 18; k++) {
  const o = orbit(rIn * lerp(0.99, 1.62, rnd()));
  o.span = Math.PI * lerp(0.35, 1.3, rnd());
  o.start = rnd() * Math.PI * 2;
  o.full = false;
  const d = ringPath(o, 100);
  const db = dashBucket(pathLength(d));
  const seg = 100 / DASH_BUCKETS[db];
  const on = seg * lerp(0.55, 0.95, rnd());
  rim.push(`<path class="fl d${db} s${k % 3}" d="${d}" pathLength="100" fill="none" stroke="url(#beam)" stroke-opacity="${(P.opBase * lerp(0.5, 1.5, rnd())).toFixed(3)}" stroke-width="${(P.wIn * lerp(0.8, 1.3, rnd())).toFixed(2)}" stroke-dasharray="${on.toFixed(2)} ${(seg - on).toFixed(2)}" stroke-dashoffset="${(rnd() * 100).toFixed(2)}" stroke-linecap="round"/>`);
}
out.push(`<g>${rim.join('')}</g>`);

// inner hot spot — the fast, bright material at the ISCO on the approaching side
const spot = [];
for (let i = 0; i < 46; i++) {
  const th = Math.PI * (0.72 + rnd() * 0.56);
  const rr = rIn * lerp(0.97, 1.22, rnd() * rnd());
  const x = P.cx + rr * Math.cos(th);
  const y = Math.sin(th) >= 0
    ? P.cy + rr * P.cosI * Math.sin(th)
    : P.cy - domeTop(rr) * Math.pow(-Math.sin(th), P.domeQ);
  spot.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${lerp(0.4, 1.15, rnd() * rnd()).toFixed(2)}" fill="${P.ink}" fill-opacity="${lerp(0.18, 0.72, rnd()).toFixed(3)}"/>`);
}
out.push(`<g>${spot.join('')}</g>`);

// outer wisps — keeps the disk from ending on a hard edge
const wisps = [];
for (let i = 0; i < 16; i++) {
  const r0 = rOut * lerp(0.92, 1.05, rnd());
  const th0 = rnd() * Math.PI * 2;
  const span = lerp(0.5, 1.5, rnd());
  const pts = [];
  for (let s = 0; s <= 40; s++) {
    const th = th0 + (s / 40) * span;
    const rr = r0 * (1 + warp(r0, th) + (s / 40) * lerp(0.05, 0.4, rnd() * 0.02 + 0.4));
    const sin = Math.sin(th);
    const y = sin >= 0 ? P.cy + rr * P.cosI * sin : P.cy - domeTop(Math.min(rr, rOut)) * Math.pow(-sin, P.domeQ);
    pts.push(`${n(P.cx + rr * Math.cos(th))} ${n(y)}`);
  }
  wisps.push(`<path d="M${pts.join(' ')}" fill="none" stroke="url(#beam)" stroke-opacity="${lerp(0.03, 0.10, rnd()).toFixed(3)}" stroke-width="0.5" stroke-linecap="round"/>`);
}
out.push(`<g>${wisps.join('')}</g>`);

// photon ring, drawn last: it is the sharp edge of the silhouette
out.push(`<circle cx="${P.cx}" cy="${P.cy}" r="${(P.Rsh + 1.8).toFixed(1)}" fill="none" stroke="url(#beam)" stroke-width="4.2" stroke-opacity="0.10"/>`);
out.push(`<circle class="ph" cx="${P.cx}" cy="${P.cy}" r="${P.Rsh}" fill="none" stroke="url(#beam)" stroke-width="1.3"/>`);

out.push(`</svg>`);

process.stdout.write(out.join('\n') + '\n');
