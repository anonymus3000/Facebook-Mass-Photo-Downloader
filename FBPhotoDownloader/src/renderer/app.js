'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hue = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const enc = (rel) => rel.split('/').map(encodeURIComponent).join('/');
  const fullURL = (p) => `pc://full/${enc(p.rel)}`;
  const thumbURL = (p) => (p.thumb ? `pc://thumb/${p.thumb}` : '');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------- state
  // Selection and active photo are positions in S.list (the filtered view of S.photos).
  const S = {
    root: null, photos: [], relIdx: new Map(), tags: new Map(), // rel -> Set(tag)
    list: [], sel: new Set(), active: 0, anchor: 0,
    view: 'single', q: Core.compile(''), query: '',
    keybinds: {}, opts: { gridOpens: true, thumbSize: 180 },
    undo: [], redo: [],
  };
  const photoAt = (pos) => S.photos[S.list[pos]];
  const manual = (p) => S.tags.get(p.rel);
  const allSet = (p) => Core.tagSet([...(manual(p) || [])], p.year);
  const selected = () => [...S.sel].sort((a, b) => a - b).map(photoAt).filter(Boolean);

  // ---------------------------------------------------------------- virtual lists
  function makeCell() {
    const d = document.createElement('div');
    d.innerHTML = '<img alt="" draggable="false" decoding="async"><div class="badges"></div><span class="yr"></span>';
    return d;
  }
  function updateCell(d, pos) {
    const p = photoAt(pos), img = d.firstChild, u = thumbURL(p);
    if (img.dataset.u !== u) { img.dataset.u = u; u ? (img.src = u) : img.removeAttribute('src'); }
    d.className = 'cell' + (S.sel.has(pos) ? ' sel' : '') + (pos === S.active ? ' act' : '');
    d.dataset.i = pos; d.title = p.rel;
    const t = [...(manual(p) || [])].sort();
    d.children[1].innerHTML = t.slice(0, 4).map((x) => `<b style="--h:${hue(x)}">${esc(x)}</b>`).join('') +
      (t.length > 4 ? `<b class="more">+${t.length - 4}</b>` : '');
    d.children[2].textContent = p.year || '';
  }
  const grid = new Virtual($('#grid'), { create: makeCell, update: updateCell });
  const strip = new Virtual($('#strip'), { horizontal: true, create: makeCell, update: updateCell });

  // ---------------------------------------------------------------- filtering / painting
  function refilter() {
    const cur = S.list[S.active];
    S.list = [];
    S.photos.forEach((p, i) => { if (S.q.test(allSet(p))) S.list.push(i); });
    const np = cur != null ? S.list.indexOf(cur) : -1;
    S.active = np >= 0 ? np : 0; S.anchor = S.active;
    S.sel = new Set(S.list.length ? [S.active] : []);
    grid.setCount(S.list.length); strip.setCount(S.list.length);
    paint();
  }

  function paint({ center = true } = {}) {
    grid.refresh(); strip.refresh();
    if (S.view === 'single') { if (center) strip.reveal(S.active, true); showActive(); }
    else grid.reveal(S.active, false);
    renderInfo();
  }

  function setView(v) {
    S.view = v;
    const has = S.photos.length > 0;
    $('#empty').hidden = has;
    $('#single').hidden = !has || v !== 'single'; $('#strip').hidden = !has || v !== 'single';
    $('#grid').hidden = !has || v !== 'grid'; $('#sizeWrap').hidden = !has || v !== 'grid';
    $('#vSingle').setAttribute('aria-pressed', v === 'single'); $('#vGrid').setAttribute('aria-pressed', v === 'grid');
    if (!has) return;
    (v === 'grid' ? grid : strip).layout();
    if (v === 'grid') grid.reveal(S.active, true);
    paint();
  }

  function renderInfo() {
    const n = S.sel.size, p = photoAt(S.active);
    $('#count').textContent = S.photos.length
      ? `${S.list.length.toLocaleString()} of ${S.photos.length.toLocaleString()} photos${n > 1 ? `, ${n.toLocaleString()} selected` : ''}` : '';
    if (!p) { $('#info').innerHTML = ''; return; }
    const own = [...(manual(p) || [])].sort();
    $('#info').innerHTML =
      `<span class="name">${esc(p.rel)}</span>` +
      `<span class="dim">${new Date(p.taken).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>` +
      `<span class="chip year" style="--h:0" title="Year range (automatic)">${p.year}</span>` +
      own.map((t) => `<button class="chip" style="--h:${hue(t)}" data-tag="${esc(t)}" title="Remove from selection">${esc(t)}</button>`).join('') +
      `<span class="grow"></span><span class="dim">${S.active + 1} / ${S.list.length}</span>`;
  }
  $('#info').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) setTag(b.dataset.tag, 'remove'); });

  // ---------------------------------------------------------------- selection
  function pick(pos, e, from) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.shiftKey && S.sel.size) {
      const a = Math.min(S.anchor, pos), b = Math.max(S.anchor, pos);
      if (!mod) S.sel.clear();
      for (let i = a; i <= b; i++) S.sel.add(i);
      S.active = pos;
    } else if (mod) {
      if (S.sel.has(pos) && S.sel.size > 1) { S.sel.delete(pos); if (S.active === pos) S.active = [...S.sel].pop(); }
      else { S.sel.add(pos); S.active = pos; }
      S.anchor = pos;
    } else {
      S.sel = new Set([pos]); S.active = S.anchor = pos;
      if (from === 'grid' && S.opts.gridOpens) return setView('single');
    }
    paint({ center: from === 'strip' && !mod && !e.shiftKey });
  }
  for (const [el, from] of [[$('#grid'), 'grid'], [$('#strip'), 'strip']]) {
    el.addEventListener('click', (e) => { const c = e.target.closest('.cell'); if (c) pick(+c.dataset.i, e, from); });
  }
  $('#strip').addEventListener('wheel', (e) => { e.preventDefault(); $('#strip').scrollLeft += e.deltaY + e.deltaX; }, { passive: false });

  function go(pos, extend) {
    if (!S.list.length) return;
    pos = clamp(pos, 0, S.list.length - 1);
    if (extend) {
      S.sel = new Set();
      for (let i = Math.min(S.anchor, pos); i <= Math.max(S.anchor, pos); i++) S.sel.add(i);
    } else { S.sel = new Set([pos]); S.anchor = pos; }
    S.active = pos;
    paint();
  }

  // ---------------------------------------------------------------- single photo viewer (zoom / pan / wheel nav)
  const viewer = $('#viewer'), photoEl = $('#photo');
  const V = { s: 1, tx: 0, ty: 0, token: 0, timer: 0, last: 0 };

  function applyT() {
    V.tx = clamp(V.tx, viewer.clientWidth * (1 - V.s), 0);
    V.ty = clamp(V.ty, viewer.clientHeight * (1 - V.s), 0);
    photoEl.style.transform = `translate(${V.tx}px,${V.ty}px) scale(${V.s})`;
    viewer.classList.toggle('zoomed', V.s > 1);
  }
  // Keep the image point under the cursor fixed while the scale changes.
  function zoomAt(mx, my, ns) {
    ns = clamp(ns, 1, 24);
    const k = ns / V.s;
    V.tx = mx - (mx - V.tx) * k; V.ty = my - (my - V.ty) * k; V.s = ns;
    applyT();
  }

  function showActive() {
    const p = photoAt(S.active), token = ++V.token;
    clearTimeout(V.timer);
    V.s = 1; V.tx = V.ty = 0; applyT();
    if (!p) { photoEl.removeAttribute('src'); return; }
    const t = thumbURL(p);
    t ? (photoEl.src = t) : photoEl.removeAttribute('src');          // instant low-res preview
    V.timer = setTimeout(() => {                                       // full-res once navigation settles
      const im = new Image();
      im.src = fullURL(p);
      im.decode().then(() => {
        if (token !== V.token) return;
        photoEl.src = im.src;
        for (const d of [1, -1]) { const q = photoAt(S.active + d); if (q) new Image().src = fullURL(q); } // warm neighbours
      }).catch(() => {});
    }, 80);
  }

  viewer.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {                                      // Ctrl/Cmd + wheel (and trackpad pinch) = zoom
      const r = viewer.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, V.s * Math.exp(-e.deltaY * 0.0025));
    } else {                                                           // plain wheel = next / previous photo
      const now = performance.now(), d = Math.sign(e.deltaY);
      if (!d || now - V.last < 60) return;
      V.last = now; go(S.active + d);
    }
  }, { passive: false });
  let drag = null;
  viewer.addEventListener('pointerdown', (e) => { if (V.s > 1) { drag = { x: e.clientX, y: e.clientY, tx: V.tx, ty: V.ty }; viewer.setPointerCapture(e.pointerId); } });
  viewer.addEventListener('pointermove', (e) => { if (drag) { V.tx = drag.tx + e.clientX - drag.x; V.ty = drag.ty + e.clientY - drag.y; applyT(); } });
  viewer.addEventListener('pointerup', () => { drag = null; });
  viewer.addEventListener('dblclick', (e) => {
    const r = viewer.getBoundingClientRect();
    if (V.s > 1) { V.s = 1; V.tx = V.ty = 0; applyT(); } else zoomAt(e.clientX - r.left, e.clientY - r.top, 3);
  });
  window.addEventListener('resize', applyT);

  // ---------------------------------------------------------------- tagging + undo/redo
  function applyLocal(ops) {
    for (const o of ops) {
      let s = S.tags.get(o.rel);
      if (o.add) { if (!s) S.tags.set(o.rel, (s = new Set())); s.add(o.tag); }
      else if (s) { s.delete(o.tag); if (!s.size) S.tags.delete(o.rel); }
    }
  }
  const persist = (ops) => window.api.applyTags(ops).catch(() => toast('Could not save tags to disk'));

  function commit(ops, label) {
    applyLocal(ops); persist(ops);
    S.undo.push({ ops, label }); if (S.undo.length > 2000) S.undo.shift();
    S.redo = [];
    toast(label); paint({ center: false });
  }
  function travel(from, to, verb) {
    const h = from.pop();
    if (!h) return toast(`Nothing to ${verb.toLowerCase()}`);
    const inv = h.ops.map((o) => ({ ...o, add: !o.add })).reverse();
    applyLocal(inv); persist(inv);
    to.push({ ops: inv, label: h.label });
    toast(`${verb}: ${h.label}`); paint({ center: false });
  }

  // force: 'add' | 'remove' | undefined (toggle: remove only if every selected photo already has it)
  function setTag(tag, force) {
    const ps = selected();
    if (!ps.length) return;
    const add = force ? force === 'add' : !ps.every((p) => manual(p) && manual(p).has(tag));
    const ops = ps.filter((p) => !!(manual(p) && manual(p).has(tag)) !== add).map((p) => ({ rel: p.rel, tag, add }));
    if (!ops.length) return;
    const n = ops.length, noun = `${n.toLocaleString()} photo${n > 1 ? 's' : ''}`;
    commit(ops, add ? `Added “${tag}” to ${noun}` : `Removed “${tag}” from ${noun}`);
  }

  function toast(msg) {
    const box = $('#toasts'), t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), 1800);
  }

  // ---------------------------------------------------------------- keyboard
  const RESERVED = new Set(['ctrl+z', 'ctrl+shift+z', 'ctrl+y', 'ctrl+a', 'tab']);
  const label = (k) => k.split('+').map((s) => (s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1))).join('+');
  function combo(e) { // physical key + modifiers, e.g. "g", "ctrl+g", "alt+1" (Cmd counts as Ctrl)
    const c = e.code;
    const k = c.startsWith('Key') ? c.slice(3).toLowerCase() : c.startsWith('Digit') ? c.slice(5) : e.key.toLowerCase();
    if (['control', 'shift', 'alt', 'meta'].includes(k)) return null;
    const m = [];
    if (e.ctrlKey || e.metaKey) m.push('ctrl');
    if (e.altKey) m.push('alt');
    if (e.shiftKey) m.push('shift');
    return [...m, k].join('+');
  }

  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (/INPUT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = combo(e);
    if (!k || !S.photos.length) return;
    const base = k.replace(/^shift\+/, ''), ext = e.shiftKey;
    const cols = S.view === 'grid' ? grid.cols : 1;
    const move = { arrowright: 1, arrowleft: -1, arrowdown: cols, arrowup: -cols }[base];

    if (k === 'ctrl+z') travel(S.undo, S.redo, 'Undid');
    else if (k === 'ctrl+shift+z' || k === 'ctrl+y') travel(S.redo, S.undo, 'Redid');
    else if (k === 'ctrl+a') { S.sel = new Set(S.list.map((_, i) => i)); paint({ center: false }); }
    else if (k === 'tab') setView(S.view === 'grid' ? 'single' : 'grid');
    else if (move && /^(shift\+)?arrow/.test(k)) go(S.active + move, ext);
    else if (k === 'home') go(0); else if (k === 'end') go(S.list.length - 1);
    else if (S.keybinds[k] && !e.repeat) setTag(S.keybinds[k]);
    else return;
    e.preventDefault();
  });

  // ---------------------------------------------------------------- toolbar
  $('#vSingle').onclick = () => setView('single');
  $('#vGrid').onclick = () => setView('grid');
  $('#btnOpen').onclick = async () => { const r = await window.api.pickFolder(); if (r) await openResult(r); };
  let ft;
  $('#filter').addEventListener('input', (e) => {
    clearTimeout(ft);
    ft = setTimeout(() => {
      try { S.q = Core.compile(e.target.value); S.query = e.target.value; e.target.classList.remove('bad'); refilter(); }
      catch { e.target.classList.add('bad'); }
    }, 150);
  });
  let st;
  $('#size').addEventListener('input', (e) => {
    S.opts.thumbSize = +e.target.value; grid.setItemWidth(S.opts.thumbSize); grid.reveal(S.active, true);
    clearTimeout(st); st = setTimeout(() => window.api.setSettings({ thumbSize: S.opts.thumbSize }), 400);
  });

  // ---------------------------------------------------------------- keybind manager
  const dk = $('#dlgKeys');
  let draft = [], capturing = null;
  function renderKeyRows() {
    $('#keyRows').innerHTML = draft.map((r, i) =>
      `<div class="krow"><input class="ktag" data-i="${i}" value="${esc(r.tag)}" placeholder="Tag name" aria-label="Tag name">` +
      `<button class="kkey${capturing === i ? ' capturing' : ''}" data-cap="${i}">${capturing === i ? 'Press a key…' : r.key ? label(r.key) : 'Set key'}</button>` +
      `<button data-del="${i}">Remove</button></div>`).join('');
  }
  $('#btnKeys').onclick = () => {
    draft = Object.entries(S.keybinds).map(([key, tag]) => ({ key, tag })); capturing = null;
    $('#optOpen').checked = S.opts.gridOpens; renderKeyRows(); dk.showModal();
  };
  $('#keyAdd').onclick = () => { draft.push({ key: '', tag: '' }); renderKeyRows(); };
  $('#keyCancel').onclick = () => dk.close();
  dk.addEventListener('input', (e) => { if (e.target.classList.contains('ktag')) draft[+e.target.dataset.i].tag = e.target.value; });
  dk.addEventListener('click', (e) => {
    const cap = e.target.closest('[data-cap]'), del = e.target.closest('[data-del]');
    if (cap) { capturing = +cap.dataset.cap; renderKeyRows(); }
    if (del) { draft.splice(+del.dataset.del, 1); capturing = null; renderKeyRows(); }
  });
  dk.addEventListener('keydown', (e) => {
    if (capturing === null) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { capturing = null; return renderKeyRows(); }
    const k = combo(e);
    if (!k) return;
    if (RESERVED.has(k)) return toast(`${label(k)} is reserved`);
    draft[capturing].key = k; capturing = null; renderKeyRows();
  }, true);
  $('#keySave').onclick = () => {
    const map = {};
    for (const r of draft) { const t = r.tag.trim().toLowerCase(); if (r.key && t) map[r.key] = t; } // tags are case-insensitive
    S.keybinds = map; S.opts.gridOpens = $('#optOpen').checked;
    window.api.setSettings({ keybinds: map, gridOpens: S.opts.gridOpens });
    dk.close(); toast('Keybinds saved');
  };

  // ---------------------------------------------------------------- export / backup
  const dx = $('#dlgExport');
  let exDest = null, offExport = null;
  function exMatch() {
    try {
      const q = Core.compile($('#exQuery').value);
      const n = S.photos.filter((p) => q.test(allSet(p))).length;
      $('#exCount').textContent = `${n.toLocaleString()} photos match`;
      $('#exRun').disabled = !(n && exDest);
    } catch (err) { $('#exCount').textContent = err.message; $('#exRun').disabled = true; }
  }
  $('#btnExport').onclick = () => {
    if (!S.photos.length) return toast('Open a folder first');
    $('#exQuery').value = S.query; $('#exProg').hidden = true; exMatch(); dx.showModal();
  };
  $('#exQuery').addEventListener('input', exMatch);
  $('#exClose').onclick = () => dx.close();
  $('#exPick').onclick = async () => {
    const d = await window.api.pickDir();
    if (d) { exDest = d; $('#exDest').textContent = d; exMatch(); }
  };
  $('#exRun').onclick = async () => {
    const prog = $('#exProg'); prog.hidden = false; prog.removeAttribute('value'); $('#exRun').disabled = true;
    if (offExport) offExport();
    offExport = window.api.onExport(({ done, total }) => { prog.max = total; prog.value = done; });
    try {
      const r = await window.api.runExport({
        query: $('#exQuery').value, dest: exDest,
        mode: document.querySelector('[name=exMode]:checked').value,
        layout: document.querySelector('[name=exLayout]:checked').value,
      });
      $('#exCount').textContent = `Exported ${r.ok.toLocaleString()} of ${r.total.toLocaleString()}` +
        (r.failed ? `. ${r.failed} failed (${r.errors[0]}). Try copy or hard links if symlinks are blocked.` : '.');
    } catch (err) { $('#exCount').textContent = `Export failed: ${err.message}`; }
    $('#exRun').disabled = false;
  };

  $('#btnBackup').onclick = async () => {
    const r = await window.api.exportBackup();
    if (r) toast(`Saved tags for ${r.count.toLocaleString()} photos`);
  };
  $('#btnRestore').onclick = async () => {
    const r = await window.api.importBackup();
    if (!r) return;
    if (r.error) return toast(r.error);
    const ops = [];
    for (const [rel, tags] of Object.entries(r.matched))
      for (const t of tags) if (!(S.tags.get(rel) && S.tags.get(rel).has(t))) ops.push({ rel, tag: t, add: true });
    if (!ops.length) return toast('Nothing new to restore');
    commit(ops, `Restored ${ops.length.toLocaleString()} tags` + (r.missing ? ` (${r.missing} photos not found)` : ''));
  };

  // ---------------------------------------------------------------- folder loading + background indexing
  async function openResult(res) {
    Object.assign(S, {
      root: res.root, photos: res.photos, relIdx: new Map(res.photos.map((p, i) => [p.rel, i])),
      tags: new Map(Object.entries(res.tags).map(([rel, t]) => [rel, new Set(t)])),
      list: [], active: 0, undo: [], redo: [], query: '', q: Core.compile(''),
    });
    $('#filter').value = '';
    document.title = `${res.root.split(/[\\/]/).pop()} - Photo Culler`;
    $('#empty p').textContent = 'No photos (.jpg, .jpeg, .png, .webp) found in that folder.';
    setView(S.view);
    refilter();
    if (res.pending) window.api.startScan();
  }

  let raf = 0;
  window.api.onScan(({ done, total, updates }) => {
    for (const u of updates) {
      const i = S.relIdx.get(u.rel);
      if (i != null) Object.assign(S.photos[i], { taken: u.taken, year: u.year, thumb: u.thumb });
    }
    $('#scanbar').style.setProperty('--p', (done / total) * 100 + '%');
    $('#scanText').textContent = done < total ? `Indexing ${done.toLocaleString()} / ${total.toLocaleString()}` : '';
    if (done >= total) setTimeout(() => $('#scanbar').style.setProperty('--p', '0%'), 600);
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; grid.refresh(); strip.refresh(); renderInfo(); });
  });

  (async () => {
    const s = await window.api.getSettings();
    S.keybinds = s.keybinds || {}; S.opts.gridOpens = s.gridOpens !== false; S.opts.thumbSize = s.thumbSize || 180;
    $('#size').value = S.opts.thumbSize; grid.setItemWidth(S.opts.thumbSize);
    setView('single');
    if (s.lastFolder) {
      $('#empty p').textContent = 'Loading your last folder…';
      try { await openResult(await window.api.openFolder(s.lastFolder)); }
      catch { $('#empty p').textContent = 'Open a folder of photos to start culling.'; }
    }
  })();
})();
