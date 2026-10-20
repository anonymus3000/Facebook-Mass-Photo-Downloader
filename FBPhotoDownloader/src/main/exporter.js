'use strict';
const fs = require('fs'), fsp = fs.promises, path = require('path');
const Core = require('../shared/core');

const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

// Create `dir/<name>` as a symlink, hardlink or copy; never overwrites (adds _1, _2, ...).
async function place(src, dir, mode) {
  await fsp.mkdir(dir, { recursive: true });
  const { name, ext } = path.parse(src);
  for (let k = 0; k < 1000; k++) {
    const target = path.join(dir, k ? `${name}_${k}${ext}` : name + ext);
    try {
      if (mode === 'copy') await fsp.copyFile(src, target, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      else if (mode === 'hardlink') await fsp.link(src, target);
      else await fsp.symlink(src, target);
      return;
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('too many name collisions');
}

async function run(lib, { query, mode, layout, dest }, progress) {
  if (!['symlink', 'hardlink', 'copy'].includes(mode)) throw new Error('Unknown export mode');
  const q = Core.compile(query || '');
  const tagMap = lib.getAllTags();
  const jobs = [];
  for (const p of lib.photos) {
    const own = tagMap[p.rel] || [], year = Core.yearTag(p.taken);
    if (!q.test(Core.tagSet(own, year))) continue;
    if (layout === 'by-tag') {
      const all = [...own, year];
      let dirs = q.tags.length ? all.filter((t) => q.tags.includes(t.toLowerCase())) : all;
      if (!dirs.length) dirs = [q.tags[0] || 'untagged'];
      for (const t of dirs) jobs.push([p.rel, path.join(dest, safe(t))]);
    } else jobs.push([p.rel, dest]);
  }
  let done = 0, ok = 0;
  const errors = [];
  for (let i = 0; i < jobs.length; i += 16) {
    await Promise.all(jobs.slice(i, i + 16).map(async ([rel, dir]) => {
      try { await place(path.join(lib.root, rel), dir, mode); ok++; }
      catch (e) { errors.push(`${rel}: ${e.code || e.message}`); }
      progress({ done: ++done, total: jobs.length });
    }));
  }
  return { ok, failed: errors.length, total: jobs.length, errors: errors.slice(0, 20) };
}

module.exports = { run };
