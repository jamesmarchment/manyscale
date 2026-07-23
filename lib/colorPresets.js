// Curated color presets for the three tenant-customizable palettes (bubble chart,
// construct-card gradients, construct-tag colors). Shared by the server (as fallback
// defaults for tenants who haven't customized) and the admin panel's client-side
// preset picker, so the palette data lives in exactly one place.
//
// "default" values are chosen to exactly match (bubbleChart/cardGradients) or closely
// approximate (tagColors, which is derived rather than stored verbatim — see
// deriveTagShades below) today's hardcoded palettes, so untouched tenants see no change.

export const COLOR_PRESETS = {
  bubbleChart: {
    default: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"],
    dark:    ["#4a6fa5", "#8e44ad", "#c0392b", "#16a085", "#d35400", "#2c3e50", "#7f5a8a", "#34495e", "#a04000", "#1a5276", "#6c3483", "#186a3b"],
    vibrant: ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff", "#06ffa5", "#ff4d6d", "#c9184a", "#f72585", "#4cc9f0", "#7209b7", "#3f37c9"],
    retro:   ["#d9a441", "#b5651d", "#7c6a46", "#6b8e5a", "#c96f38", "#a25b3f", "#b8860b", "#556b2f", "#8b4513", "#cd853f", "#6e5849", "#b87333"],
  },

  cardGradients: {
    default: [
      { from: "#c9d6f0", to: "#b8a9d9" }, { from: "#f5c0d0", to: "#f0a0b0" },
      { from: "#aed4f5", to: "#a0c8e8" }, { from: "#b5e8c8", to: "#9dd4c0" },
      { from: "#f5c8d8", to: "#f5e0a0" }, { from: "#d4c0e8", to: "#f0c8e0" },
      { from: "#f5c8a8", to: "#f5e0b0" }, { from: "#b8ecd4", to: "#b8ddf0" },
      { from: "#f0b8b0", to: "#f0b8d0" }, { from: "#a8d8b8", to: "#a8c8d8" },
      { from: "#d8c8f0", to: "#c8d8f0" }, { from: "#f5e0b0", to: "#d8f0f0" },
    ],
    dark: [
      { from: "#2c3e50", to: "#34495e" }, { from: "#4a235a", to: "#6c3483" },
      { from: "#1a5276", to: "#2874a6" }, { from: "#145a32", to: "#1e8449" },
      { from: "#6e2c00", to: "#935116" }, { from: "#512e5f", to: "#76448a" },
      { from: "#7d6608", to: "#9a7d0a" }, { from: "#0e6251", to: "#148f77" },
      { from: "#78281f", to: "#943126" }, { from: "#1b4f72", to: "#21618c" },
      { from: "#4a235a", to: "#5b2c6f" }, { from: "#7e5109", to: "#9c640c" },
    ],
    vibrant: [
      { from: "#4facfe", to: "#00f2fe" }, { from: "#fa709a", to: "#fee140" },
      { from: "#30cfd0", to: "#330867" }, { from: "#a8ff78", to: "#78ffd6" },
      { from: "#ff9a9e", to: "#fecfef" }, { from: "#f6d365", to: "#fda085" },
      { from: "#ff6a00", to: "#ee0979" }, { from: "#43e97b", to: "#38f9d7" },
      { from: "#fbc2eb", to: "#a6c1ee" }, { from: "#ff5858", to: "#f09819" },
      { from: "#667eea", to: "#764ba2" }, { from: "#f857a6", to: "#ff5858" },
    ],
    retro: [
      { from: "#d9a441", to: "#b5651d" }, { from: "#7c6a46", to: "#a68a52" },
      { from: "#8c6d46", to: "#b08d57" }, { from: "#6b8e5a", to: "#8ba888" },
      { from: "#c96f38", to: "#e0a458" }, { from: "#a25b3f", to: "#c98a5a" },
      { from: "#b8860b", to: "#daa520" }, { from: "#556b2f", to: "#6b8e23" },
      { from: "#8b4513", to: "#a0522d" }, { from: "#cd853f", to: "#deb887" },
      { from: "#6e5849", to: "#967969" }, { from: "#b87333", to: "#cd9575" },
    ],
  },

  // One accent color per entry — bg/border/text are derived from it at render time via
  // deriveTagShades(). "default" uses each of today's hand-picked "text" shades as the
  // accent, which reproduces a very close match once derived.
  tagColors: {
    default: [
      "#265278", "#334888", "#464298", "#5a3888", "#683090", "#773060",
      "#882e46", "#882e52", "#7a3260", "#7e3e2e", "#7c3e2e", "#7a4828",
      "#864c22", "#7e4c20", "#7c4a26", "#725c16", "#785808", "#706014",
      "#3a6236", "#366432", "#28645e", "#28605e", "#2a6260", "#265e6e",
    ],
    dark: [
      "#1a3a5c", "#22295c", "#332a5c", "#42235c", "#4c1f52", "#571f3d",
      "#5c1f2e", "#5c1f35", "#4f2035", "#4f2418", "#4c2318", "#4a2c14",
      "#523008", "#4c2f0c", "#4a2c10", "#463a0a", "#453204", "#3f3808",
      "#1f3d1e", "#1c3c1c", "#123a38", "#123834", "#153a37", "#153741",
    ],
    vibrant: [
      "#0072ff", "#2e5bff", "#6a2eff", "#8f2eff", "#b32eff", "#d6208f",
      "#ff2d55", "#ff2e6d", "#ff2e8f", "#ff5e2e", "#ff7a2e", "#ff9e2e",
      "#ffbe2e", "#ffd82e", "#e8e02e", "#c2e02e", "#4dd12e", "#2ed15c",
      "#00c2a0", "#00c2b8", "#00b8c2", "#00a6c2", "#0096c2", "#0084c2",
    ],
    retro: [
      "#5b7ea3", "#5f6fa3", "#6c63a3", "#8163a3", "#93538f", "#93536b",
      "#a34e4e", "#a34e5e", "#8f4e5e", "#8f5a42", "#8a5942", "#8a6238",
      "#9c7a2e", "#8f7228", "#8a6a2e", "#8a7d2e", "#8a7622", "#7d7c22",
      "#4e7d3e", "#4d7d3a", "#317d78", "#307a76", "#367a76", "#367580",
    ],
  },
};

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Per-preset derivation targets: {bg,border,text} lightness + saturation clamp ranges.
// A single fixed recipe can't make "dark" ever render with a dark background or
// "vibrant" render with real punch — the recipe itself has to change per preset, not
// just the input hue. "custom" has no inherent theme, so it (and any unrecognized
// preset name) falls back to "default" in deriveTagShades below.
export const TAG_COLOR_RECIPES = {
  default: { bgL: 95, bgSatCap: 35, borderL: 82, borderSatMin: 30, borderSatMax: 55, textL: 30, textSatMin: 35, textSatMax: 65 },
  retro:   { bgL: 93, bgSatCap: 22, borderL: 78, borderSatMin: 18, borderSatMax: 38, textL: 34, textSatMin: 22, textSatMax: 42 },
  dark:    { bgL: 22, bgSatCap: 45, borderL: 38, borderSatMin: 35, borderSatMax: 55, textL: 88, textSatMin: 12, textSatMax: 32 },
  vibrant: { bgL: 90, bgSatCap: 60, borderL: 68, borderSatMin: 50, borderSatMax: 75, textL: 26, textSatMin: 55, textSatMax: 80 },
};

// Derives a {bg, border, text} triple from a single accent hex, using the target
// lightness/saturation ranges for the given preset name. Used both server-side (none
// currently, kept here for symmetry) and duplicated client-side in manyscale.js/admin
// preview JS, since static JS files in this project don't share modules.
export function deriveTagShades(hex, presetName = "default") {
  const recipe = TAG_COLOR_RECIPES[presetName] || TAG_COLOR_RECIPES.default;
  const [h, s] = hexToHsl(hex);
  const bg     = hslToHex(h, Math.min(s, recipe.bgSatCap), recipe.bgL);
  const border = hslToHex(h, Math.min(Math.max(s, recipe.borderSatMin), recipe.borderSatMax), recipe.borderL);
  const text   = hslToHex(h, Math.min(Math.max(s, recipe.textSatMin), recipe.textSatMax), recipe.textL);
  return { bg, border, text };
}
