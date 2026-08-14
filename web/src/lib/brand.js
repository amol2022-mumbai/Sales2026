const DEFAULT_COLOR = '#4f46e5';

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hueToRgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h / 360 + 1 / 3);
    g = hueToRgb(p, q, h / 360);
    b = hueToRgb(p, q, h / 360 - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clamp(n, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Derive a full 50–900 shade palette from a single brand colour.
 * 500 is the base colour; lighter/darker shades are produced by shifting
 * lightness (and slightly adjusting saturation) in HSL space.
 */
export function generateBrandShades(hex) {
  const rgb = hexToRgb(hex || DEFAULT_COLOR);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb);

  const lightness = {
    50: 0.97,
    100: 0.94,
    200: 0.88,
    300: 0.8,
    400: 0.68,
    500: l,
    600: 0.45,
    700: 0.36,
    800: 0.27,
    900: 0.18,
  };

  const shades = {};
  for (const [step, target] of Object.entries(lightness)) {
    // Fade saturation toward the ends of the scale for a natural look.
    const sat = step === '500' ? s : clamp(s * 0.9);
    shades[step] = hslToHex(h, sat, clamp(target));
  }
  return shades;
}

export function applyBrandShades(hex) {
  const shades = generateBrandShades(hex);
  if (!shades) return;
  const root = document.documentElement;
  for (const [step, value] of Object.entries(shades)) {
    root.style.setProperty(`--brand-${step}`, value);
  }
}

export function applyFavicon(url) {
  if (!url) return;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}
