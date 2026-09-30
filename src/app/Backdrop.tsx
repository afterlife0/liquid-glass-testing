import { useEffect, useRef } from 'react';
import { useGlass, useGlassState } from '../glass/GlassContext';
import { ART_WIDTH_FACTOR, artScale, ArtLayout, drawArt } from './art';
import { panStore } from './pan';
import { Scheme, THEMES } from './tokens';

function measure(): ArtLayout {
  const slot = document.querySelector<HTMLElement>('[data-chart-slot]');
  const kpis = document.querySelector<HTMLElement>('[data-kpi-row]');
  const w = window.innerWidth, h = window.innerHeight;
  const s = slot?.getBoundingClientRect();
  const k = kpis?.getBoundingClientRect();
  return {
    width: w, height: h,
    chartLeft: s ? s.left : 0,
    chartTop: k ? k.top + 8 : h * 0.2,
    chartBottom: s ? s.bottom : h * 0.6,
  };
}

/**
 * Owns the backdrop art. Tier A: uploaded to the glass renderer once per
 * layout/theme change (never per frame); pan only re-runs the composite.
 * Tier B: blitted to a plain 2D canvas that the CSS frost blurs.
 * Flat: the same chart on a solid ground.
 */
export function Backdrop({ scheme }: { scheme: Scheme }) {
  const glass = useGlass();
  const { tier } = useGlassState();
  const canvas2d = useRef<HTMLCanvasElement>(null);
  const art = useRef<HTMLCanvasElement | null>(null);
  const scale = useRef(1);

  useEffect(() => {
    art.current ??= document.createElement('canvas');
    let raf = 0;

    const blit2d = () => {
      const cv = canvas2d.current, src = art.current;
      if (!cv || !src) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
      if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
      const s = scale.current;
      cv.getContext('2d')!.drawImage(src, panStore.get() * s, 0, w * s, h * s, 0, 0, cv.width, cv.height);
    };

    const redraw = () => {
      const L = measure();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      scale.current = artScale(L, dpr, glass ? glass.maxTextureSize : 8192);
      drawArt(art.current!, L, scale.current, THEMES[scheme], tier === 'flat');
      panStore.setMax(L.width * (ART_WIDTH_FACTOR - 1));
      if (glass) glass.setArt(art.current!, scale.current);
      else blit2d();
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); };

    redraw();
    if (glass) glass.setPan(panStore.get());
    const unsub = panStore.subscribe(v => {
      if (glass) glass.setPan(v);
      else { cancelAnimationFrame(raf); raf = requestAnimationFrame(blit2d); }
    });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    const slot = document.querySelector('[data-chart-slot]');
    if (slot) ro.observe(slot);
    return () => { unsub(); window.removeEventListener('resize', schedule); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [glass, tier, scheme]);

  if (glass) return null;
  return <canvas ref={canvas2d} className="backdrop-2d" aria-hidden="true" />;
}
