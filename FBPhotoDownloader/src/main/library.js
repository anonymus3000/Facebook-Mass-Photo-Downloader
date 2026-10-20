'use strict';
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), crypto = require('crypto');
const sharp = require('sharp');
const exifr = require('exifr');
const Core = require('../shared/core');

const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const THUMB_PX = 360;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, f); }; // atomic
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * One opened folder.
 *  <root>/.cache/index.json      disposable: size/mtime/EXIF date/thumb name per photo
 *  <root>/.cache/thumbs/*.jpg    disposable: 360px thumbnails
 *  <root>/.photoculler-tags.json the real data: tags (survives deleting .cache)
 * Original photos are never touched.
 */
class Library {
  constructor(root) {
    this.root = root;
    this.cacheDir = path.join(root, '.cache');
    this.thumbDir = path.join(this.cacheDir, 'thumbs');
    fs.mkdirSync(this.thumbDir, { recursive: true });

    this.cacheFile = path.join(this.cacheDir, 'index.json');
    this.tagsFile = path.join(root, '.photoculler-tags.json');
    this.index = readJSON(this.cacheFile, {}).photos || {};
    const saved = readJSON(this.tagsFile, {}).tags || {};
    this.tagMap = new Map(Object.entries(saved).map(([rel, t]) => [rel, new Set(t)]));
    this.tagTimer = null; this.tagsDirty = false; this.lastSave = 0;

    this.photos = []; this.pending = []; this.relSet = new Set(); this.byBase = new Map(); this.closed = false;
  }

  async walk(dir, out) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue; // skips .cache and other hidden folders
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await this.walk(p, out);
      else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
  }

  /** Fast path: list files, reuse cached dates/thumbs, queue whatever is new or changed. */
  async load() {
    const files = [];
    await this.walk(this.root, files);
    const haveThumbs = new Set(await fsp.readdir(this.thumbDir));
    const photos = [];
    for (let i = 0; i < files.length; i += 64) {
      const chunk = files.slice(i, i + 64);
      const stats = await Promise.all(chunk.map((f) => fsp.stat(f)));
      chunk.forEach((f, j) => {
        const st = stats[j], mtime = Math.floor(st.mtimeMs);
        const rel = path.relative(this.root, f).split(path.sep).join('/');
        const c = this.index[rel];
        const fresh = c && c.size === st.size && c.mtime === mtime && (c.thumb === '' || haveThumbs.has(c.thumb));
        const birth = st.birthtimeMs > 0 ? st.birthtimeMs : Infinity;
        photos.push({
          rel, size: st.size, mtime,
          taken: fresh ? c.taken : Math.floor(Math.min(birth, st.mtimeMs)), // provisional until EXIF is read
          thumb: fresh ? c.thumb : '',
          fresh: !!fresh,
        });
      });
    }
    photos.sort((a, b) => collator.compare(a.rel, b.rel));
    this.photos = photos;
    this.pending = photos.filter((p) => !p.fresh);
    this.relSet = new Set(photos.map((p) => p.rel));
    for (const p of photos) {
      const b = path.posix.basename(p.rel);
      this.byBase.set(b, this.byBase.has(b) ? null : p.rel); // null = ambiguous filename
    }
    return photos.map((p) => this.pub(p));
  }

  pub(p) { return { rel: p.rel, taken: p.taken, year: Core.yearTag(p.taken), thumb: p.thumb }; }

  async process(p) {
    const abs = path.join(this.root, p.rel);
    try { // EXIF reads only the file header, so this is cheap even for huge JPEGs
      const ex = await exifr.parse(abs, { pick: ['DateTimeOriginal', 'CreateDate'] });
      const d = ex && (ex.DateTimeOriginal || ex.CreateDate);
      if (d instanceof Date && !isNaN(d)) p.taken = d.getTime();
    } catch { /* keep file-time fallback */ }
    const name = crypto.createHash('sha1').update(`${p.rel}|${p.size}|${p.mtime}`).digest('hex').slice(0, 20) + '.jpg';
    try {
      await sharp(abs, { failOn: 'none' }).rotate()
        .resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72 }).toFile(path.join(this.thumbDir, name));
      p.thumb = name;
    } catch { p.thumb = ''; }
    p.fresh = true;
  }

  /** Slow path, runs once per new/changed photo; streams batches to the UI. */
  async buildMissing(send) {
    const todo = this.pending, total = todo.length;
    if (!total) return;
    let next = 0, done = 0, batch = [];
    const flush = (force) => {
      if (this.closed) return;
      if (batch.length) {
        for (const p of batch) this.index[p.rel] = { size: p.size, mtime: p.mtime, taken: p.taken, thumb: p.thumb };
        send({ done, total, updates: batch.map((p) => this.pub(p)) });
        batch = [];
      }
      if (force || Date.now() - this.lastSave > 3000) this.saveCache();
    };
    const worker = async () => {
      while (!this.closed) {
        const i = next++;
        if (i >= total) break;
        await this.process(todo[i]);
        batch.push(todo[i]); done++;
        if (batch.length >= 40) flush();
      }
    };
    await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 1) }, worker));
    flush(true);
  }

  saveCache() { this.lastSave = Date.now(); try { writeJSON(this.cacheFile, { version: 1, photos: this.index }); } catch {} }

  getAllTags() {
    const m = {};
    for (const [rel, set] of this.tagMap) m[rel] = [...set];
    return m;
  }

  applyOps(ops) {
    for (const o of ops) {
      if (!o || !this.relSet.has(o.rel) || typeof o.tag !== 'string' || !o.tag || o.tag.length > 100) continue;
      let s = this.tagMap.get(o.rel);
      if (o.add) { if (!s) this.tagMap.set(o.rel, (s = new Set())); s.add(o.tag); }
      else if (s) { s.delete(o.tag); if (!s.size) this.tagMap.delete(o.rel); }
    }
    this.tagsDirty = true;
    if (!this.tagTimer) this.tagTimer = setTimeout(() => this.saveTags(), 250);
  }

  saveTags() {
    clearTimeout(this.tagTimer); this.tagTimer = null;
    if (!this.tagsDirty) return;
    this.tagsDirty = false;
    writeJSON(this.tagsFile, { app: 'photoculler', version: 1, tags: this.getAllTags() });
  }

  resolveRel(rel) { return this.relSet.has(rel) ? rel : this.byBase.get(path.posix.basename(rel)) || null; }

  close() {
    if (this.closed) return;
    try { this.saveTags(); } catch {}
    try { this.saveCache(); } catch {}
    this.closed = true;
  }
}

module.exports = { Library };
