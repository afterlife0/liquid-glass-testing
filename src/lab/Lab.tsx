import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlassProvider, useGlass, useGlassState } from '../glass/GlassContext';
import { GlassPanel } from '../glass/GlassPanel';
import { IconPlus } from '../app/icons';
import { drawLab, LabLayout, layoutFor } from './scene';

const ARCHIVE = <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18v4H3z" /><path d="M5 8v12h14V8" /><path d="M10 12h4" /></svg>;
const BOOKMARK = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
const REFRESH = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></svg>;
const DOTS = <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
const PAUSE = <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.2" /><rect x="14" y="4" width="4" height="16" rx="1.2" /></svg>;
const SKIP = (back: boolean) => <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d={back ? 'M4 12a8 8 0 1 0 2.4-5.7' : 'M20 12a8 8 0 1 1-2.4-5.7'} /><path d={back ? 'M4 4v4h4' : 'M20 4v4h-4'} /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">15</text></svg>;

/** A glass element you can drag across the backdrop to judge refraction. */
function Drag({ x, y, w, h, children, className = '', style, pressable = true, radius }: {
  x: number; y: number; w: number; h: number; children?: ReactNode; className?: string; style?: CSSProperties; pressable?: boolean;
  /** Defaults to fully round (circle / capsule), as in the reference controls. */
  radius?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <GlassPanel
      elRef={ref}
      pressable={pressable}
      radius={radius ?? Math.min(w, h) / 2}
      z={2}
      className={`lab-glass ${className}`}
      style={{ left: x, top: y, width: w, height: h, ...style }}
      onPointerDown={e => {
        const el = ref.current!;
        const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;
        const move = (ev: PointerEvent) => { el.style.left = `${ev.clientX - ox}px`; el.style.top = `${ev.clientY - oy}px`; };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }}
    >
      {children}
    </GlassPanel>
  );
}

function useViewport() {
  const [v, setV] = useState({ w: innerWidth, h: innerHeight });
  useEffect(() => {
    const on = () => setV({ w: innerWidth, h: innerHeight });
    addEventListener('resize', on); return () => removeEventListener('resize', on);
  }, []);
  return v;
}

function Scene() {
  const glass = useGlass();
  const { tier, fallbackReason } = useGlassState();
  const { w, h } = useViewport();
  const L: LabLayout = useMemo(() => layoutFor(w, h), [w, h]);
  const art = useRef<HTMLCanvasElement | null>(null);
  const flat = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    art.current ??= document.createElement('canvas');
    drawLab(art.current, w, h, dpr, L);
    if (glass) { glass.setPan(0); glass.setArt(art.current, dpr); }
    else if (flat.current) {
      flat.current.width = art.current.width; flat.current.height = art.current.height;
      flat.current.getContext('2d')!.drawImage(art.current, 0, 0);
    }
  }, [glass, w, h, L]);

  const cx = (r: { x: number; w: number }) => r.x + r.w / 2;
  const cy = (r: { y: number; h: number }) => r.y + r.h / 2;

  return (
    <div className="lab">
      {!glass && <canvas ref={flat} className="backdrop-2d" aria-hidden="true" />}
      <header className="lab-head">
        <strong>Glass Lab</strong>
        <span>Drag any glass element. Tier: {tier === 'glass' ? 'A · Liquid Glass' : `B · ${fallbackReason ?? 'Frosted'}`}</span>
        <a href="./index.html">← Ledgerline</a>
      </header>
      {/* 1 — drop over the colour wheel */}
      <Drag x={cx(L.wheel) - 110} y={cy(L.wheel) - 95} w={84} h={84} />
      {/* 2 — capsule over large text */}
      <Drag x={cx(L.text) - 95} y={L.text.y + 64} w={190} h={72} className="lab-row dark-ink">
        {ARCHIVE}<IconPlus width={30} height={30} />
      </Drag>
      {/* 3 — toolbar straddling the list and the photo */}
      <Drag x={L.list.x + 36} y={L.list.y + L.list.h * 0.62 - 34} w={196} h={60} className="lab-row dark-ink">
        {BOOKMARK}{REFRESH}{DOTS}
      </Drag>
      {/* 4 — playback controls over dark video */}
      <Drag x={cx(L.video) - 58} y={cy(L.video) - 58} w={116} h={116} className="lab-row light-ink">{PAUSE}</Drag>
      <Drag x={cx(L.video) - 200} y={cy(L.video) - 36} w={72} h={72} className="lab-row light-ink">{SKIP(true)}</Drag>
      <Drag x={cx(L.video) + 128} y={cy(L.video) - 36} w={72} h={72} className="lab-row light-ink">{SKIP(false)}</Drag>
      {/* 5 — alert over flowers: glass container, glass secondary, solid destructive */}
      <Drag x={cx(L.alert) - 170} y={L.alert.y + 40} w={340} h={132} pressable={false} radius={26} className="lab-alert">
        <p>This will permanently delete the selected video.</p>
        <div className="lab-alert-actions">
          <GlassPanel as="button" type="button" pressable z={3} radius={22} className="lab-btn">Keep</GlassPanel>
          <button type="button" className="lab-btn lab-destructive">Delete</button>
        </div>
      </Drag>
    </div>
  );
}

export function Lab() {
  const settings = useMemo(() => ({ ripples: true, refraction: 1, reducedMotion: false, shadowAmount: 0.16 }), []);
  return <GlassProvider preferred="glass" settings={settings}><Scene /></GlassProvider>;
}
