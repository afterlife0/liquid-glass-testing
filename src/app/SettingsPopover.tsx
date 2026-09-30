import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGlass, useGlassState } from '../glass/GlassContext';
import { GlassPanel } from '../glass/GlassPanel';
import type { AppSettings } from './App';

/**
 * Anchored growth: the popover's near corner is pinned to the button that
 * spawned it and it scales out from there (transform only — never size or
 * blur radius). It is Tier B by design: its backdrop is live DOM (the KPI
 * cards), which a Tier A surface cannot sit over.
 */
export function SettingsPopover({ open, anchor, onClose, settings, setSettings, reducedTransparency }: {
  open: boolean; anchor: RefObject<HTMLElement | null>; onClose: () => void;
  settings: AppSettings; setSettings: (p: Partial<AppSettings>) => void; reducedTransparency: boolean;
}) {
  const glass = useGlass();
  const { capability, fallbackReason, tier } = useGlassState();
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (open) {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 10, right: window.innerWidth - r.right });
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open, onClose, anchor]);

  if (!mounted) return null;
  const Radio = <K extends keyof AppSettings>({ k, v, label, disabled }: { k: K; v: AppSettings[K]; label: string; disabled?: boolean }) => (
    <label className={`seg-opt ${settings[k] === v ? 'on' : ''} ${disabled ? 'disabled' : ''}`}>
      <input type="radio" name={String(k)} checked={settings[k] === v} disabled={disabled}
        onChange={() => setSettings({ [k]: v } as Partial<AppSettings>)} />
      {label}
    </label>
  );

  return (
    <GlassPanel
      frost
      className={`popover ${shown ? 'shown' : ''}`}
      z={25}
      elRef={ref}
      style={{ top: pos.top, right: pos.right }}
      role="dialog"
      aria-label="Appearance settings"
      onTransitionEnd={e => { if (e.propertyName === 'transform' && !open) setMounted(false); }}
    >
      <div className="plate popover-body">
        <h3>Material</h3>
        <div className="seg" role="radiogroup" aria-label="Material">
          <Radio k="material" v="glass" label="Liquid Glass" disabled={reducedTransparency} />
          <Radio k="material" v="frost" label="Frosted" disabled={reducedTransparency} />
          <Radio k="material" v="flat" label="Flat" />
        </div>
        {reducedTransparency && <p className="note">Reduce transparency is on in your OS — using Flat.</p>}
        {!reducedTransparency && fallbackReason && <p className="note">Liquid Glass unavailable: {fallbackReason}. Using Frosted.</p>}

        <h3>Appearance</h3>
        <div className="seg" role="radiogroup" aria-label="Appearance">
          <Radio k="appearance" v="dark" label="Dark" />
          <Radio k="appearance" v="light" label="Light" />
          <Radio k="appearance" v="system" label="System" />
        </div>

        <h3>Motion</h3>
        <label className="row">
          <input type="checkbox" checked={settings.ripples} onChange={e => setSettings({ ripples: e.target.checked })} />
          Touch ripples <small className="muted">(Shift+click = firm tap)</small>
        </label>
        <label className="row slider">
          Refraction
          <input type="range" min={0} max={2} step={0.05} value={settings.refraction} disabled={tier !== 'glass'}
            onChange={e => setSettings({ refraction: +e.target.value })} />
          <output>{settings.refraction.toFixed(2)}</output>
        </label>

        <h3>Diagnostics</h3>
        <label className="row">
          <input type="checkbox" checked={settings.hud} onChange={e => setSettings({ hud: e.target.checked })} />
          Renderer HUD
        </label>
        <button type="button" className="btn-small" disabled={!glass} onClick={() => glass?.simulateContextLoss(1500)}>
          Simulate context loss
        </button>
        <p className="note muted">GPU: {capability.renderer || 'n/a'}</p>
        <a className="btn-small lab-link" href="./lab.html">Open Glass Lab →</a>
      </div>
    </GlassPanel>
  );
}
