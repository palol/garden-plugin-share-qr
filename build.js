const { deflateSync } = require("node:zlib");
const { createHash } = require("node:crypto");
// Vendored MIT pure-JS QR encoder (kazuhikoarase/qrcode-generator 2.0.4).
// See vendor/LICENSE.qrcode-generator. Keeps the plugin dependency-free in hosts
// that do not ship the `qrcode` npm package.
const qrcode = require("./vendor/qrcode-generator.js");

function validUrl(value) {
  if (typeof value !== "string" || /[\x00-\x20\\]/.test(value.trim()) || !/^https?:\/\//i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (!url.hostname || url.username || url.password) return null;
    return url.pathname === "/" && !url.search && !url.hash ? url.origin : url.href;
  } catch { return null; }
}

function resolveSettings(settings = {}, meta = {}, warn = console.warn) {
  const text = (key, fallback) => typeof settings[key] === "string" && settings[key].trim() ? settings[key].trim().slice(0, 500) : fallback;
  let targetUrl = validUrl(settings.targetUrl || meta.siteBaseUrl);
  if (!targetUrl) {
    warn("[share-qr] Missing or invalid HTTP(S) target URL; using validated site metadata or a navigation link. No placeholder QR will be generated.");
    targetUrl = validUrl(meta.siteBaseUrl);
  }
  const filename = text("filename", "site-qr").replace(/\.(svg|png)$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "site-qr";
  const svg = typeof settings.svg === "boolean" ? settings.svg : true;
  const png = typeof settings.png === "boolean" ? settings.png : true;
  if (!svg && !png) warn("[share-qr] At least one QR format is required; enabling SVG.");
  return {
    targetUrl, fallbackUrl: targetUrl || "./",
    label: text("label", "Scan to visit this site"), filename,
    svg: svg || !png, png,
    triggerLabel: text("triggerLabel", "QR"),
    triggerIcon: ["qr", "link", "none"].includes(settings.triggerIcon) ? settings.triggerIcon : "qr",
    externalTrigger: settings.externalTrigger === true,
    maxSize: Number.isFinite(settings.maxSize) ? Math.max(160, Math.min(360, settings.maxSize)) : 360,
    accentToken: typeof settings.accentToken === "string" && /^--[a-zA-Z][a-zA-Z0-9-]*$/.test(settings.accentToken) ? settings.accentToken : "--interactive-accent",
  };
}

// --- QR module matrix (vendored encoder, fixed params, deterministic) ---
function matrixFor(targetUrl, errorCorrectionLevel = "M", margin = 4) {
  const qr = qrcode(0, errorCorrectionLevel);
  qr.addData(targetUrl);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  const modules = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const mr = r - margin, mc = c - margin;
      row.push(mr < 0 || mc < 0 || mr >= n || mc >= n ? false : qr.isDark(mr, mc));
    }
    modules.push(row);
  }
  return { modules, size };
}

function renderSvg(modules, size, width) {
  const scale = width / size;
  const rects = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) rects.push(`<rect x="${c * scale}" y="${r * scale}" width="${scale}" height="${scale}"/>`);
    }
  }
  const g = rects.join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><g fill="#000000">${g}</g></svg>`;
}

// Minimal PNG encoder: IHDR + IDAT(zlib) + IEND, no external dependency.
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}
function renderPng(modules, size, scale) {
  const w = size * scale, h = size * scale;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let r = 0; r < h; r++) {
    const rowStart = r * (1 + w * 4);
    raw[rowStart] = 0; // filter: none
    for (let c = 0; c < w; c++) {
      const dark = modules[Math.floor(r / scale)][Math.floor(c / scale)];
      const o = rowStart + 1 + c * 4;
      raw[o] = dark ? 0 : 255; raw[o + 1] = dark ? 0 : 255; raw[o + 2] = dark ? 0 : 255; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function generate(model) {
  if (!model.targetUrl) return model;
  const { modules, size } = matrixFor(model.targetUrl, "M", 4);
  const width = 720;
  const scale = width / size;
  const svg = renderSvg(modules, size, width);
  const png = renderPng(modules, size, scale);
  const hash = createHash("sha256").update(svg).update(png).digest("hex");
  const base = `/plugins/share-qr/assets/${hash}`;
  return { ...model, svg, png, svgUrl: `${base}.svg`, pngUrl: `${base}.png`, width, height: width };
}

module.exports = { resolveSettings, generate };
