#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "pillow>=11"]
# ///
"""Generates assets/black-hole.svg - a ray-traced black hole whose disc streams.

GitHub shows the README's SVG through <img>: no script runs, and every frame of
an animation re-rasterises the whole image. So everything expensive is computed
once, here, and the browser only moves a few textures.

  base      one WebP ray-traced below: null geodesics around a Schwarzschild
            hole meeting a thin disc seen at 84 degrees. That gives the shadow,
            the thin photon ring, the far side of the disc lensed over and
            under the shadow, and the near side crossing in front of it. The
            approaching (left) side is brighter and cooler, the receding side
            dimmer and warmer (Doppler beaming and redshift). The glow is baked
            in, so no filter or blur ever runs in the browser.

  lanes     one small texture of dark gas lanes along the orbits. Six copies of
            it rotate, each clipped to a ring and turning at the Keplerian rate
            of its radius (period ~ r^1.5), so the inner disc overtakes the
            outer one. Three lie in the disc plane (squashed by cos i); three
            lie on the lensed arcs, behind a static mask of how far lensing
            moved each pixel. Darkening a static image keeps the Doppler
            brightness fixed on screen while the gas streams through it.

  motion    six animated elements, transform only, with no animation under
            prefers-reduced-motion.

  uv run tools/black-hole.py > assets/black-hole.svg
"""
import base64
import io
import math
import sys

import numpy as np
from PIL import Image

W, H = 1200, 520
CX, CY = 600.0, 262.0
S = 20.0                        # viewBox px per M (G = c = 1)
INC = math.radians(84.0)        # angle between the line of sight and the disc axis
R_IN, R_OUT = 6.0, 24.0         # innermost stable orbit to the fading outer edge
B_CRIT = 3.0 * math.sqrt(3.0)   # shadow radius, as an impact parameter

SCALE = 1.5                     # base image px per viewBox px
SS = 2                          # supersampling per axis
SKY = "#0a0a0f"                 # the header's background
TINT = ["#d9a57e", "#e4ddd6", "#e3e6f5"]  # redshifted -> at rest -> blueshifted
TINT_SAT = 0.8
BEAMING = 3.0                   # I ~ g^3: softer than g^4, so the receding side stays visible
EXPOSURE, GAMMA = 2.0, 2.0

TEX = 768                       # lane texture size
RHO0 = 0.55                     # the texture is a ring from RHO0 to 1 of its radius
LANE_ALPHA = 0.45
T0 = 8.0                        # orbital period, in seconds, at r = 7

# (plane, ring from, ring to, texture radius, orbit radius driving the period,
#  opacity), radii in M. "sky" rings stream along the lensed arcs.
LAYERS = [
    ("disc", 6.0, 9.0, 10.0, 7.3, 0.45),
    ("disc", 9.0, 14.0, 15.5, 11.2, 0.45),
    ("disc", 14.0, 24.0, 24.0, 18.3, 0.27),
    ("sky", 5.3, 7.0, 8.9, 7.3, 1.0),
    ("sky", 7.0, 8.6, 9.6, 11.2, 1.0),
    ("sky", 8.6, 11.5, 11.5, 18.3, 0.8),
]

rng = np.random.default_rng(20260924)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.maximum(c, 0) ** (1 / 2.4) - 0.055)


def hex_rgb(c):
    return np.array([int(c[i:i + 2], 16) for i in (1, 3, 5)], float) / 255.0


def blur(img, sigma):
    """three box passes per axis, close to a gaussian"""
    r = max(1, int(round(sigma)))
    for axis in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * img.ndim
            pad[axis] = (r + 1, r)
            c = np.cumsum(np.pad(img, pad), axis=axis)
            hi = [slice(None)] * img.ndim
            lo = [slice(None)] * img.ndim
            hi[axis] = slice(2 * r + 1, None)
            lo[axis] = slice(0, -2 * r - 1)
            img = (c[tuple(hi)] - c[tuple(lo)]) / (2 * r + 1)
    return img


# ---- null geodesics ----
# A photon reaching the camera at impact parameter b moves in a plane; with
# u = 1/r and psi the angle swept from the camera direction, u'' = 3u^2 - u,
# u(0) = 0, u'(0) = 1/b. One table of u(psi) over b serves every pixel.
B_W = 0.05                      # b grid is dense near B_CRIT: b = B_CRIT + B_W sinh(s)
S_LO, S_HI = math.asinh(-B_CRIT / B_W), math.asinh((45.0 - B_CRIT) / B_W)
NB = 3000
D_PSI = 0.004
PSI_MAX = 3 * math.pi + 0.05    # room for the third crossing of the disc plane


def geodesics():
    """u[psi, b]: 0.6 once captured (inside the horizon), 0 once escaped"""
    b = np.maximum(B_CRIT + B_W * np.sinh(np.linspace(S_LO, S_HI, NB)), 1e-3)
    u, v = np.zeros(NB), 1.0 / b
    tab = np.zeros((int(PSI_MAX / D_PSI) + 2, NB), np.float32)
    captured = np.zeros(NB, bool)
    escaped = np.zeros(NB, bool)
    h = D_PSI

    def f(u, v):
        return v, 3.0 * u * u - u

    for k in range(1, len(tab)):
        k1 = f(u, v)
        k2 = f(u + h / 2 * k1[0], v + h / 2 * k1[1])
        k3 = f(u + h / 2 * k2[0], v + h / 2 * k2[1])
        k4 = f(u + h * k3[0], v + h * k3[1])
        u = u + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        v = v + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        captured |= u >= 0.5
        escaped |= (u <= 0.0) & ~captured
        u = np.where(captured, 0.6, np.where(escaped, 0.0, u))
        v = np.where(captured | escaped, 0.0, v)
        tab[k] = u
    return tab


def radius_at(tab, b, psi):
    """bilinear lookup of r(psi) for impact parameters b"""
    fs = (np.arcsinh((b - B_CRIT) / B_W) - S_LO) / (S_HI - S_LO) * (NB - 1)
    fp = psi / D_PSI
    i = np.clip(np.floor(fs).astype(int), 0, NB - 2)
    j = np.clip(np.floor(fp).astype(int), 0, len(tab) - 2)
    ts, tp = np.clip(fs - i, 0, 1), np.clip(fp - j, 0, 1)
    u = ((tab[j, i] * (1 - ts) + tab[j, i + 1] * ts) * (1 - tp)
         + (tab[j + 1, i] * (1 - ts) + tab[j + 1, i + 1] * ts) * tp)
    return 1.0 / np.maximum(u, 1e-9)


# ---- disc shading ----
def emission(r):
    """thin-disc profile rising from the inner edge; returns (brightness, opacity)"""
    q = np.clip(R_IN / r, 0, 1)
    shape = q ** 3 * np.sqrt(np.clip(1 - np.sqrt(q), 0, 1))
    qq = np.linspace(0.01, 1, 2000)
    peak = (qq ** 3 * np.sqrt(1 - np.sqrt(qq))).max()
    inner = smoothstep(R_IN, R_IN + 0.5, r)
    return (shape / peak * inner * (1 - smoothstep(0.3 * R_OUT, R_OUT, r)),
            inner * (1 - smoothstep(0.8 * R_OUT, R_OUT, r)))


def tint(t):
    """unit-luminance linear colour, from warm (t = 0) to cool (t = 1)"""
    cols = to_lin(np.array([hex_rgb(c) for c in TINT]))
    cols = 1 + TINT_SAT * (cols / (cols @ [0.2126, 0.7152, 0.0722])[:, None] - 1)
    return np.stack([np.interp(t, [0.0, 0.45, 1.0], cols[:, c]) for c in range(3)], -1)


def render_base(tab):
    """-> (sRGB base image, mask of the lensed arcs at a quarter of the viewBox)"""
    w, h = int(W * SCALE * SS), int(H * SCALE * SS)
    X, Y = np.meshgrid(((np.arange(w) + 0.5) / (SCALE * SS) - CX) / S,
                       (CY - (np.arange(h) + 0.5) / (SCALE * SS)) / S)
    b = np.hypot(X, Y)
    si, ci = math.sin(INC), math.cos(INC)
    # the photon crosses the disc plane at psi0, psi0 + pi, psi0 + 2pi
    psi0 = np.arctan2(ci, -si * np.sin(np.arctan2(Y, X)))

    light = np.zeros((h, w, 3))
    clear = np.ones((h, w))             # how much of what lies behind still shows
    lensed = np.zeros((h, w))
    for n in range(3):
        psi = psi0 + n * math.pi
        r = radius_at(tab, b, psi)
        hit = (r >= R_IN) & (r <= R_OUT)
        r = np.where(hit, r, 100.0)
        f, opacity = emission(r)
        # redshift of gas on circular orbits: gravitational and Doppler
        g = np.sqrt(np.clip(1 - 3.0 / r, 1e-3, 1)) / (1 + r ** -1.5 * X * si)
        tone = np.clip(np.log1p(EXPOSURE * f * g ** BEAMING) / math.log1p(EXPOSURE * 1.6), 0, 1) ** GAMMA
        temp = g * (R_IN / r) ** 0.75 * np.clip(1 - np.sqrt(R_IN / r), 0, 1) ** 0.25 / 0.36
        a = np.where(hit, opacity, 0.0)
        light += (clear * a * tone)[..., None] * tint(np.clip(temp - 0.55, 0, 1))
        # how far lensing moved this point from where a flat projection puts it
        shift = b - r * np.sin(psi) if n == 0 else 99.0
        lensed += clear * a * smoothstep(0.8, 2.2, shift)
        clear *= 1 - a
    # the higher-order images pile up on the photon ring
    ring = np.exp(-((b - B_CRIT * 1.004) / 0.03) ** 2) * (1 + 0.12 * X / B_CRIT) ** -3
    light += (0.6 * ring * clear)[..., None] * tint(np.clip(0.5 - 0.5 * X / B_CRIT, 0, 1))

    sky = np.where((b < B_CRIT)[..., None], 0.0, to_lin(hex_rgb(SKY)))
    stars = np.zeros((h + 8, w + 8))
    k5 = np.outer([1, 4, 6, 4, 1], [1, 4, 6, 4, 1]) / 36.0
    for _ in range(90):
        x, y, v = int(rng.uniform(0, w)), int(rng.uniform(0, h)), rng.uniform(0.1, 0.55) ** 2
        if (X[y, x] / 31) ** 2 + (Y[y, x] / 11) ** 2 > 1:
            stars[y + 2:y + 7, x + 2:x + 7] += v * k5
    sky = sky + stars[4:-4, 4:-4, None] * [0.8, 0.82, 0.9]

    glow = blur(light, 2.5 * SCALE * SS) * 0.12 + blur(light, 12 * SCALE * SS) * 0.035
    out = sky * np.clip(1 - 6 * (light.max(-1) + glow.max(-1)), 0, 1)[..., None] + light + glow
    out = out.reshape(h // SS, SS, w // SS, SS, 3).mean((1, 3))

    # the arcs only: where they fold into the disc their gas moves along the line of sight
    m = blur(lensed * smoothstep(2.0, 4.5, np.abs(Y)), 3 * SCALE * SS)
    m = m.reshape(H // 4, h // (H // 4), W // 4, w // (W // 4)).mean((1, 3))
    return to8(to_srgb(np.clip(out, 0, 1))), to8(np.clip(m, 0, 1))


def to8(x):
    return (x * 255 + 0.5).astype(np.uint8)


# ---- gas lanes ----
def lanes():
    """alpha of dark, orbit-aligned lanes on a ring RHO0..1 of a square texture"""
    nr, nphi = 256, 1024
    rho = np.linspace(RHO0, 1.0, nr)
    kr = np.fft.fftfreq(nr)[:, None] * nr
    kp = np.fft.fftfreq(nphi)[None, :] * nphi
    # anisotropic noise: short across the orbit, long along it, periodic in phi
    n = np.zeros((nr, nphi))
    for ckr, ckp, amp in ((5.0, 10.0, 1.0), (13.0, 24.0, 0.4)):
        spectrum = np.fft.fft2(rng.standard_normal((nr, nphi)))
        band = np.exp(-(kr / ckr) ** 2 - (kp / ckp) ** 2) * (1 - np.exp(-(kr / 1.2) ** 2 - (kp / 1.2) ** 2))
        o = np.real(np.fft.ifft2(spectrum * band))
        n += amp * (o - o.mean()) / o.std()
    n = (n - n.mean()) / n.std()
    edge = smoothstep(RHO0, RHO0 + 0.05, rho) * (1 - smoothstep(0.9, 1.0, rho))
    a = LANE_ALPHA * smoothstep(0.0, 1.8, n) * edge[:, None]

    c = (np.arange(TEX) + 0.5) / TEX * 2 - 1
    x, y = np.meshgrid(c, c)
    rr = np.hypot(x, y)
    # trailing spiral: the lanes are wound up by the differential rotation
    phi = (np.arctan2(y, x) + 8.0 * np.log(np.maximum(rr, 1e-3))) % (2 * np.pi)
    fr = np.clip((rr - RHO0) / (1 - RHO0) * (nr - 1), 0, nr - 1.001)
    fp = phi / (2 * np.pi) * nphi
    i, j = fr.astype(int), np.floor(fp).astype(int) % nphi
    j1 = (j + 1) % nphi
    tr, tp = fr - i, fp - np.floor(fp)
    v = ((a[i, j] * (1 - tp) + a[i, j1] * tp) * (1 - tr)
         + (a[i + 1, j] * (1 - tp) + a[i + 1, j1] * tp) * tr)
    return to8(np.where((rr >= RHO0) & (rr <= 1.0), np.clip(v, 0, 1), 0.0))


# ---- svg ----
def webp(pixels, **kw):
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, "WEBP", method=6, **kw)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def ring(r0, r1):
    def circle(r):
        return f"M{r:.1f},0A{r:.1f},{r:.1f} 0 1 0 {-r:.1f},0A{r:.1f},{r:.1f} 0 1 0 {r:.1f},0Z"
    return circle(r1) + circle(r0)


def main():
    base, arcs = render_base(geodesics())
    alpha = lanes()
    tex = np.zeros((TEX, TEX, 4), np.uint8)
    tex[..., 3] = alpha

    css = [
        "@keyframes o{to{transform:rotate(-360deg)}}",
        ".o{transform-origin:0 0;animation:o linear infinite}",
    ]
    for i, layer in enumerate(LAYERS):
        period = T0 * (layer[4] / 7.0) ** 1.5
        css.append(f".o{i}{{animation-duration:{period:.2f}s;animation-delay:-{period * rng.uniform():.2f}s}}")
    css.append("@media (prefers-reduced-motion:reduce){.o{animation:none}}")

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" role="img" aria-label="Black hole">',
        "<defs>",
        f'<image id="t" x="-1" y="-1" width="2" height="2" href="{webp(tex, quality=0, alpha_quality=40)}"/>',
    ]
    for i, (_, r0, r1, *_) in enumerate(LAYERS):
        out.append(f'<clipPath id="c{i}"><path clip-rule="evenodd" d="{ring(r0 * S, r1 * S)}"/></clipPath>')
    out.append(
        f'<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">'
        f'<image width="{W}" height="{H}" href="{webp(np.dstack([arcs] * 3), quality=60)}"/></mask>'
    )
    out.append("<style>" + "".join(css) + "</style>")
    out.append("</defs>")
    out.append(f'<image width="{W}" height="{H}" href="{webp(base, quality=80)}"/>')

    # the disc plane is a circle squashed by cos i; the lensed arcs stay round
    for plane, open_, close in (
        ("disc", f'<g transform="translate({CX:g} {CY:g}) scale(1 {math.cos(INC):.4f})">', "</g>"),
        ("sky", f'<g mask="url(#m)"><g transform="translate({CX:g} {CY:g})">', "</g></g>"),
    ):
        out.append(open_)
        for i, (p, r0, r1, radius, _, opacity) in enumerate(LAYERS):
            if p != plane:
                continue
            op = f' opacity="{opacity:g}"' if opacity < 1 else ""
            out.append(
                f'<g clip-path="url(#c{i})"{op}><g transform="scale({radius * S:g})">'
                f'<use href="#t" class="o o{i}"/></g></g>'
            )
        out.append(close)
    out.append("</svg>")
    sys.stdout.write("\n".join(out) + "\n")


main()
