import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import nunjucks from "nunjucks";
import { parse } from "node-html-parser";
const require = createRequire(import.meta.url);
const { resolveSettings } = require("../build.js");
const root = path.resolve(".");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const model = overrides => ({ ...resolveSettings({ targetUrl: "https://example.org", ...overrides }), svgUrl: "/qr.svg", pngUrl: "/qr.png", width: 720, height: 720, available: true });
const render = value => ["templates/trigger.njk", "templates/dialog.njk"]
  .map(template => nunjucks.renderString(read(template), { shareQr: value }))
  .join("");

function chrome(html, checks) {
  const dir = fs.mkdtempSync("/tmp/opencode/share-qr-ui-");
  try {
    fs.writeFileSync(path.join(dir, "test.html"), `${html}<script>addEventListener('load', async () => {
      const result = document.createElement('pre'); result.id = 'result';
      try { const assert = (v,m) => { if(!v) throw Error(m); }; ${checks}; result.textContent = 'PASS'; }
      catch(e) { result.textContent = e.stack; } document.body.append(result);
    });</script>`);
    const output = execFileSync(process.env.CHROME_BIN || "/usr/bin/google-chrome", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion", `--user-data-dir=${dir}/profile`, "--virtual-time-budget=5000", "--dump-dom", `file://${dir}/test.html`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
    return parse(output).querySelector('#result')?.textContent;
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

describe("share-qr presentation", () => {
  it("escapes labels and attributes, renders one real trigger and modal, and respects format availability", () => {
    const html = render(model({ label: '<img src=x onerror="bad()">', triggerLabel: '" onclick="bad()', filename: '../../x.png' }));
    const doc = parse(html);
    expect(doc.querySelectorAll('[data-share-qr-trigger]')).toHaveLength(1);
    expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(doc.querySelector('h2').textContent).toBe('<img src=x onerror="bad()">');
    expect(doc.querySelector('[onclick]')).toBeNull();
    expect(doc.querySelector('[data-share-qr-trigger]').getAttribute('href')).toBe('/qr.svg');
    expect(doc.querySelector('[data-share-qr-trigger]').getAttribute('download')).toBe('x.svg');
    expect(doc.querySelector('[data-share-qr-download]').getAttribute('download')).toBe('x.png');
    expect(parse(render(model({ svg: false }))).querySelector('img').getAttribute('src')).toBe('/qr.png');
    expect(parse(render(model({ png: false }))).querySelector('[data-share-qr-download]').getAttribute('href')).toBe('/qr.svg');
    expect(parse(render(model({ externalTrigger: true }))).querySelector('[data-share-qr-trigger]')).toBeNull();
    const fallback = parse(render({ ...model(), available: false, targetUrl: null, fallbackUrl: './' }));
    expect(fallback.querySelector('img')).toBeNull();
    expect(fallback.textContent).toContain('QR unavailable');
    expect(fallback.querySelector('a').getAttribute('href')).toBe('./');
  });

  for (const shared of [false]) it(`handles copy, downloads, focus, keyboard, backdrop and repeated opens (standalone)`, () => {
    const controller = '';
    const html = `<!doctype html><style>${read('styles.css')}</style><button id="outside">Outside</button>${controller}${render(model())}<script>${read('dialog.js')}</script>`;
    expect(chrome(html, `
      const trigger = document.querySelector('[data-share-qr-trigger]');
      const modal = document.getElementById('share-qr-dialog');
      const close = modal.querySelector('[data-share-qr-close]');
      const copy = modal.querySelector('[data-share-qr-copy]');
      const download = modal.querySelector('[data-share-qr-download]');
      const status = modal.querySelector('[role=status]');
      let copied; Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async v=>{copied=v;}} });
      trigger.focus(); trigger.click();
      assert(modal.classList.contains('active') && !modal.inert, 'opens');
      assert(document.activeElement===close, 'initial focus');
      assert(getComputedStyle(document.body).overflow==='hidden', 'scroll lock');
      outside.focus(); assert(document.activeElement===close, 'focus containment');
      close.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
      assert(document.activeElement===download, 'reverse Tab wraps');
      download.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      assert(document.activeElement===close, 'forward Tab wraps');
      copy.click(); await new Promise(r=>setTimeout(r,0));
      assert(copied==='https://example.org' && status.textContent==='Link copied.', 'copy success');
      navigator.clipboard.writeText=async()=>{throw Error('denied');}; copy.click(); await new Promise(r=>setTimeout(r,0));
      assert(status.textContent==='Could not copy. Use the link below.', 'copy failure');
      assert(modal.querySelector('[data-share-qr-link]').href==='https://example.org/', 'selectable failure link');
      delete navigator.clipboard; copy.click(); await new Promise(r=>setTimeout(r,0)); assert(status.textContent.includes('Could not copy'), 'clipboard absent');
      const event = new MouseEvent('click',{bubbles:true,cancelable:true}); download.addEventListener('click',e=>e.preventDefault(),{once:true});
      assert(download.download==='site-qr.png' && download.getAttribute('href')==='/qr.png', 'native download'); download.dispatchEvent(event);
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert(modal.inert && document.activeElement===trigger && getComputedStyle(document.body).overflow!=='hidden', 'Escape restores');
      trigger.click(); assert(status.textContent==='', 'status reset'); modal.click(); assert(modal.inert && document.activeElement===trigger, 'backdrop restores');
      trigger.click(); window.ShareQr.open(); close.click(); assert(document.activeElement===trigger, 'repeat open preserves opener');
      const modified = new MouseEvent('click',{ctrlKey:true,bubbles:true,cancelable:true});
      trigger.addEventListener('click', e=>{setTimeout(()=>{},0);}, {once:true});
      trigger.dispatchEvent(modified); assert(!modified.defaultPrevented && modal.inert, 'modified link remains native');
      assert(matchMedia('(prefers-reduced-motion: reduce)').matches, 'reduced motion emulated');
      assert(getComputedStyle(modal).animationName==='none' && getComputedStyle(modal).transitionDuration==='0s', 'no motion');
    `)).toBe('PASS');
  });

  it("fits exact 320/390/600/1200px frames in light and dark themes", () => {
    const fixture = `<!doctype html><style>body{margin:0}${read('styles.css')}</style>${render(model())}<script>${read('dialog.js')}</script>`;
    expect(chrome('<!doctype html>', `
      for (const width of [320,390,600,1200]) for(const theme of ['light','dark']) {
        const frame=document.createElement('iframe'); frame.style.cssText='border:0;width:'+width+'px;height:900px';
        frame.srcdoc=${JSON.stringify(fixture).replaceAll('<', '\\u003c')}; document.body.append(frame); await new Promise(r=>frame.onload=r);
        const w=frame.contentWindow,d=w.document; d.body.className='theme-'+theme; w.ShareQr.open();
        assert(w.innerWidth===width,'exact frame width');
        const box=d.querySelector('.share-qr-card').getBoundingClientRect(), img=d.querySelector('img').getBoundingClientRect();
        assert(box.left>=0 && box.right<=width && box.top>=0 && box.bottom<=900,'card fits '+width);
        assert(img.width<=360 && img.width>200 && Math.abs(img.width-img.height)<1,'square bounded QR');
        assert(w.getComputedStyle(d.querySelector('img')).backgroundColor==='rgb(255, 255, 255)','white QR');
        assert(d.documentElement.scrollWidth<=width && d.querySelector('.share-qr-card').scrollWidth<=box.width,'no overflow');
        frame.remove();
      }
    `)).toBe('PASS');
  });
});
