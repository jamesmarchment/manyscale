// Curated color presets for the three tenant-customizable palettes (bubble chart,
// construct-card gradients, construct-tag colors). Shared by the server (as fallback
// defaults for tenants who haven't customized) and the admin panel's client-side
// preset picker, so the palette data lives in exactly one place.
//
// tagColors holds one accent hex per entry; deriveTagShades() (below) expands each into
// a {bg,border,text} triple using whichever TAG_COLOR_RECIPES style the tenant has chosen
// — the palette (this data) and the recipe/style are independent tenant choices.

export const COLOR_PRESETS = {
  bubbleChart: {
    default: ["#9ecae1", "#1f78b4", "#b2df8a", "#33a02c", "#e78583", "#e31a1c", "#e35336", "#ff7f00", "#967bb6", "#6f2da8", "#fff200", "#b15928"],
    dark: ["#1a5276", "#6c3483", "#1e5128", "#4a7fa8", "#9a5bc4", "#4f8f5f", "#0d2b3e", "#3d1f57", "#0f2e15", "#e94560", "#c84b31", "#16a085"],
    retro: ["#f59628", "#ec5039", "#00bcd0", "#2b84c0", "#ffd91c", "#ee4b5e", "#ff9cae", "#36dea1", "#00907f", "#082155", "#a9DDD0", "#f68e57"],
    earthy:   ["#d9a441", "#b5651d", "#7c6a46", "#6b8e5a", "#c96f38", "#a25b3f", "#b8860b", "#556b2f", "#8b4513", "#cd853f", "#6e5849", "#b87333"],
    baroque: ["#2f5744", "#b81c3f", "#2b2a4a", "#6b9179", "#d9607f", "#6f6fa0", "#13251b", "#5c0a22", "#0e1729", "#f8b101", "#d86f08", "#48092f"],
    southwest: ["#ec5d20", "#782b0c", "#719b24", "#636e0e", "#5a9ade", "#99cbee", "#be864e", "#e3651c", "#bb82ab", "#914d69", "#e7523a", "#330229"],
    coastal: ["#249c9c","#2e6b4d","#DD3C72","#4d94e6","#8245A1","#52697A","#8CD9D9","#54c48c","#839fb3","#125454","#183929","#2A3A46"],
    laser: ["#38ff15", "#fc18c8", "#0cdff3", "#21890c", "#f82a42", "#8ffff0", "#0c8817", "#34042b", "#047187", "#ffbd09", "#6a2be4", "#e87a2d"],
    jazz:  ["#831919", "#e43726", "#f89128", "#217091", "#674a9e", "#2a4a9f", "#0d6974", "#41161c", "#a36c2b", "#eb7023", "#3b3c1a", "#766227"],
    forest: ["#3c7916", "#737920", "#8d4a13", "#8acf22", "#c3ec8e", "#c98f52", "#265707", "#3e3407", "#522411", "#d94f2b", "#f2c14e", "#5c6b73"],
    molten: ["#ff7222", "#ce2d24", "#6b0849", "#f9a35c", "#ed3607", "#e8748f", "#863706", "#480f18", "#38030f", "#f9c74f", "#616080", "#03002c"],
    spring: ["#14b1ab", "#d83a56", "#66de93", "#206a5d", "#eb5353", "#ffcc29", "#064635", "#f94892", "#f58634", "#89cffd", "#3b064d", "#187498"],
    vangogh: ["#3980c0", "#dd881d", "#5d8c44", "#79d2e0", "#f2dc31", "#a8c98a", "#0c193b", "#8a5a12", "#327b4d", "#723636", "#718c85", "#7a6ba6"],
    reds:    ["#3f0309", "#680512", "#8f061a", "#b30819", "#d33d45", "#e26268", "#fdaaac", "#f7d4d5", "#eca02e", "#146e67", "#1d3557", "#3a2e2e"],
    oranges: ["#4A1F00", "#6B2C00", "#944000", "#C75A00","#F57C00", "#FFA040", "#FFC47A", "#FFE2BF","#00A89A", "#5A2A00", "#E6C200", "#8B3FAF"],
greens: ["#003314", "#004D1A", "#00752A", "#159947","#2ECC71", "#66E08E", "#A5F0B8", "#DDF9E5","#C2185B", "#F4B400", "#7A4A21", "#1E3A5F"],
blues: ["#001F3F", "#003566", "#00509D", "#0077CC","#2196F3", "#64B5F6", "#A6D8FF", "#DDEFFF","#F57C00", "#E6C200", "#A61E4D", "#8C7B75"],
purples: ["#240046", "#3C096C", "#5A189A", "#7B2CBF","#9D4EDD", "#BE8BFF", "#D8B4FF", "#F0E4FF","#F4B400", "#5E9C46", "#F26B38", "#3A2F45"],
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
    laser: [
  { from: "#38ff15", to: "#00d4ff" },
  { from: "#fc18c8", to: "#7b2cff" },
  { from: "#21890c", to: "#38ff15" },
  { from: "#34042b", to: "#fc18c8" },
  { from: "#047187", to: "#00ffff" },
  { from: "#ffbd09", to: "#ff4d00" },
  { from: "#6a2be4", to: "#ff00ff" },
  { from: "#e87a2d", to: "#ffe600" },
  { from: "#ff3b8d", to: "#00f5ff" },
  { from: "#30cfd0", to: "#6a2be4" },
  { from: "#00ffcc", to: "#38ff15" },
  { from: "#fbc2eb", to: "#3a86ff" },
],
    earthy: [
      { from: "#d9a441", to: "#b5651d" }, { from: "#7c6a46", to: "#a68a52" },
      { from: "#8c6d46", to: "#b08d57" }, { from: "#6b8e5a", to: "#8ba888" },
      { from: "#c96f38", to: "#e0a458" }, { from: "#a25b3f", to: "#c98a5a" },
      { from: "#b8860b", to: "#daa520" }, { from: "#556b2f", to: "#6b8e23" },
      { from: "#8b4513", to: "#a0522d" }, { from: "#cd853f", to: "#deb887" },
      { from: "#6e5849", to: "#967969" }, { from: "#b87333", to: "#cd9575" },
    ],
    retro: [
  { from: "#f59628", to: "#ffd91c" },
  { from: "#ec5039", to: "#ffb36b" },
  { from: "#00bcd0", to: "#36dea1" },
  { from: "#2b84c0", to: "#a9ddd0" },
  { from: "#ffd91c", to: "#fff2a8" },
  { from: "#ee4b5e", to: "#ff9cae" },
  { from: "#ff9cae", to: "#ffe3d7" },
  { from: "#36dea1", to: "#c9f4b8" },
  { from: "#00907f", to: "#8ee8d7" },
  { from: "#082155", to: "#2b84c0" },
  { from: "#a9ddd0", to: "#fff5dc" },
  { from: "#f68e57", to: "#f7d794" },
],
    baroque: [
  { from: "#2f5744", to: "#c5a23d" },
  { from: "#b81c3f", to: "#f2c48d" },
  { from: "#2b2a4a", to: "#7f5ab6" },
  { from: "#6b9179", to: "#e2d4a7" },
  { from: "#d9607f", to: "#5c0a22" },
  { from: "#6f6fa0", to: "#d9bfd6" },
  { from: "#13251b", to: "#4d7b5f" },
  { from: "#5c0a22", to: "#d4a017" },
  { from: "#0e1729", to: "#6b6fa8" },
  { from: "#f8b101", to: "#fff3c4" },
  { from: "#d86f08", to: "#7b2d12" },
  { from: "#48092f", to: "#b84f8c" },
],
    southwest: [
      { from: "#ec5d20", to: "#ee9670" }, { from: "#782b0c", to: "#bc481a" },
      { from: "#719b24", to: "#9ccb45" }, { from: "#636e0e", to: "#9fb01d" },
      { from: "#5a9ade", to: "#a1c4e8" }, { from: "#99cbee", to: "#d5e8f6" },
      { from: "#be864e", to: "#cfaf8e" }, { from: "#e3651c", to: "#e7986a" },
      { from: "#bb82ab", to: "#d4bacd" }, { from: "#914d69", to: "#b17e93" },
      { from: "#e7523a", to: "#ec9587" }, { from: "#330229", to: "#7d0966" },
    ],
    coastal: [
  { from: "#249c9c", to: "#8ce8e8" },
  { from: "#2e6b4d", to: "#7ed9b1" },
  { from: "#DD3C72", to: "#ffb38a" },
  { from: "#4d94e6", to: "#c8f1ff" },
  { from: "#8245A1", to: "#d3b4ec" },
  { from: "#52697A", to: "#b8d5df" },
  { from: "#8CD9D9", to: "#fff8e8" },
  { from: "#54c48c", to: "#d9f8dc" },
  { from: "#839fb3", to: "#eef7fb" },
  { from: "#125454", to: "#42d4d4" },
  { from: "#183929", to: "#79c77d" },
  { from: "#2A3A46", to: "#6fa9c8" },
],
   jazz: [
  { from: "#831919", to: "#d4a64a" },
  { from: "#e43726", to: "#f7b267" },
  { from: "#f89128", to: "#fff0b3" },
  { from: "#217091", to: "#7ec8d8" },
  { from: "#674a9e", to: "#c3a6d8" },
  { from: "#2a4a9f", to: "#5ca9d6" },
  { from: "#0d6974", to: "#54c4b8" },
  { from: "#41161c", to: "#8b5a3c" },
  { from: "#a36c2b", to: "#f2cf6b" },
  { from: "#eb7023", to: "#ffd8a3" },
  { from: "#3b3c1a", to: "#8d8c4a" },
  { from: "#766227", to: "#d9bf74" },
],
    forest: [
      { from: "#3c7916", to: "#60b729" }, { from: "#737920", to: "#aab238" },
      { from: "#8d4a13", to: "#ce7024" }, { from: "#8acf22", to: "#aedf64" },
      { from: "#c3ec8e", to: "#e8f6d5" }, { from: "#c98f52", to: "#d8b795" },
      { from: "#265707", to: "#489d12" }, { from: "#3e3407", to: "#836f14" },
      { from: "#522411", to: "#904424" }, { from: "#d94f2b", to: "#e08b75" },
      { from: "#f2c14e", to: "#f4da9d" }, { from: "#5c6b73", to: "#7a97a6" },
    ],
   
    molten: [
      { from: "#ff7222", to: "#5a0b00" },
  { from: "#ce2d24", to: "#ffcf5a" },
  { from: "#6b0849", to: "#ff3b8d" },
  { from: "#863706", to: "#ffd166" },
  { from: "#ed3607", to: "#fff1b5" },
  { from: "#e8748f", to: "#ffe3ea" },
  { from: "#863706", to: "#d78b43" },
  { from: "#480f18", to: "#1b1f3b" },
  { from: "#38030f", to: "#03002c" },
  { from: "#f9c74f", to: "#fff8c9" },
  { from: "#616080", to: "#ff8a3d" },
  { from: "#03002c", to: "#8a2be2" },
],

    spring: [
      { from: "#14b1ab", to: "#36e1da" }, { from: "#d83a56", to: "#e18393" },
      { from: "#66de93", to: "#ace9c3" }, { from: "#206a5d", to: "#3aa290" },
      { from: "#eb5353", to: "#f09f9f" }, { from: "#ffcc29", to: "#fbdd7f" },
      { from: "#064635", to: "#118c6c" }, { from: "#f94892", to: "#f89ac2" },
      { from: "#f58634", to: "#f5b586" }, { from: "#89cffd", to: "#ceeafd" },
      { from: "#3b064d", to: "#731194" }, { from: "#187498", to: "#2da6d5" },
    ],
    vangogh: [
  { from: "#3980c0", to: "#f2dc31" },
  { from: "#dd881d", to: "#fff1a8" },
  { from: "#5d8c44", to: "#c9d98b" },
  { from: "#79d2e0", to: "#dff6f2" },
  { from: "#f2dc31", to: "#f7b13d" },
  { from: "#a8c98a", to: "#f4e8b5" },
  { from: "#0c193b", to: "#5f7fc8" },
  { from: "#8a5a12", to: "#d7a74a" },
  { from: "#327b4d", to: "#79b87a" },
  { from: "#723636", to: "#d49b6a" },
  { from: "#718c85", to: "#a9cfc8" },
  { from: "#7a6ba6", to: "#cdb7dd" },
],
    reds: [
      { from: "#3f0309", to: "#880b18" }, { from: "#680512", to: "#b00e24" },
      { from: "#8f061a", to: "#d6102d" }, { from: "#b30819", to: "#ed1f34" },
      { from: "#d33d45", to: "#dd8489" }, { from: "#e26268", to: "#ecaaad" },
      { from: "#fdaaac", to: "#fccfd0" }, { from: "#f7d4d5", to: "#f5d6d6" },
      { from: "#eca02e", to: "#eec17d" }, { from: "#146e67", to: "#27ada2" },
      { from: "#1d3557", to: "#375b8e" }, { from: "#3a2e2e", to: "#6f4a4a" },
    ],
    oranges: [
      { from: "#4A1F00", to: "#974205" }, { from: "#6B2C00", to: "#b74f06" },
      { from: "#944000", to: "#df6407" }, { from: "#C75A00", to: "#f88220" },
      { from: "#F57C00", to: "#f9a44d" }, { from: "#FFA040", to: "#fcc995" },
      { from: "#FFC47A", to: "#fde8cd" }, { from: "#FFE2BF", to: "#fde8ce" },
      { from: "#00A89A", to: "#07f2df" }, { from: "#5A2A00", to: "#a65005" },
      { from: "#E6C200", to: "#f9dc3f" }, { from: "#8B3FAF", to: "#ae79c7" },
    ],
    greens: [
      { from: "#003314", to: "#048135" }, { from: "#004D1A", to: "#059a37" },
      { from: "#00752A", to: "#06c149" }, { from: "#159947", to: "#27d96a" },
      { from: "#2ECC71", to: "#73d99e" }, { from: "#66E08E", to: "#adebc1" },
      { from: "#A5F0B8", to: "#d5f6dd" }, { from: "#DDF9E5", to: "#d5f6df" },
      { from: "#C2185B", to: "#e24a86" }, { from: "#F4B400", to: "#f9cc4c" },
      { from: "#7A4A21", to: "#b37239" }, { from: "#1E3A5F", to: "#386197" },
    ],
    blues: [
      { from: "#001F3F", to: "#04478c" }, { from: "#003566", to: "#065fb2" },
      { from: "#00509D", to: "#0779e7" }, { from: "#0077CC", to: "#25a0f8" },
      { from: "#2196F3", to: "#73baf3" }, { from: "#64B5F6", to: "#b4daf8" },
      { from: "#A6D8FF", to: "#cee8fd" }, { from: "#DDEFFF", to: "#cee7fd" },
      { from: "#F57C00", to: "#f9a44d" }, { from: "#E6C200", to: "#f9dc3f" },
      { from: "#A61E4D", to: "#d44174" }, { from: "#8C7B75", to: "#baa198" },
    ],
    purples: [
      { from: "#240046", to: "#4e0593" }, { from: "#3C096C", to: "#6615b1" },
      { from: "#5A189A", to: "#832ed6" }, { from: "#7B2CBF", to: "#a268d5" },
      { from: "#9D4EDD", to: "#c296e6" }, { from: "#BE8BFF", to: "#e3cefd" },
      { from: "#D8B4FF", to: "#e5cefd" }, { from: "#F0E4FF", to: "#e3cefd" },
      { from: "#F4B400", to: "#f9cc4c" }, { from: "#5E9C46", to: "#8bba79" },
      { from: "#F26B38", to: "#f3a689" }, { from: "#3A2F45", to: "#634f77" },
    ],
  },

  // 16 accent hexes per palette, one per bubbleChart hue, plus a second +24deg-twisted
  // accent for the 4 hues closest to that palette's dominant hue — giving the palette's
  // core mood extra representation rather than treating every hue as equally central.
  // Accent lightness is carried over from the source bubbleChart color rather than
  // flattened to one constant, so the capped-lightness recipes ("dark"/"solid" in
  // TAG_COLOR_RECIPES below) have real per-swatch variation to draw on. Each accent is
  // expanded into {bg,border,text} by deriveTagShades() using whichever recipe/style the
  // tenant has chosen — the palette (this data) and the recipe are independent choices.
  tagColors: {
    default: [
      "#6bb9d1", "#2260b1", "#9bd567", "#33a02c",
      "#e0635d", "#d52834", "#da593f", "#d66e29",
      "#8d6dc4", "#842da8", "#d6cd29", "#b14f28",
      "#b18628", "#da973f", "#d6b429", "#e0985d",
    ],
    dark: [
      "#1f638e", "#713483", "#2f7f3e", "#4673ac",
      "#9a5bc4", "#409e62", "#1e768f", "#512e80",
      "#2b832d", "#de5068", "#c84b31", "#1d9981",
      "#1d8099", "#409e87", "#1e498f", "#1f368e",
    ],
    retro: [
      "#dbae42", "#dc5c49", "#21a1af", "#2b84c0",
      "#dbc140", "#df605a", "#e05c82", "#3ada97",
      "#1c9288", "#1c4292", "#74c8b3", "#e08d5c",
      "#e0c25c", "#dc9749", "#cbdb42", "#df965a",
    ],
    earthy: [
      "#d9b641", "#b05e22", "#8a8138", "#63a543",
      "#c94338", "#a23f43", "#a3a41f", "#607b32",
      "#92401c", "#cd9c3f", "#824435", "#b87b33",
      "#bfd941", "#728a38", "#6ea41f", "#c5cd3f",
    ],
    baroque: [
      "#327b5f", "#b2222f", "#41327b", "#49b366",
      "#d9607f", "#5563ba", "#327b53", "#921c4e",
      "#2c4981", "#d1a028", "#bc6f24", "#921c63",
      "#b24f22", "#d97160", "#921c1e", "#bcac24",
    ],
    southwest: [
      "#d86534", "#92311c", "#719b24", "#84921c",
      "#5a84de", "#5cb2e0", "#be8a4e", "#d67129",
      "#c775a2", "#9e4067", "#dc4f45", "#921c84",
      "#dc8b45", "#92601c", "#d8a734", "#9e4041",
    ],
    coastal: [
      "#249c88", "#327b57", "#da3f73", "#548bdf",
      "#8343a3", "#3b7191", "#6dcfcf", "#54c47a",
      "#71b0c5", "#1f7c8f", "#327b63", "#32587b",
      "#24809c", "#6da8cf", "#1f4f8f", "#718ec5",
    ],
    laser: [
      "#3ada3d", "#da3a9b", "#29d6d6", "#41921c",
      "#dc4658", "#5ce0ce", "#1c9226", "#921c8a",
      "#1c6a92", "#d8ab30", "#6e36d9", "#da7d3b",
      "#5cbde0", "#1c9255", "#2991d6", "#3ada7d",
    ],
    jazz: [
      "#921c1c", "#d84e32", "#db9145", "#215d91",
      "#6543a5", "#2a4a9f", "#1c8392", "#822c3a",
      "#a37c2b", "#d96d35", "#797b32", "#826c2b",
      "#d9ae35", "#dbcd45", "#9aa32b", "#d89032",
    ],
    forest: [
      "#35921c", "#828924", "#92511c", "#83ca27",
      "#97e05c", "#c99652", "#43921c", "#927b1c",
      "#90441e", "#d7532d", "#e0b75c", "#3c7593",
      "#7a921c", "#5a8924", "#d4e05c", "#c9c652",
    ],
    molten: [
      "#dc7c45", "#cb3c27", "#921c69", "#e0ab5c",
      "#cd5027", "#e05c90", "#92541c", "#901e25",
      "#921c36", "#e0b95c", "#414a9f", "#371c92",
      "#cb7e27", "#cd9227", "#90451e", "#dcb845",
    ],
    spring: [
      "#20a5a4", "#d83a54", "#60dd8e", "#288575",
      "#e0725c", "#ddba4b", "#1c9269", "#e05c93",
      "#dd8a4c", "#5c96e0", "#741c92", "#1c7894",
      "#2071a5", "#287085", "#1c8b92", "#1c4894",
    ],
    vangogh: [
      "#3980c0", "#d27228", "#4c943c", "#62cadb",
      "#dccb47", "#9fc775", "#1d3d90", "#92761c",
      "#327b4d", "#7b3232", "#49b498", "#7057ba",
      "#b1dc47", "#7e921c", "#d2b628", "#7fc775",
    ],
    reds: [
      "#921c3e", "#921c4b", "#921c59", "#9d1e34",
      "#d33d45", "#e0655c", "#e0835c", "#e0745c",
      "#db9d3f", "#1c9288", "#2b4f82", "#7b5032",
      "#7b6e32", "#e0b85c", "#e0a95c", "#e0995c",
    ],
    oranges: [
      "#922a1c", "#921c1c", "#92371c", "#a74f20",
      "#ce9c27", "#e0a95c", "#e0d75c", "#e0c85c",
      "#1c9288", "#92531c", "#c1a925", "#8b3faf",
      "#bdce27", "#e0de5c", "#c3e05c", "#b4e05c",
    ],
    greens: [
      "#1c9268", "#1c923f", "#1c924d", "#1c925b",
      "#2ecca7", "#5ede75", "#63e05c", "#5ce065",
      "#b7235d", "#cda127", "#885325", "#2a5084",
      "#2eb2cc", "#1c8c92", "#1c928a", "#1c927c",
    ],
    blues: [
      "#1c2a92", "#1c4692", "#1c3892", "#21a3ab",
      "#3aabda", "#5caae0", "#5cc8e0", "#5c9ae0",
      "#ce7c27", "#c1a925", "#a51f4d", "#b6674b",
      "#5c66e0", "#5c75e0", "#3a6bda", "#211c92",
    ],
    purples: [
      "#651c92", "#731c92", "#5a1c96", "#aa2cbf",
      "#d94edd", "#625ce0", "#805ce0", "#715ce0",
      "#cda127", "#5ca042", "#dd744d", "#4f327b",
      "#6c327b", "#8a1c96", "#921c8f", "#921c81",
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

// Tag-button "recipe" (rendering style) is independent of which tagColors palette is
// active — a tenant picks a hue palette AND a style separately (see
// DEFAULT_RECIPE_FOR_PRESET below for the starting pairing). Only 4 styles exist, each
// a genuinely distinct look rather than a minor variation of the others:
//   - pastel:  light background, moderate saturation, dark text. Soft/default look.
//   - dark:    background capped at medium brightness (never past "dark"), light text.
//   - vibrant: light-ish but heavily saturated background, saturated dark text/border.
//   - solid:   bright AND saturated background (bold, opaque-feeling), text/border tuned per swatch for contrast.
// "bgLCap" (vs. a flat "bgL") lets each swatch's OWN lightness through, up to a ceiling —
// this is what gives pastel/dark/solid real per-swatch depth variation instead of every
// tag in a palette sharing one identical background lightness.
export const TAG_COLOR_RECIPES = {
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
  // Text is a same-hue dark shade sharing the border's saturation range (not a neutral
  // black) so it reads as "the color, darkened" rather than an unrelated overlay — bg is
  // fixed at L90 regardless of hue, so a fixed dark textL is always safely readable.
  vibrant: {
    bgL: 90, bgSatCap: 70, borderL: 66, borderSatMin: 50, borderSatMax: 75,
    textL: 30, textSatMin: 50, textSatMax: 75,
    variant2: "hue", hueShift: 18,
  },
  // Bright, saturated background. Border is a darker, more saturated shade of THIS
  // swatch's own computed bg ("borderDarkDelta": bgL minus a fixed amount, floored short
  // of pure black), at a saturation pushed above bg's — it reads as "the swatch color,
  // deepened," the way a button's border is often a shade of its own fill. The delta is
  // fairly large (32) because pushing saturation up on green/teal hues raises their
  // perceived brightness even as HSL lightness drops (green dominates the WCAG luminance
  // formula) — a smaller delta leaves those hues' borders barely distinguishable from bg.
  // Text ("autoTint") picks whichever of a bright tint or a dark shade of the same hue
  // contrasts better against bg, since a swatch that's already light (yellows, light
  // oranges) leaves no room above it for a brighter tint. When the dark shade wins,
  // "swapBorderAndDarkText" swaps it with the border color: text gets the bg-relative
  // border formula (built specifically to contrast against this bg) and border gets the
  // fixed dark-shade formula — so text carries the swatch's most legible dark tone and
  // border stays a secondary accent.
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

// Starting style for a palette a tenant hasn't explicitly assigned a style to yet
// (tenant can always override independently via the recipe/style selector).
export const DEFAULT_RECIPE_FOR_PRESET = {
  laser: "vibrant",
  dark: "dark", baroque: "dark", jazz: "dark",
  molten: "solid",
  // everything else defaults to pastel
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

// Derives a {bg, border, text} triple from a single accent hex for the given recipe
// name and variant (0 = base, 1 = that recipe's second look — see TAG_COLOR_RECIPES'
// "variant2" field). Used both server-side (none currently, kept here for symmetry) and
// duplicated client-side in manyscale.js/admin preview JS, since static JS files in this
// project don't share modules.
export function deriveTagShades(hex, recipeName = "pastel", variant = 0) {
  const recipe = TAG_COLOR_RECIPES[recipeName] || TAG_COLOR_RECIPES.pastel;
  let [h, s, l] = hexToHsl(hex);
  if (variant === 1 && recipe.variant2 === "hue") h += recipe.hueShift;

  let bgL;
  if (recipe.bgLCap != null) {
    // "lighten" adds a fixed delta before re-capping (at a higher ceiling) — a plain
    // higher cap alone wouldn't change anything for a swatch already under the lower
    // cap, since min(l, 48) === min(l, 64) whenever l < 48. The delta guarantees variant
    // 1 is always visibly lighter than variant 0, regardless of the swatch's own lightness.
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
    // Whichever same-hue tint (bright) or shade (dark) actually contrasts better
    // against THIS swatch's own computed bg — a bright swatch (yellows, light oranges)
    // leaves no room above it for a brighter tint, so text drops to a dark shade instead.
    const lightCandidate = hslToHex(h, Math.min(Math.max(s, recipe.textLightSatMin), recipe.textLightSatMax), recipe.textLightL);
    const darkCandidate  = hslToHex(h, Math.min(Math.max(s, recipe.textDarkSatMin), recipe.textDarkSatMax), recipe.textDarkL);
    const bgL2 = relLuminance(bg);
    const useLight = contrastRatio(relLuminance(lightCandidate), bgL2) >= contrastRatio(relLuminance(darkCandidate), bgL2);
    if (useLight) {
      text = lightCandidate;
    } else if (recipe.swapBorderAndDarkText) {
      // Text gets the bg-relative border formula (tuned for contrast against this bg);
      // border gets the fixed dark-shade formula.
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
