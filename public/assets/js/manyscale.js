/*

ManyScale
v0.0.1
2025-11-21
James Marchment and Samantha Joel

*/


// =============================================================================
// API Helpers
// Fetch data from the server's in-memory cache via the /api routes.
// All functions are async — use inside a promise or with await.
// =============================================================================

async function constructsToArray() {
  try {
    const response = await fetch(`${window.BASE_PATH || ""}/api/construct-stats`);
    const resdata = await response.json();
    return Object.entries(resdata).map(([name, count]) => ({ name, count }));
  } catch (err) {
    console.error(err);
    console.log("Error loading constructs.");
  }
}

async function dataToArray(recordId = null) {
  try {
    let url = `${window.BASE_PATH || ""}/api/data`;
    if (recordId) {
      url += `?id=${encodeURIComponent(recordId)}`;
    }
    const response = await fetch(url);
    const data = await response.json();
    const validRecords = data.records.filter(r => Object.keys(r.fields).length > 0);
    return recordId ? validRecords[0] : validRecords;
  } catch (err) {
    console.error(err);
    container.textContent = "Error fetching data.";
  }
}

// Note: loadData may not be used anymore — index.ejs uses dataToArray instead.
async function loadData() {
  try {
    const response = await fetch(`${window.BASE_PATH || ""}/api/data`);
    const data = await response.json();
    return data;
  } catch (err) {
    console.error(err);
    container.textContent = "Error fetching data.";
  }
}


// =============================================================================
// Construct Tag Colors
// Maps construct names to consistent pill colors using an FNV-1a hash, so the same
// construct always gets the same color across all pages.
// The palette (which hues) and the recipe (which rendering style) are two independent
// tenant choices — see the tenant admin panel's Colors section. window.TENANT_COLORS
// .tagColors holds one accent hex per palette entry (16 today); .tagRecipe names one of
// the 4 styles in TAG_COLOR_RECIPES. Each accent expands into 2 {bg,border,text} looks
// (deriveTagShades' variant 0/1), so 16 accents produce 32 available tag colors. Falls
// back to DEFAULT_TAG_ACCENTS/"pastel" if TENANT_COLORS is unavailable for any reason.
// =============================================================================

// Mirrors lib/colorPresets.js's COLOR_PRESETS.tagColors.default exactly.
const DEFAULT_TAG_ACCENTS = [
  "#6bb9d1", "#2260b1", "#9bd567", "#33a02c", "#e0635d", "#d52834", "#da593f", "#d66e29",
  "#8d6dc4", "#842da8", "#d6cd29", "#b14f28", "#b18628", "#da973f", "#d6b429", "#e0985d",
];

// HSL tint/shade derivation — mirrors lib/colorPresets.js's deriveTagShades() exactly.
// Duplicated here since static JS files in this project don't share modules.
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
  h = ((h % 360) + 360) % 360;
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

// The 4 tag-button "recipes" — mirrors lib/colorPresets.js's TAG_COLOR_RECIPES exactly.
const TAG_COLOR_RECIPES = {
  pastel: {
    bgL: 95, bgSatCap: 35, borderL: 82, borderSatMin: 30, borderSatMax: 55,
    textL: 30, textSatMin: 35, textSatMax: 65,
    variant2: "hue", hueShift: 18,
  },
  dark: {
    bgLCap: 48, bgSatCap: 60, borderL: 55, borderSatMin: 40, borderSatMax: 60,
    textL: 92, textSatMin: 5, textSatMax: 20,
    variant2: "lighten", lightenDelta: 12, bgLCap2: 64,
  },
  vibrant: {
    bgL: 90, bgSatCap: 70, borderL: 66, borderSatMin: 50, borderSatMax: 75,
    textL: 30, textSatMin: 50, textSatMax: 75,
    variant2: "hue", hueShift: 18,
  },
  solid: {
    bgLCap: 70, bgSatCap: 85,
    borderDarkDelta: 32, borderLFloor: 6, borderSatMin: 75, borderSatMax: 90,
    textMode: "autoTint",
    textLightL: 85, textLightSatMin: 45, textLightSatMax: 65,
    textDarkL: 25, textDarkSatMin: 55, textDarkSatMax: 80,
    swapBorderAndDarkText: true,
    variant2: "hue", hueShift: 18,
  },
};

function relLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function deriveTagShades(hex, recipeName = "pastel", variant = 0) {
  const recipe = TAG_COLOR_RECIPES[recipeName] || TAG_COLOR_RECIPES.pastel;
  let [h, s, l] = hexToHsl(hex);
  if (variant === 1 && recipe.variant2 === "hue") h += recipe.hueShift;

  let bgL;
  if (recipe.bgLCap != null) {
    bgL = (variant === 1 && recipe.variant2 === "lighten")
      ? Math.min(l + recipe.lightenDelta, recipe.bgLCap2)
      : Math.min(l, recipe.bgLCap);
  } else {
    bgL = recipe.bgL;
  }

  const bg = hslToHex(h, Math.min(s, recipe.bgSatCap), bgL);

  const borderSat = Math.min(Math.max(s, recipe.borderSatMin), recipe.borderSatMax);
  const borderL = recipe.borderDarkDelta != null
    ? Math.max(bgL - recipe.borderDarkDelta, recipe.borderLFloor)
    : recipe.borderL;
  let border = hslToHex(h, borderSat, borderL);

  let text;
  if (recipe.textMode === "autoTint") {
    const lightCandidate = hslToHex(h, Math.min(Math.max(s, recipe.textLightSatMin), recipe.textLightSatMax), recipe.textLightL);
    const darkCandidate  = hslToHex(h, Math.min(Math.max(s, recipe.textDarkSatMin), recipe.textDarkSatMax), recipe.textDarkL);
    const bgL2 = relLuminance(bg);
    const useLight = contrastRatio(relLuminance(lightCandidate), bgL2) >= contrastRatio(relLuminance(darkCandidate), bgL2);
    if (useLight) {
      text = lightCandidate;
    } else if (recipe.swapBorderAndDarkText) {
      // Plain swap: text takes the bg-relative border formula, border takes the fixed
      // dark-candidate formula.
      text = border;
      border = darkCandidate;
    } else {
      text = darkCandidate;
    }
  } else {
    text = hslToHex(h, Math.min(Math.max(s, recipe.textSatMin), recipe.textSatMax), recipe.textL);
  }

  return { bg, border, text };
}

const TAG_ACCENTS = (window.TENANT_COLORS?.tagColors?.length)
  ? window.TENANT_COLORS.tagColors
  : DEFAULT_TAG_ACCENTS;
const TAG_RECIPE = window.TENANT_COLORS?.tagRecipe || "pastel";

// Each accent expands into 2 looks (variant 0/1), so 16 accents -> 32 available tag
// colors, computed once here rather than per-render.
const CONSTRUCT_COLORS = TAG_ACCENTS.flatMap(hex => [
  deriveTagShades(hex, TAG_RECIPE, 0),
  deriveTagShades(hex, TAG_RECIPE, 1),
]);

function constructColorIndex(name) {
  // FNV-1a: XOR-then-multiply creates strong avalanche on similar strings.
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % CONSTRUCT_COLORS.length;
}

function applyConstructTagColors(root = document) {
  root.querySelectorAll(".construct-tag").forEach(tag => {
    const color = CONSTRUCT_COLORS[constructColorIndex(tag.textContent.trim())];
    tag.style.background  = color.bg;
    tag.style.borderColor = color.border;
    tag.style.color       = color.text;
  });
}


// =============================================================================
// Bubble Chart
// D3 packed-bubble chart showing construct frequency. Rendered into #bubblechart.
// Bubbles are sized by number of measures; clicking navigates to the construct page.
// =============================================================================

async function drawBubbleChart(constructs) {

  const childElement  = document.getElementById("bubblechart");
  const parentElement = childElement.parentElement;

  const data = constructs;

  const dataArray = Object.entries(data).map(([key, value]) => ({ name: key, value }));

  const width  = parentElement.clientWidth - 25;
  const height = width - 40;

  const svg = d3
    .select("#bubblechart")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const pack = d3.pack().size([width, height]).padding(10);
  const root = d3.hierarchy({ children: dataArray }).sum(d => d.value);
  const nodes = pack(root).leaves();

  const color = d3.scaleOrdinal(window.TENANT_COLORS?.bubbleChart?.length ? window.TENANT_COLORS.bubbleChart : d3.schemePaired);

  // Pre-assign a stable fill color to each node so circles and labels share it.
  nodes.forEach(d => { d.fillColor = color(d.data.name); });

  // d3.pack() lays bubbles out with padding so they never overlap, so opacity below 1
  // buys no compositing benefit — it just washes out preset colors against the page
  // background. Kept slightly soft rather than fully opaque; label contrast below is
  // computed against this exact blended value so text stays legible regardless.
  const BUBBLE_OPACITY = 0.85;

  // Tooltip
  const tooltip = d3.select("body")
    .append("div")
    .style("position", "absolute")
    .style("padding", "6px 10px")
    .style("background", "rgba(0,0,0,0.75)")
    .style("color", "white")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("transition", "opacity 1s");

  // Circles
  svg.selectAll("circle")
    .data(nodes)
    .enter()
    .append("circle")
    .attr("cx", d => d.x)
    .attr("cy", d => d.y)
    .attr("r",  d => d.r)
    .attr("fill", d => d.fillColor)
    .attr("opacity", BUBBLE_OPACITY)
    .on("mouseover", (event, d) => {
      tooltip
        .style("left", event.pageX + 10 + "px")
        .style("top",  event.pageY + 10 + "px")
        .style("opacity", 1)
        .html(`${d.data.name}<br>${d.data.value} ${d.data.value === 1 ? "measure" : "measures"}`);
    })
    .on("mouseout", () => { tooltip.style("opacity", 0); });

  // Labels — wraps long names into multiple lines; hides if the bubble is too small.
  // Uses dark grey text when the bubble fill is too light for white to be readable.

  // Below this radius, text can't render legibly (too cramped / overlaps neighbors),
  // so skip the label entirely rather than trying to wrap it.
  const MIN_LABEL_RADIUS = 26;

  function blendedLuminance(hex, opacity) {
    // WCAG relative luminance of hex blended over a white background at given opacity.
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const blend = c => c * opacity + (1 - opacity);
    const lin   = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(blend(r)) + 0.7152 * lin(blend(g)) + 0.0722 * lin(blend(b));
  }

  const DARK_TEXT = "#333333";

  function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function labelColor(fillHex, opacity) {
    const bgL = blendedLuminance(fillHex, opacity);
    // Pick whichever of white/dark text actually contrasts better against this
    // bubble's rendered (opacity-blended) color, rather than a fixed luminance
    // cutoff — a cutoff of "light enough for white" and "dark enough for #333"
    // aren't the same threshold, so a single number can't get both right.
    const whiteContrast = contrastRatio(1, bgL);
    const darkContrast  = contrastRatio(blendedLuminance(DARK_TEXT, 1), bgL);
    return whiteContrast >= darkContrast ? "white" : DARK_TEXT;
  }

  function wrapBubbleLabel(textEl, name, r, cx, cy, fillColor) {
    if (r < MIN_LABEL_RADIUS) {
      textEl.style("display", "none");
      return;
    }

    const fontSize   = 10;
    const lineHeight = fontSize * 1.3;
    const maxWidth   = r * 1.7;

    textEl.text(null);

    const words = name.split(/\s+/);
    const lines = [];
    let current = [];

    const probe = textEl.append("tspan").style("visibility", "hidden");
    for (const word of words) {
      current.push(word);
      probe.text(current.join(" "));
      if (probe.node().getComputedTextLength() > maxWidth && current.length > 1) {
        current.pop();
        lines.push(current.join(" "));
        current = [word];
      }
    }
    lines.push(current.join(" "));
    probe.remove();

    if (lines.length * lineHeight > r * 1.8) {
      textEl.style("display", "none");
      return;
    }

    textEl.attr("fill", labelColor(fillColor, BUBBLE_OPACITY));

    const startY = cy - ((lines.length - 1) / 2) * lineHeight;
    lines.forEach((line, i) => {
      textEl.append("tspan")
        .attr("x", cx)
        .attr("y", startY + i * lineHeight)
        .text(line);
    });
  }

  svg.selectAll("text")
    .data(nodes)
    .enter()
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .style("font-size", "10px")
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      window.location.href = `${window.BASE_PATH || ""}/constructs/${encodeURIComponent(d.data.name)}`;
    })
    .each(function(d) {
      wrapBubbleLabel(d3.select(this), d.data.name, d.r, d.x, d.y, d.fillColor);
    });
}


// =============================================================================
// Detail Page Helpers
// Used on the individual measure detail page to populate fields, render
// construct tag buttons, and build download links.
// =============================================================================

function linkify(text) {
  if (typeof text !== "string") return text;
  return text.replace(/(https?:\/\/[^\s]+)/g, (url) => {
    const clean = url.replace(/[.,;:!?)]+$/, "");
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`;
  });
}

function populateFields(record) {
  document.querySelectorAll("[data-field]").forEach(el => {
    const field = el.getAttribute("data-field");
    const value = record.fields[field];
    if (Array.isArray(value)) {
      el.innerHTML = value.join(", ");
    } else {
      el.innerHTML = linkify(value ?? "");
    }
  });
}

function renderConstructButtons(rec) {
  const constructs = rec.fields["Construct(s)"] || [];
  const container  = document.getElementById("construct-buttons");
  container.innerHTML = "";
  constructs.forEach(c => {
    const a = document.createElement("a");
    a.href      = `${window.BASE_PATH || ""}/constructs/${encodeURIComponent(c)}`;
    a.className = "tech-tag";
    a.textContent = c;
    container.appendChild(a);
  });
}

function renderLinkButtons(rec) {
  const container = document.getElementById("details_link_buttons");
  container.innerHTML = "";
  if (rec.fields["Final PDF"]?.[0]?.["f_localPath"]) {
    const f_pdflink = rec.fields["Final PDF"][0]["f_localPath"];
    container.innerHTML += `
      <a href="${f_pdflink}" class="view-project" aria-label="View full measure" target="_blank">
        <button type="button" class="btn-download btn-download-pdf"><i class="bi bi-file-pdf"></i>Download Measure (PDF)</button>
      </a>`;
  } else if (rec.fields["Missing PDF"]) {
    container.innerHTML += `
      <button type="button" class="btn-download no-pdf-download" disabled><i class="bi bi-ban"></i>${rec.fields["Missing PDF"]}</button>`;
  }
  if (rec.fields["json file"]?.[0]?.["j_localPath"]) {
    const jsonLink = rec.fields["json file"][0]["j_localPath"];
    container.innerHTML += `
      <a href="${jsonLink}" class="view-project" aria-label="Download measure data (JSON)" target="_blank" download>
        <button type="button" class="btn-download btn-download-json"><i class="bi bi-filetype-json"></i>Download Measure (JSON)</button>
      </a>`;
  }
}



// =============================================================================
// Template Behaviours
// Handles mobile nav, scroll effects, preloader, AOS, Isotope layout, hash-link scrolling, and scrollspy.
// Loaded at the bottom of <body> so the DOM is available immediately.
// =============================================================================
(function () {
  "use strict";

  // Remove preloader on page load
  const preloader = document.querySelector('#preloader');
  if (preloader) {
    window.addEventListener('load', function () { preloader.remove(); });
  }

  // Scroll-to-top button
  const scrollTop = document.querySelector('.scroll-top');
  if (scrollTop) {
    function toggleScrollTop() {
      window.scrollY > 100
        ? scrollTop.classList.add('active')
        : scrollTop.classList.remove('active');
    }
    scrollTop.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('load', toggleScrollTop);
    document.addEventListener('scroll', toggleScrollTop);
  }

  // AOS (Animate On Scroll)
  function aosInit() {
    AOS.init({ duration: 600, easing: 'ease-in-out', once: true, mirror: false });
  }
  window.addEventListener('load', aosInit);

  // Pure Counter
  window.addEventListener('load', function () { new PureCounter(); });


  // Isotope generic handler removed. On the index page all cards are col-lg-12 so masonry
  // was layout-identical to block flow; filtering/pagination are handled by index.js custom
  // code (renderPage / selectedFilters), not Isotope. On constructs.ejs the .isotope-container
  // was absent inside .isotope-layout so the instance was never created and filter clicks
  // would have thrown TypeError. imagesLoaded removed with it (was only an Isotope dep).

  // Correct scroll position for hash links on page load
  window.addEventListener('load', function () {
    if (window.location.hash && document.querySelector(window.location.hash)) {
      setTimeout(function () {
        var section = document.querySelector(window.location.hash);
        var scrollMarginTop = getComputedStyle(section).scrollMarginTop;
        window.scrollTo({ top: section.offsetTop - parseInt(scrollMarginTop), behavior: 'smooth' });
      }, 100);
    }
  });

})();
