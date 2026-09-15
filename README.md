# Share QR

An accessible Digital Garden plugin that generates a deterministic site QR at build time. Visitors can open a responsive dialog, copy the target link, or download SVG or PNG. It makes no network requests, uses no tracking, and never generates QR codes in the browser.

![Share QR dialog](screenshot.png)

## Install

Install from the Digital Garden community browser after the plugin is listed, or paste this repository URL into the plugin installer. For manual installation, copy this repository into `src/plugins/share-qr/`, enable `share-qr` in `src/plugins/plugins.json`, and restart the development server because the plugin registers an Eleventy hook.

Share QR has no runtime dependencies. It bundles a small MIT-licensed pure-JS QR encoder under `vendor/`, so it works in stock Digital Garden hosts that do not ship the `qrcode` npm package. It does not run install-time scripts or modify the garden.

With a valid `meta.siteBaseUrl`, the plugin works without configuration. Its default `floating.bottomRight` slot renders one ordinary link and `common.footer` renders the dialog.

## Settings

The manifest declares typed settings with descriptions, defaults, and environment mappings. Current Digital Garden hosts do not expose a complete generated settings panel, so environment variables are the no-code configuration path. A site owner may also set values in `src/plugins/plugins.json`; registry values take precedence over environment values, then manifest defaults.

| Setting | Default | Rules |
| --- | --- | --- |
| `targetUrl` | site base URL | Absolute HTTP(S), no credentials or embedded whitespace |
| `label` | Scan to visit this site | Escaped plain text, up to 500 characters |
| `filename` | site-qr | Safe 80-character stem; extension added automatically |
| `svg` / `png` | true / true | Select offered formats; both false safely re-enables SVG |
| `triggerLabel` | Show site QR | Escaped accessible name |
| `triggerIcon` | qr | `qr`, `link`, or `none`; never raw HTML |
| `maxSize` | 360 | Display pixels clamped to 160-360 |
| `accentToken` | --interactive-accent | CSS custom-property name only |
| `externalTrigger` | false | Suppress the default trigger only when the host supplies one |

Environment names use the `SHARE_QR_` prefix, such as `SHARE_QR_LABEL` and `SHARE_QR_TARGET_URL`.

An invalid explicit URL warns and falls back to validated site metadata. If no valid target remains, the plugin emits no placeholder QR and renders a usable navigation link. SVG and PNG use the same canonical URL, error-correction level M, a four-module quiet zone, black modules on white, and 720 px dimensions, generated deterministically from the vendored encoder.

## Accessibility and progressive enhancement

The default trigger is a real download link without JavaScript. JavaScript enhances it into a dialog with initial focus, Tab containment, Escape and backdrop dismissal, scroll locking, focus restoration, copy success/failure announcements, and 44 px controls. The component deliberately has no motion. QR modules remain black on white in all themes.

If `window.createDialogController(container, options)` exists, Share QR uses that host lifecycle controller. Otherwise it supplies a self-contained accessible fallback.

## Host trigger adapter

Keep `externalTrigger` false unless the host renders exactly one replacement link. The default floating slot intentionally renders no element when this setting is true.

A replacement trigger must use `shareQr`, render `data-share-qr-trigger`, retain a real QR asset `href` plus `download`, and remain visible without JavaScript. The browser adapter is `window.ShareQr.open()` / `.close()`. Before opening, a bubbling `share-qr:before-open` event lets a host collapse navigation and establish a stable opener. Share QR imports no Search, Contact, navigation, or site-specific code.

## Styling

The surrounding card follows `.theme-dark` or `[data-theme="dark"]`. Optional advanced variables are `--share-qr-surface` and `--share-qr-ink`; `accentToken` selects a host accent variable. None can recolor QR pixels.

## Compatibility, upgrades, and rollback

Tested against Digital Garden 1.90-compatible plugin APIs and Node 22. Plugin releases follow SemVer and tags match `garden-plugin.json`. Patch releases preserve settings and adapter contracts; minor releases may add optional settings; breaking changes require a major version.

To roll back, pin an earlier release in the installer. To remove Share QR, disable it in `src/plugins/plugins.json`, remove `src/plugins/share-qr/`, and restart the development server. No notes or external data need migration.

## Development

```sh
npm ci
npm test
```

Tests cover manifest paths and generic identity, URL and filename safety, deterministic output, PNG decoding, failure fallbacks, template escaping, dialog lifecycle, copy behavior, reduced motion, and 320/390/600/1200 px geometry in light and dark themes. Host-specific dogfood tests remain in the host garden rather than this repository.

## Privacy and provenance

Share QR generates local build assets from the configured URL. It performs no runtime network calls and stores nothing. Extracted and redesigned from Paolo Gabriel's Digital Garden integration. The optional shared dialog controller is a host API and is not bundled. The bundled QR encoder is `qrcode-generator` by Kazuhiko Arase, MIT-licensed; see `vendor/LICENSE.qrcode-generator`.
