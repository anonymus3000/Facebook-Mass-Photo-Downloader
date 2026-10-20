// Shared by the main process (require) and the renderer (<script> -> window.Core).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Rolling year ranges that start on Aug 25: 2022-08-25 .. 2023-08-24 -> "2022-2023".
  function yearTag(ms) {
    const d = new Date(ms);
    if (isNaN(d)) return null;
    const y = d.getFullYear();
    const start = d >= new Date(y, 7, 25) ? y : y - 1; // month 7 = August
    return `${start}-${start + 1}`;
  }

  // Lower-cased tag set used for query matching (manual tags + year tag + "untagged").
  function tagSet(own, year) {
    const s = new Set(own.map((t) => t.toLowerCase()));
    if (!own.length) s.add('untagged');
    if (year) s.add(year);
    return s;
  }

  function tokenize(src) {
    const out = [], re = /\s*(\(|\)|"[^"]*"|[^\s()"]+)/g;
    let m;
    while ((m = re.exec(src))) {
      let t = m[1];
      if (t === '(' || t === ')') { out.push({ k: t }); continue; }
      if (t[0] === '"') { out.push({ k: 'w', v: t.slice(1, -1).toLowerCase() }); continue; }
      while (t.length > 1 && t[0] === '!') { out.push({ k: 'not' }); t = t.slice(1); }
      const u = t.toUpperCase();
      if (u === 'AND' || t === '&' || t === '&&') out.push({ k: 'and' });
      else if (u === 'OR' || t === '|' || t === '||') out.push({ k: 'or' });
      else if (u === 'NOT' || t === '!') out.push({ k: 'not' });
      else out.push({ k: 'w', v: t.toLowerCase() });
    }
    return out;
  }

  // Boolean query: NOT > AND > OR, parentheses, adjacent terms mean AND.
  // e.g. `funny AND clipped`, `funny OR isaac`, `(funny OR clipped) AND 2023-2024 AND NOT isaac`
  function compile(src) {
    const toks = tokenize(src || ''), tags = new Set();
    let i = 0;
    if (!toks.length) return { test: () => true, tags: [] };
    const is = (k) => toks[i] && toks[i].k === k;
    const startsTerm = () => toks[i] && (toks[i].k === 'w' || toks[i].k === '(' || toks[i].k === 'not');
    function or() { let l = and(); while (is('or')) { i++; const a = l, b = and(); l = (s) => a(s) || b(s); } return l; }
    function and() {
      let l = not();
      while (is('and') || startsTerm()) { if (is('and')) i++; const a = l, b = not(); l = (s) => a(s) && b(s); }
      return l;
    }
    function not() { if (is('not')) { i++; const f = not(); return (s) => !f(s); } return atom(); }
    function atom() {
      const t = toks[i++];
      if (!t) throw new Error('The filter ends too early');
      if (t.k === '(') { const n = or(); if (!is(')')) throw new Error('Missing closing )'); i++; return n; }
      if (t.k === 'w') { tags.add(t.v); return (s) => s.has(t.v); }
      throw new Error(`Unexpected ${t.k}`);
    }
    const test = or();
    if (i < toks.length) throw new Error('Unexpected ' + toks[i].k);
    return { test, tags: [...tags] };
  }

  return { yearTag, tagSet, compile };
});
