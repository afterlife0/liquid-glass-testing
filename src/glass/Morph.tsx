// §6 transitions on custom surfaces: melt-through-a-blob (dissimilar shapes,
// anchored growth) and split/merge (one mechanism, run backwards to merge).
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGlass, useGlassState, useLayerInactive } from './GlassContext';
import { Surface } from './GlassRenderer';
import { Tween } from './springs';
import { easeInOut, incomingOpacity, lerpShape, meltOf, outgoingOpacity, shapeFromRect } from './geometry';

const MELT_MS = 620;
const SPLIT_MS = 560;

function useReducedMotion() {
  const [rm, setRm] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setRm(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return rm;
}

/**
 * Staged content opacity for a two-state morph. `p` runs 0 → 1 to open.
 * Opening: A (closed content) is outgoing, B (open content) incoming — and the
 * reverse when closing. Several incoming labels arrive sequentially, 4% apart.
 */
function stage(p: number, opening: boolean, index: number) {
  const q = opening ? p : 1 - p;
  return opening
    ? { a: outgoingOpacity(q), b: incomingOpacity(q, index) }
    : { a: incomingOpacity(q, index), b: outgoingOpacity(q) };
}

function useMorphSurface(z: number) {
  const glass = useGlass();
  const inactive = useLayerInactive();
  const surface = useRef<Surface | null>(null);
  useLayoutEffect(() => {
    if (!glass) return;
    const s = glass.createSurface({ pressable: true, ripples: false, z });
    surface.current = s;
    return () => { glass.removeSurface(s); surface.current = null; };
  }, [glass, z]);
  useEffect(() => { if (surface.current) { surface.current.enabled = !inactive; glass?.wake(); } }, [glass, inactive]);
  return { glass, surface };
}

export interface MenuItem { key: string; label: string; icon: ReactNode; onSelect: () => void }

/**
 * A FAB that melts into a menu. The menu grows out of the button that spawned
 * it: its near corner stays pinned to the button's corner and it expands away.
 */
export function MeltMenu({ open, onOpenChange, icon, label, items, menuWidth = 248, z = 20 }: {
  open: boolean; onOpenChange: (o: boolean) => void; icon: ReactNode; label: string;
  items: MenuItem[]; menuWidth?: number; z?: number;
}) {
  const { glass, surface } = useMorphSurface(z);
  const { tier } = useGlassState();
  const reduced = useReducedMotion();
  const fabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const tween = useRef(new Tween(open ? 1 : 0));
  const opening = useRef(open);
  const [settled, setSettled] = useState(open);

  const apply = (p: number) => {
    const fab = iconRef.current, menu = menuRef.current;
    if (!fab || !menu) return;
    const stagedTop = stage(p, opening.current, 0);
    fab.style.opacity = String(stagedTop.a);
    fab.style.filter = `blur(${(1 - stagedTop.a) * 4}px)`;
    itemRefs.current.forEach((el, i) => {
      if (!el) return;
      const o = stage(p, opening.current, i).b;
      el.style.opacity = String(o);
      el.style.transform = `translateY(${(1 - o) * 6}px)`;
    });
    menu.style.visibility = p > 0 ? 'visible' : 'hidden';
  };

  useLayoutEffect(() => {
    const s = surface.current;
    if (!s) return;
    s.el = menuRef.current?.parentElement ?? null;
    s.custom = () => {
      const fab = fabRef.current, menu = menuRef.current;
      if (!fab || !menu) return null;
      const p = tween.current.p;
      const a = shapeFromRect(fab.getBoundingClientRect());
      const b = shapeFromRect(menu.getBoundingClientRect());
      const shape = lerpShape(a, b, easeInOut(p));
      return { shapes: [shape], melt: meltOf(p), shadow: 1 };
    };
    glass?.wake();
  }, [glass, surface]);

  useEffect(() => {
    const t = tween.current;
    opening.current = open;
    setSettled(false);
    if (!glass || reduced) {
      t.p = open ? 1 : 0; t.go(open ? 1 : 0, performance.now(), 0);
      apply(t.p); setSettled(open); glass?.wake();
      return;
    }
    t.go(open ? 1 : 0, performance.now(), MELT_MS);
    return glass.animate(now => {
      t.step(now);
      apply(t.p);
      if (!t.moving()) setSettled(open);
      return t.moving();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, glass, reduced]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    const onDown = (e: PointerEvent) => {
      const root = menuRef.current?.parentElement;
      if (root && !root.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open, onOpenChange]);

  useEffect(() => { if (settled && open) itemRefs.current[0]?.focus(); }, [settled, open]);

  const down = (e: React.PointerEvent) => { if (glass && surface.current) glass.pointerDown(surface.current, e.nativeEvent); };
  const glassTier = tier === 'glass';

  return (
    <div className={`melt-root ${open ? 'is-open' : ''}`} data-glass-driven="">
      <button
        ref={fabRef}
        type="button"
        className={`fab glass tier-${tier} ${glassTier ? '' : 'fab-fallback'}`}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onPointerDown={down}
        onClick={() => onOpenChange(!open)}
        style={{ pointerEvents: open ? 'none' : undefined }}
      >
        <span ref={iconRef} className="fab-icon">{icon}</span>
      </button>
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        className={`melt-menu ${glassTier ? '' : `glass tier-${tier} melt-fallback`}`}
        style={{ width: menuWidth, pointerEvents: open ? undefined : 'none', visibility: open ? 'visible' : 'hidden' }}
        onPointerDown={down}
      >
        {items.map((it, i) => (
          <button
            key={it.key}
            ref={el => { itemRefs.current[i] = el; }}
            role="menuitem"
            type="button"
            className="menu-item"
            tabIndex={open ? 0 : -1}
            onClick={() => { it.onSelect(); onOpenChange(false); }}
            style={glassTier ? undefined : { opacity: 1 }}
          >
            <span className="menu-icon" aria-hidden="true">{it.icon}</span>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface SplitAction { key: string; label: string; icon: ReactNode; onSelect: () => void }

/**
 * A capsule that splits into separate circular controls. Centres interpolate
 * from overlapping to separated while uK peaks mid-transition, so the shapes
 * neck apart on a thin filament instead of popping. Closing runs it backwards
 * — that is the merge.
 */
export function SplitControl({ label, icon, actions, z = 15 }: {
  label: string; icon: ReactNode; actions: SplitAction[]; z?: number;
}) {
  const { glass, surface } = useMorphSurface(z);
  const { tier } = useGlassState();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLButtonElement>(null);
  const slotRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tween = useRef(new Tween(0));
  const opening = useRef(false);

  const apply = (p: number) => {
    const cap = capRef.current;
    if (!cap) return;
    cap.style.opacity = String(stage(p, opening.current, 0).a);
    slotRefs.current.forEach((el, i) => { if (el) el.style.opacity = String(stage(p, opening.current, i).b); });
  };

  useLayoutEffect(() => {
    const s = surface.current;
    if (!s) return;
    s.el = rootRef.current;
    s.custom = () => {
      const root = rootRef.current;
      if (!root) return null;
      const p = tween.current.p, e = easeInOut(p);
      const cap = shapeFromRect(capRef.current!.getBoundingClientRect());
      const shapes = slotRefs.current.map(el => lerpShape(cap, shapeFromRect(el!.getBoundingClientRect()), e));
      // uK peaks while the shapes pull apart (they fully overlap until ~60%),
      // so they neck on a thin filament instead of popping. ~0 at both ends.
      const bump = Math.exp(-(((p - 0.74) / 0.15) ** 2));
      return { shapes, k: Math.max(0.5, 16 * bump - 0.6) };
    };
    glass?.wake();
  }, [glass, surface]);

  useEffect(() => {
    const t = tween.current;
    opening.current = open;
    if (!glass || reduced) { t.p = open ? 1 : 0; t.go(t.p, performance.now(), 0); apply(t.p); glass?.wake(); return; }
    t.go(open ? 1 : 0, performance.now(), SPLIT_MS);
    return glass.animate(now => { t.step(now); apply(t.p); return t.moving(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, glass, reduced]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  const down = (e: React.PointerEvent) => { if (glass && surface.current) glass.pointerDown(surface.current, e.nativeEvent); };
  const glassTier = tier === 'glass';

  return (
    <div ref={rootRef} className={`split-root ${open ? 'is-open' : ''}`} data-glass-driven="" onPointerDown={down}>
      <button
        ref={capRef}
        type="button"
        className={`split-cap ${glassTier ? '' : `glass tier-${tier}`}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        tabIndex={open ? -1 : 0}
        style={{ pointerEvents: open ? 'none' : undefined, ...(glassTier ? {} : { opacity: open ? 0 : 1 }) }}
      >
        <span aria-hidden="true">{icon}</span>{label}
      </button>
      {actions.map((a, i) => (
        <button
          key={a.key}
          ref={el => { slotRefs.current[i] = el; }}
          type="button"
          className={`split-slot ${glassTier ? '' : `glass tier-${tier}`}`}
          style={{ left: i * 50, pointerEvents: open ? undefined : 'none', ...(glassTier ? {} : { opacity: open ? 1 : 0 }) }}
          aria-label={a.label}
          title={a.label}
          tabIndex={open ? 0 : -1}
          onClick={() => { a.onSelect(); setOpen(false); }}
        >
          <span aria-hidden="true">{a.icon}</span>
        </button>
      ))}
    </div>
  );
}
