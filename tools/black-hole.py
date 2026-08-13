#!/usr/bin/env python3
"""Generates assets/black-hole.svg — a particle accretion disk that orbits.

Three properties are enforced by construction:

  symmetry  every shape is centred on cx and its organic wobble is built only
            from even harmonics, m(th) = 1 + sum a_k cos(2k*th), which satisfies
            m(pi - th) == m(th) -> identical envelope on both sides. Anything
            with a phase, a rotation or a horizontal offset breaks this.

  motion    every orbit is a dashed stroke with pathLength="100", animated by
            shifting stroke-dashoffset by the full path length, so each particle
            covers its whole arc per cycle and the loop is seamless. Inner
            orbits run faster than outer ones. Shifting by a single dash period
            instead is the classic trap: the dots crawl one gap and read as
            static.

  depth     each orbit is drawn in two halves. The far half goes behind the
            shadow, the near half in front of it and lifted as it passes the
            sphere, so the horizon sits inside the disk. Front/back is a
            top/bottom split, which leaves the mirror symmetry intact.

  python3 tools/black-hole.py > assets/black-hole.svg
"""
import math
import random
import sys

W, H = 1200, 520
CX, CY = 600.0, 262.0

R_IN = 148.0
R_OUT = 470.0
N_RINGS = 118

VOID_RX, VOID_RY = 112.0, 99.0

# dash periods (dashes per full path) and orbital periods, as shared CSS buckets
DASH_BUCKETS = [18, 26, 36, 48, 64, 84, 110, 142, 184, 236]
SPEEDS = [7, 8.5, 10, 12, 14.5, 17.5, 21, 25, 30, 36, 43, 51]

random.seed(20260813)


def flat(r):
    """vertical/horizontal ratio: rounder near the hole, flat far out"""
    t = (r - R_IN) / (R_OUT - R_IN)
    return 0.255 + 0.335 * math.exp(-3.1 * t)


def wobble(amps):
    """even-harmonic radial multiplier -> mirror symmetric about x = CX"""
    def m(th):
        v = 1.0
        for k, a in enumerate(amps, start=1):
            v += a * math.cos(2 * k * th)
        return v
    return m


def lift(r, x, k):
    """Light bends near the hole, so the near half of the disk climbs across the
    face of the sphere instead of passing under it. Driven by |x - CX| only,
    which keeps both sides identical; k is 0 for the far half."""
    if k == 0:
        return 0.0
    amp = k * 30.0 * math.exp(-(r - R_IN) / 240.0)
    return amp * math.exp(-(((x - CX) / (VOID_RX * 2.1)) ** 2))


def pt(r, fr, m, dy, th, k=0.0):
    mm = m(th)
    x = CX + r * mm * math.cos(th)
    y = CY + dy + r * fr * mm * math.sin(th) - lift(r, x, k)
    return x, y


def ring_path(r, fr, m, dy, steps=260, k=0.0):
    pts = [pt(r, fr, m, dy, 2 * math.pi * s / steps, k) for s in range(steps + 1)]
    return "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z"


def arc_path(r, fr, m, dy, th_c, half, steps=90, k=0.0):
    """arc centred on th_c (pi/2 or 3pi/2) -> symmetric about x = CX"""
    pts = [pt(r, fr, m, dy, th_c - half + 2 * half * s / steps, k) for s in range(steps + 1)]
    return "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def speed_class(r):
    t = (r ** 0.8 - R_IN ** 0.8) / (R_OUT ** 0.8 - R_IN ** 0.8)
    return min(max(int(round(t * (len(SPEEDS) - 1))), 0), len(SPEEDS) - 1)


def dash_class(r, fr, span=1.0):
    """pick the bucket whose dash spacing lands nearest the target, in px"""
    circ = math.pi * (1.5 * (r + r * fr) - math.sqrt(r * r * fr)) * span
    best, bd = 0, float("inf")
    for i, count in enumerate(DASH_BUCKETS):
        d = abs(circ / count - 12.0)
        if d < bd:
            bd, best = d, i
    return best


out = []
out.append('<?xml version="1.0" encoding="UTF-8"?>')
out.append(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
    f'viewBox="0 0 {W} {H}" role="img" aria-label="Black hole">'
)

css = ['@keyframes orb{to{stroke-dashoffset:-100}}']
css.append('.fl{animation-name:orb;animation-timing-function:linear;animation-iteration-count:infinite}')
for i, s in enumerate(SPEEDS):
    css.append(f'.s{i}{{animation-duration:{s}s}}')
css.append('@keyframes tw{0%,100%{opacity:.12}50%{opacity:.7}}')
css.append('@keyframes tw2{0%,100%{opacity:.08}44%{opacity:.5}}')
css.append('.t0{animation:tw 5.3s ease-in-out infinite}')
css.append('.t1{animation:tw2 7.4s ease-in-out 1.2s infinite}')
css.append('.t2{animation:tw 6.1s ease-in-out .5s infinite}')
css.append('@keyframes bre{0%,100%{opacity:.6}50%{opacity:.9}}')
css.append('.ph{animation:bre 9.5s ease-in-out infinite}')
css.append('@media (prefers-reduced-motion:reduce){.fl,.t0,.t1,.t2,.ph{animation:none}}')

out.append('<defs>')
out.append(
    '  <radialGradient id="sink" cx="50%" cy="50%" r="50%">'
    '<stop offset="0%" stop-color="#000000" stop-opacity="1"/>'
    '<stop offset="52%" stop-color="#000000" stop-opacity="0.96"/>'
    '<stop offset="74%" stop-color="#000000" stop-opacity="0.55"/>'
    '<stop offset="100%" stop-color="#000000" stop-opacity="0"/>'
    '</radialGradient>'
)
out.append(
    '  <radialGradient id="core" cx="50%" cy="50%" r="50%">'
    '<stop offset="0%" stop-color="#000000" stop-opacity="1"/>'
    '<stop offset="90%" stop-color="#000000" stop-opacity="1"/>'
    '<stop offset="100%" stop-color="#000000" stop-opacity="0"/>'
    '</radialGradient>'
)
out.append('  <style>' + "".join(css) + '</style>')
out.append('</defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#030305"/>')

# ---- starfield ----
for cls in ("t0", "t1", "t2"):
    out.append(f'<g class="{cls}">')
    for _ in range(26):
        x, y = random.uniform(6, W - 6), random.uniform(6, H - 6)
        if ((x - CX) / 300.0) ** 2 + ((y - CY) / 110.0) ** 2 < 1.0:
            continue
        out.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{random.uniform(0.32, 1.05):.2f}" '
            f'fill="#f3f3f6" fill-opacity="{random.uniform(0.18, 0.62):.3f}"/>'
        )
    out.append('</g>')


GEOM = {}


def geom_id(d):
    """emit each path geometry once; strokes reference it with <use>"""
    if d not in GEOM:
        GEOM[d] = f"g{len(GEOM)}"
    return GEOM[d]


def flow(d, r, fr, op, sw, dash_on, span=1.0, color="#f3f3f6"):
    """a dashed stroke that streams along the referenced path"""
    di = dash_class(r, fr, span)
    period = 100.0 / DASH_BUCKETS[di]
    on = min(dash_on, period * 0.85)
    return (
        f'<use href="#{geom_id(d)}" class="fl s{speed_class(r)}" fill="none" '
        f'stroke="{color}" stroke-opacity="{op:.3f}" stroke-width="{sw:.2f}" '
        f'stroke-dasharray="{on:.3f} {period - on:.3f}" '
        f'stroke-dashoffset="{random.uniform(0, period):.3f}" stroke-linecap="round"/>'
    )


# The disk is split at the horizon: the far half is drawn behind the shadow, the
# near half in front of it, so the sphere sits inside the disk instead of on top
# of it. Front/back is a top/bottom split, so mirror symmetry is untouched.
FAR, NEAR = [], []

for i in range(N_RINGS):
    t = i / (N_RINGS - 1)
    r = R_IN + (R_OUT - R_IN) * (t ** 1.45)
    fr = flat(r)
    m = wobble([random.uniform(-0.045, 0.045) * (0.62 ** k) for k in range(4)])
    dy = random.gauss(0, 2.6)

    base = 0.200 * math.exp(-2.0 * t) + 0.040
    op = base * random.uniform(0.7, 1.35)
    sw = random.uniform(0.36, 0.74)

    # half-orbits: centred on top (far) and bottom (near), each already symmetric
    half = random.uniform(0.86, 1.0) * math.pi / 2
    traces = [
        (FAR, arc_path(r, fr, m, dy, 3 * math.pi / 2, half), half / math.pi),
        (NEAR, arc_path(r, fr, m, dy, math.pi / 2, half, k=1.0), half / math.pi),
    ]
    # some orbits run only over the top or only in front
    if random.random() < 0.30:
        traces.pop(random.randrange(2))

    for bucket, d, span in traces:
        bucket.append(
            f'<use href="#{geom_id(d)}" fill="none" stroke="#e4e4ea" '
            f'stroke-opacity="{op * 0.42:.3f}" stroke-width="{sw:.2f}" stroke-linecap="round"/>'
        )
        # particles riding that same trace
        for lane in range(2):
            lop = min((0.50 * math.exp(-1.8 * t) + 0.07) * random.uniform(0.45, 1.2), 0.7)
            bucket.append(
                flow(d, r, fr, lop, random.uniform(0.55, 1.05), random.uniform(0.06, 0.22), span)
            )

        # smeared trail: longer dashes, dimmer, slightly off-plane
        bucket.append(
            flow(d, r, fr, op * random.uniform(0.5, 1.0), random.uniform(0.3, 0.6),
                 random.uniform(0.45, 1.1), span, color="#e4e4ea")
        )

out.extend(FAR)

# ---- the well, then the shadow ----
out.append(f'<ellipse cx="{CX}" cy="{CY}" rx="{VOID_RX * 2.20:.1f}" ry="{VOID_RY * 2.15:.1f}" fill="url(#sink)"/>')
out.append(f'<ellipse cx="{CX}" cy="{CY}" rx="{VOID_RX * 1.16:.1f}" ry="{VOID_RY * 1.15:.1f}" fill="url(#core)"/>')
out.append(
    f'<path d="{ring_path(VOID_RX, VOID_RY / VOID_RX, wobble([random.uniform(-0.016, 0.016) * (0.6 ** k) for k in range(3)]), 0.0, steps=320)}" fill="#000000"/>'
)

# ---- photon ring: rims the horizon, so it goes on top of the shadow ----
out.append('<g class="ph">')
for j in range(3):
    r = VOID_RX * (1.10 + 0.055 * j)
    fr = 0.93 - 0.03 * j
    d = ring_path(r, fr, wobble([random.uniform(-0.02, 0.02) * (0.6 ** k) for k in range(3)]), 0.0, steps=300)
    out.append(
        f'<path d="{d}" fill="none" stroke="#f3f3f6" stroke-opacity="{0.30 - 0.075 * j:.3f}" '
        f'stroke-width="{0.8 - 0.18 * j:.2f}"/>'
    )
out.append('</g>')

# ---- the near half of the disk, crossing in front of the sphere ----
out.extend(NEAR)

out.append('</svg>')

defs = "".join(f'<path id="{i}" d="{d}" pathLength="100"/>' for d, i in GEOM.items())
head = out.index('</defs>')
out.insert(head, defs)

sys.stdout.write("\n".join(out) + "\n")
