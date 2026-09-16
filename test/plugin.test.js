import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import nunjucks from 'nunjucks';
import { parse } from 'node-html-parser';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
const require = createRequire(import.meta.url);
const { resolveSettings, generate } = require('../build.js');
const root = path.resolve('.');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function render(name, model) {
  return nunjucks.renderString(read(name), { shareQr: model });
}

describe('standalone package', () => {
  it('has a valid generic manifest and every declared path', () => {
    const manifest = JSON.parse(read('garden-plugin.json'));
    expect(manifest).toMatchObject({ id: 'share-qr', author: 'Paolo Gabriel' });
    // The manifest owns the version; it must stay consistent with the package
    // metadata and lockfile so a bump doesn't require touching this test.
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(pkg.version).toBe(manifest.version);
    expect(lock.version).toBe(manifest.version);
    expect(lock.packages?.['']?.version).toBe(manifest.version);
    expect(manifest.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(manifest.id.startsWith('dg-')).toBe(false);
    const declared = [manifest.hooks, ...manifest.styles, ...manifest.scripts, ...Object.values(manifest.slots)];
    for (const file of declared) {
      expect(file.includes('..')).toBe(false);
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    }
    for (const file of ['build.js','index.js','dialog.js','styles.css','templates/trigger.njk','templates/dialog.njk']) {
      expect(read(file)).not.toMatch(/paolo|closeFloatingTray|\/contact\/|\/swamp\//i);
    }
  });

  it('validates URLs and filenames and fails safely', () => {
    const warn = vi.fn();
    expect(resolveSettings({ targetUrl: 'javascript:alert(1)', filename: '../../x.png' }, {}, warn)).toMatchObject({ targetUrl: null, fallbackUrl: './', filename: 'x' });
    expect(resolveSettings({ targetUrl: 'https://user:secret@example.org' }, {}, warn).targetUrl).toBeNull();
    expect(resolveSettings({}, { siteBaseUrl: 'https://example.org/' }, warn).targetUrl).toBe('https://example.org');
    expect(resolveSettings({ svg: false, png: false }, { siteBaseUrl: 'https://example.org' }, warn).svg).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it('generates deterministic PNG and SVG for the exact target', async () => {
    const model = resolveSettings({ targetUrl: 'https://example.org/path?q=1#x' });
    const first = await generate(model);
    const second = await generate(model);
    expect(first.svg).toBe(second.svg);
    expect(first.png.equals(second.png)).toBe(true);
    expect(first.svgUrl).toBe(second.svgUrl);
    expect(first.svg).toContain('width="720"');
    const png = PNG.sync.read(first.png);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toBe(model.targetUrl);
  });

  it('escapes templates, emits one default trigger, and has a safe unavailable state', async () => {
    const generated = await generate(resolveSettings({ targetUrl: 'https://example.org', label: '<img src=x onerror=bad()>', triggerLabel: '" onclick="bad()', filename: '../../x.png' }));
    const model = { ...generated, available: true };
    const doc = parse(render('templates/trigger.njk', model) + render('templates/dialog.njk', model));
    expect(doc.querySelectorAll('[data-share-qr-trigger]')).toHaveLength(1);
    expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(doc.querySelector('[onclick]')).toBeNull();
    expect(doc.querySelector('h2').textContent).toBe('<img src=x onerror=bad()>');
    expect(doc.querySelector('[data-share-qr-trigger]').getAttribute('download')).toBe('x.svg');
    // Owner text reaches both attributes, so both must render escaped. Assert
    // on the raw markup: a parsed DOM hands back decoded entities.
    const rawTrigger = render('templates/trigger.njk', model);
    expect(rawTrigger).toContain('aria-label="&quot; onclick=&quot;bad(): &lt;img src=x onerror=bad()&gt;"');
    expect(rawTrigger).toContain('title="&lt;img src=x onerror=bad()&gt;"');
    expect(parse(render('templates/trigger.njk', { ...model, externalTrigger: true })).querySelector('[data-share-qr-trigger]')).toBeNull();
    const unavailable = parse(render('templates/dialog.njk', { ...resolveSettings({}, {}), available: false }));
    expect(unavailable.querySelector('img')).toBeNull();
    expect(unavailable.textContent).toContain('QR unavailable');
    expect(unavailable.querySelector('a').getAttribute('href')).toBe('./');
  });

  it('renders an inline SVG mark, one visible label, and no remote asset', () => {
    const base = { ...resolveSettings({ targetUrl: 'https://example.org' }), svgUrl: '/qr.svg', pngUrl: '/qr.png', width: 720, height: 720, available: true };
    const mark = extra => parse(render('templates/trigger.njk', { ...base, ...extra })).querySelector('.share-qr-trigger');
    for (const [triggerIcon, count] of [['qr', 1], ['link', 1], ['none', 0]]) {
      const trigger = mark({ triggerIcon });
      expect(trigger.querySelectorAll('svg.share-qr-trigger-mark')).toHaveLength(count);
      // Icon-only by default: the mark never contributes text and the glyph is
      // the only visible content; the accessible name is the card label.
      expect(trigger.textContent.replace(/\s+/g, ' ').trim()).toBe('');
      expect(trigger.outerHTML).not.toMatch(/https?:|url\(|xlink/i);
      expect(trigger.getAttribute('aria-label')).toBe('Scan to visit this site');
      expect(trigger.getAttribute('title')).toBe('Scan to visit this site');
    }
    expect(mark({ triggerIcon: 'qr' }).innerHTML).not.toBe(mark({ triggerIcon: 'link' }).innerHTML);
    // An unusable icon value falls back to the QR mark rather than rendering nothing.
    expect(resolveSettings({ targetUrl: 'https://example.org', triggerIcon: 'bogus' }).triggerIcon).toBe('qr');
  });

  it('writes both assets before exposing links and falls back on filesystem failure', async () => {
    const events = {};
    let computed;
    require('../index.js').setupEleventy({
      on: (name, fn) => { events[name] = fn; },
      addGlobalData: (name, fn) => { expect(name).toBe('eleventyComputed.shareQr'); computed = fn(); },
    });
    const out = fs.mkdtempSync('/tmp/share-qr-test-');
    try {
      events['eleventy.before']({ dir: { output: out } });
      const ok = await computed({ plugins: { settings: { 'share-qr': { targetUrl: 'https://example.org' } } }, meta: {} });
      expect(ok.available).toBe(true);
      expect(fs.statSync(path.join(out, ok.svgUrl)).size).toBeGreaterThan(500);
      expect(fs.statSync(path.join(out, ok.pngUrl)).size).toBeGreaterThan(500);
      const blocked = path.join(out, 'blocked'); fs.writeFileSync(blocked, 'x');
      events['eleventy.before']({ dir: { output: blocked } });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fallback = await computed({ plugins: { settings: { 'share-qr': { targetUrl: 'https://example.org' } } }, meta: {} });
      expect(fallback.available).toBe(false);
      warn.mockRestore();
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
  });
});
