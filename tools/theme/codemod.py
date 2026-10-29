"""Give the feature modules a light and a dark theme from one set of classes.

The brain modules (research, sim, workstation, neuro, nimble) were written for
a dark screen with hard-coded hex colours in Tailwind arbitrary values, e.g.
`bg-[#00030b]`. The vision module was written for a light screen the same way.
This script rewrites each such colour to a CSS variable, e.g.
`bg-[color:var(--k-00030b)]`, and writes src/styles/theme-tokens.css, which
defines every variable twice: the colour as authored for the module's own
theme, and a derived colour for the other theme.

Derivation works in OKLab lightness so elevation and contrast keep their
meaning: in dark-authored modules, panels lighter than the page stay lighter in
light mode, borders become light hairlines and light text becomes dark ink;
vision's pale tints become deep tinted surfaces in dark mode. Hue is kept.
Colours inside canvas/WebGL drawing code and SVG attributes are not touched:
viewports stay as authored, like the dark canvas of an imaging viewer.

Idempotent: already-converted classes contain no raw hex and are left alone.

Usage: python tools/theme/codemod.py
"""

from __future__ import annotations

import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
DARK_AUTHORED = ["research", "sim", "workstation", "neuro", "nimble"]
LIGHT_AUTHORED = ["vision"]
TOKENS = ROOT / "src" / "styles" / "theme-tokens.css"
STYLES = ROOT / "src" / "styles.css"
# Hand-written module CSS in styles.css that is dark-authored.
STYLE_BLOCK = ("/* ------------------------------------------------------------------------\n * Research imaging workstation", "/*\n * Vision module tokens.")

HEX = re.compile(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?(?![0-9a-fA-F])")
# A Tailwind arbitrary value that contains at least one hex colour.
ARBITRARY = re.compile(r"(?P<util>[a-z][a-z0-9:-]*?)-\[(?P<val>[^\]\s\"'`]*#[0-9a-fA-F]{6}(?![0-9a-fA-F]{1}[^0-9a-fA-F])[^\]\s\"'`]*)\]")
COLOR_UTILS = {
    "bg", "text", "border", "border-t", "border-b", "border-l", "border-r", "border-x", "border-y",
    "ring", "ring-offset", "from", "via", "to", "fill", "stroke", "divide", "outline", "placeholder",
    "accent", "caret", "decoration", "shadow",
}


# ---------------------------------------------------------------- colour maths (OKLab)


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_oklch(h: str) -> tuple[float, float, float]:
    r, g, b = (_lin(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return L, math.hypot(a, bb), math.atan2(bb, a)


def _oklch_to_rgb(L: float, C: float, H: float) -> tuple[float, float, float]:
    a, b = C * math.cos(H), C * math.sin(H)
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
    g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
    bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
    return r, g, bl


def oklch_to_hex(L: float, C: float, H: float) -> str:
    L = min(1.0, max(0.0, L))
    for _ in range(40):  # reduce chroma until the colour is inside sRGB
        rgb = _oklch_to_rgb(L, C, H)
        if all(-1e-4 <= v <= 1 + 1e-4 for v in rgb):
            break
        C *= 0.9
    return "#" + "".join(f"{round(min(1, max(0, _gam(min(1, max(0, v))))) * 255):02x}" for v in rgb)


def dark_to_light(h: str) -> str:
    L, C, H = hex_to_oklch(h)
    if L < 0.25:  # page and panel grounds: near white, lighter panels stay lighter
        L2, C2 = min(0.998, 0.965 + 0.25 * (L - 0.097)), C * 0.2
    elif L < 0.45:  # borders and raised controls: light hairlines
        L2, C2 = 0.895 - 0.15 * (L - 0.25), C * 0.3
    elif C > 0.08:  # saturated accents and status colours: keep them vivid
        L2, C2 = min(0.62, max(0.45, 1.13 - L)), C
    else:  # near-neutral text: dark ink
        L2, C2 = min(0.62, max(0.22, 1.13 - L)), C
    return oklch_to_hex(L2, C2, H)


def light_to_dark(h: str) -> str:
    L, C, H = hex_to_oklch(h)
    if L > 0.85:  # pale tints and surfaces: deep tinted surfaces
        L2, C2 = 0.18 + (0.98 - L) * 0.8, min(0.12, C * 1.6)
    elif L < 0.35:  # deliberately dark panels (e.g. a 3D viewport): stay dark
        return "#" + h.lower()
    else:  # mid-tone accents keep their weight
        L2, C2 = max(L, 0.6), C
    return oklch_to_hex(L2, C2, H)


# ---------------------------------------------------------------- rewriting


def rewrite(text: str, prefix: str, used: set[str]) -> str:
    def sub(m: re.Match[str]) -> str:
        util, val = m.group("util"), m.group("val")
        base = util.split(":")[-1]
        whole = HEX.fullmatch(val)
        if whole and not whole.group(2) and base in COLOR_UTILS:
            used.add(whole.group(1).lower())
            return f"{util}-[color:var(--{prefix}-{whole.group(1).lower()})]"

        def one(h: re.Match[str]) -> str:
            used.add(h.group(1).lower())
            ref = f"var(--{prefix}-{h.group(1).lower()})"
            if h.group(2):  # #rrggbbaa: keep the alpha
                return f"color-mix(in_oklab,{ref}_{round(int(h.group(2), 16) / 2.55)}%,transparent)"
            return ref

        return f"{util}-[{HEX.sub(one, val)}]"

    return ARBITRARY.sub(sub, text)


def existing_vars() -> dict[str, set[str]]:
    """Variables already referenced by converted files, so re-runs keep them defined."""
    found: dict[str, set[str]] = {"k": set(), "kv": set()}
    for f in (ROOT / "src").rglob("*.tsx"):
        for prefix, h in re.findall(r"var\(--(kv?)-([0-9a-f]{6})\)", f.read_text()):
            found[prefix].add(h)
    for prefix, h in re.findall(r"var\(--(kv?)-([0-9a-f]{6})\)", STYLES.read_text()):
        found[prefix].add(h)
    return found


def main() -> None:
    used: dict[str, set[str]] = {"k": set(), "kv": set()}
    for prefix, dirs in (("k", DARK_AUTHORED), ("kv", LIGHT_AUTHORED)):
        for d in dirs:
            for f in sorted((ROOT / "src" / "components" / d).glob("*.tsx")):
                before = f.read_text()
                after = rewrite(before, prefix, used[prefix])
                if after != before:
                    f.write_text(after)
                    print(f"rewrote {f.relative_to(ROOT)}")

    css = STYLES.read_text()
    a, b = css.index(STYLE_BLOCK[0]), css.index(STYLE_BLOCK[1])
    block = HEX.sub(lambda m: (used["k"].add(m.group(1).lower()) or f"var(--k-{m.group(1).lower()})"), css[a:b])
    STYLES.write_text(css[:a] + block + css[b:])

    for prefix, hs in existing_vars().items():
        used[prefix] |= hs

    light, dark = [], []
    for h in sorted(used["k"]):
        light.append(f"  --k-{h}: {dark_to_light(h)};")
        dark.append(f"  --k-{h}: #{h};")
    for h in sorted(used["kv"]):
        light.append(f"  --kv-{h}: #{h};")
        dark.append(f"  --kv-{h}: {light_to_dark(h)};")
    TOKENS.write_text(
        "/* Generated by tools/theme/codemod.py. Do not edit by hand.\n"
        " * --k-*: colours authored for dark (brain modules); light values derived.\n"
        " * --kv-*: colours authored for light (vision module); dark values derived. */\n"
        ":root {\n" + "\n".join(light) + "\n}\n.dark {\n" + "\n".join(dark) + "\n}\n"
    )
    print(f"{len(used['k'])} dark-authored and {len(used['kv'])} light-authored colours -> {TOKENS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
