const fs = require("node:fs/promises");
const path = require("node:path");
const { resolveSettings, generate } = require("./build");

module.exports = {
  setupEleventy(eleventyConfig) {
    let output = "dist";
    const cache = new Map();
    eleventyConfig.on("eleventy.before", (event = {}) => {
      output = event.dir?.output || "dist";
      cache.clear();
    });
    // Computed data is awaited before rendering. Async filters inside a host's
    // synchronous Nunjucks include loops can silently omit the entire include.
    eleventyConfig.addGlobalData("eleventyComputed.shareQr", () => async (data) => {
      const settings = data.plugins?.settings?.["share-qr"] || {};
      const meta = data.meta || {};
      const key = JSON.stringify([settings, meta.siteBaseUrl]);
      if (!cache.has(key)) cache.set(key, (async () => {
        const model = resolveSettings(settings, meta);
        if (!model.targetUrl) return { ...model, available: false };
        try {
          const assets = await generate(model);
          const svgPath = path.join(output, assets.svgUrl);
          const pngPath = path.join(output, assets.pngUrl);
          await fs.mkdir(path.dirname(svgPath), { recursive: true });
          // Return links only after BOTH writes succeed. Content-addressed names
          // cannot point at a different build's payload, even during watch mode.
          await Promise.all([fs.writeFile(svgPath, assets.svg), fs.writeFile(pngPath, assets.png)]);
          return { ...model, available: true, svgUrl: assets.svgUrl, pngUrl: assets.pngUrl, width: assets.width, height: assets.height };
        } catch (error) {
          console.warn(`[share-qr] QR generation unavailable (${error.code || error.name}); using a navigation link.`);
          return { ...model, available: false };
        }
      })());
      return cache.get(key);
    });
  },
};
