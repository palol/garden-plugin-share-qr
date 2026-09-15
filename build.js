const QRCode = require("qrcode");
const { createHash } = require("node:crypto");

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
    triggerLabel: text("triggerLabel", "Show site QR"),
    triggerIcon: ["qr", "link", "none"].includes(settings.triggerIcon) ? settings.triggerIcon : "qr",
    externalTrigger: settings.externalTrigger === true,
    maxSize: Number.isFinite(settings.maxSize) ? Math.max(160, Math.min(360, settings.maxSize)) : 360,
    accentToken: typeof settings.accentToken === "string" && /^--[a-zA-Z][a-zA-Z0-9-]*$/.test(settings.accentToken) ? settings.accentToken : "--interactive-accent",
  };
}

async function generate(model) {
  if (!model.targetUrl) return model;
  const options = { errorCorrectionLevel: "M", margin: 4, width: 720, color: { dark: "#000000ff", light: "#ffffffff" } };
  // Pin the mask as well as the payload and encoding options for both renderers.
  options.maskPattern = QRCode.create(model.targetUrl, options).maskPattern;
  const [svg, png] = await Promise.all([
    QRCode.toString(model.targetUrl, { ...options, type: "svg" }),
    QRCode.toBuffer(model.targetUrl, { ...options, type: "png" }),
  ]);
  const hash = createHash("sha256").update(svg).update(png).digest("hex");
  const base = `/plugins/share-qr/assets/${hash}`;
  return { ...model, svg, png, svgUrl: `${base}.svg`, pngUrl: `${base}.png`, width: 720, height: 720 };
}

module.exports = { resolveSettings, generate };
