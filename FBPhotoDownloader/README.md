# Photo Culler

Local-first Electron app for culling, sorting and tagging huge photo folders (tested design target: 15,000+ JPGs).

## Setup

```bash
npm install
npm start
```

Needs Node 18+. No native compiling: `sharp` and `exifr` install from prebuilt binaries.

## Layout

```
main.js                    window, protocol, IPC handlers (all inputs validated, sender checked)
preload.js                 contextBridge: the only API the renderer sees
src/main/library.js        folder scan, .cache thumbnails + EXIF dates (JSON), tag database
src/main/exporter.js       symlink / hardlink / copy export, folder-per-tag layout
src/shared/core.js         year-range tagging + boolean query parser (used by both processes)
src/renderer/index.html    UI shell + strict CSP
src/renderer/styles.css
src/renderer/virtual.js    windowed grid / strip (recycles DOM cells)
src/renderer/app.js        selection, viewer zoom/pan, tagging, undo/redo, keybinds, export/backup UI
```

## Where data lives (inside the opened folder)

| Path | What | Safe to delete? |
|---|---|---|
| `.cache/index.json`, `.cache/thumbs/` | EXIF dates, 360px thumbnails | Yes, rebuilt on next load |
| `.photoculler-tags.json` | Your tags (JSON) | No, back it up |

Original photos are never modified. First load indexes in the background (thumbnails appear as they finish);
later loads only stat the files and reuse the cache. Changed files (size/mtime) are re-indexed automatically.

## Controls

| Action | Input |
|---|---|
| Next / previous photo | Mouse wheel, arrow keys, Home / End |
| Zoom at cursor / pan | Ctrl (Cmd) + wheel or pinch / drag when zoomed; double-click toggles 3x |
| Switch Photo / Grid | Toolbar or Tab |
| Select | Click; Shift+click range; Ctrl/Cmd+click toggle; Shift+arrows extend; Ctrl+A all |
| Tag | Your keybinds (defaults: g and Ctrl+g = funny, c = clipped, i = isaac). Pressing again removes it |
| Undo / redo | Ctrl/Cmd+Z, Ctrl+Y or Ctrl/Cmd+Shift+Z |

Notes:
- Tags are case-insensitive and stored lowercase.
- Year-range tags are automatic (Aug 25 to Aug 24 windows, e.g. `2022-2023`) and are searchable but not stored as manual tags.
- Filter / export queries: `funny AND clipped`, `funny OR isaac`, `(funny OR clipped) AND 2023-2024 AND NOT isaac`, `untagged`.
- The filter list only recomputes when the filter text changes, so a photo does not vanish from under you while you tag it.
- Symlinks on Windows need Developer Mode or admin rights; hard links only work within one drive. Copy always works.
- Packaging: with electron-builder, unpack native modules from asar (`asarUnpack` for `sharp`).
