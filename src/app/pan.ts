// Backdrop pan: a tiny store shared by the chart slot (input) and the backdrop (output).
type L = (v: number) => void;
let value = 0, max = 0;
const listeners = new Set<L>();
export const panStore = {
  get: () => value,
  setMax(m: number) { max = Math.max(0, m); this.set(value); },
  set(v: number) {
    const nv = Math.min(max, Math.max(0, v));
    if (nv === value) return;
    value = nv; listeners.forEach(l => l(value));
  },
  subscribe(l: L) { listeners.add(l); return () => { listeners.delete(l); }; },
};
