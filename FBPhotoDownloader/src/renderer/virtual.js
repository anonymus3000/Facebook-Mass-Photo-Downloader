'use strict';
/**
 * Windowed list: keeps only the cells in (or just outside) the viewport in the DOM and
 * recycles them. Vertical = responsive grid, horizontal = single-row strip.
 * Cells are square and sized to fit; 15,000 items costs the same as 50.
 */
class Virtual {
  constructor(el, { horizontal = false, gap = 6, create, update }) {
    Object.assign(this, { el, h: horizontal, gap, createFn: create, updateFn: update,
      count: 0, itemW: 180, cols: 1, cw: 0, ch: 0, live: new Map(), pool: [] });
    this.sizer = document.createElement('div');
    this.sizer.className = 'v-sizer';
    el.appendChild(this.sizer);
    el.addEventListener('scroll', () => this.render(), { passive: true });
    new ResizeObserver(() => this.layout()).observe(el);
  }

  setCount(n) { this.count = n; this.layout(); }
  setItemWidth(w) { this.itemW = w; this.layout(); }

  layout() {
    const W = this.el.clientWidth, H = this.el.clientHeight, g = this.gap;
    if (!W || !H) return; // hidden
    if (this.h) {
      this.ch = this.cw = H - g * 2; this.cols = 1;
      this.sizer.style.width = this.count * (this.cw + g) + g + 'px';
      this.sizer.style.height = '1px';
    } else {
      this.cols = Math.max(1, Math.floor((W - g) / (this.itemW + g)));
      this.cw = this.ch = (W - g * (this.cols + 1)) / this.cols;
      this.sizer.style.height = Math.ceil(this.count / this.cols) * (this.ch + g) + g + 'px';
    }
    for (const n of this.live.values()) { n.remove(); this.pool.push(n); }
    this.live.clear();
    this.render();
  }

  render() {
    if (!this.count || !this.cw) return;
    const g = this.gap, el = this.el;
    let a, z;
    if (this.h) {
      const s = this.cw + g;
      a = Math.floor(el.scrollLeft / s) - 6; z = Math.ceil((el.scrollLeft + el.clientWidth) / s) + 6;
    } else {
      const s = this.ch + g;
      a = (Math.floor(el.scrollTop / s) - 2) * this.cols;
      z = (Math.ceil((el.scrollTop + el.clientHeight) / s) + 3) * this.cols - 1;
    }
    a = Math.max(0, a); z = Math.min(this.count - 1, z);
    for (const [i, n] of this.live) if (i < a || i > z) { n.remove(); this.pool.push(n); this.live.delete(i); }
    for (let i = a; i <= z; i++) {
      if (this.live.has(i)) continue;
      const n = this.pool.pop() || this.createFn();
      const col = this.h ? i : i % this.cols, row = this.h ? 0 : Math.floor(i / this.cols);
      n.style.width = this.cw + 'px'; n.style.height = this.ch + 'px';
      n.style.transform = `translate(${g + col * (this.cw + g)}px,${g + row * (this.ch + g)}px)`;
      this.sizer.appendChild(n);
      this.live.set(i, n);
      this.updateFn(n, i);
    }
  }

  /** Re-run update() on visible cells (selection / tag / thumbnail changes). */
  refresh() { for (const [i, n] of this.live) this.updateFn(n, i); }

  reveal(i, center) {
    const g = this.gap, el = this.el;
    if (!this.cw) return;
    if (this.h) {
      el.scrollLeft = g + i * (this.cw + g) - (el.clientWidth - this.cw) / 2;
    } else {
      const y = g + Math.floor(i / this.cols) * (this.ch + g), st = el.scrollTop, H = el.clientHeight;
      if (center) el.scrollTop = y - (H - this.ch) / 2;
      else if (y < st) el.scrollTop = y - g;
      else if (y + this.ch > st + H) el.scrollTop = y + this.ch - H + g;
    }
    this.render();
  }
}
window.Virtual = Virtual;
