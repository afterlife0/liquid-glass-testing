import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGlass, useGlassState } from '../glass/GlassContext';
import { RendererStats } from '../glass/GlassRenderer';

/**
 * Proof of the sleep contract: when idle the loop stops and the frame
 * counter freezes. Lives outside #root under [data-glass-quiet] so its own
 * DOM updates never wake the renderer.
 */
export function DebugHud() {
  const glass = useGlass();
  const { tier, fallbackReason } = useGlassState();
  const [s, setS] = useState<RendererStats | null>(null);
  const [host] = useState(() => {
    const d = document.createElement('div');
    d.setAttribute('data-glass-quiet', '');
    return d;
  });
  useEffect(() => { document.body.appendChild(host); return () => host.remove(); }, [host]);
  useEffect(() => {
    if (!glass) { setS(null); return; }
    glass.onStats = setS;
    glass.wake();
    return () => { glass.onStats = null; };
  }, [glass]);

  return createPortal(
    <div className="hud" aria-hidden="true">
      <b>Tier</b><span>{tier === 'glass' ? 'A · Liquid Glass' : tier === 'frost' ? 'B · Frosted' : 'Flat'}</span>
      {fallbackReason && <><b>Fallback</b><span>{fallbackReason}</span></>}
      {s && <>
        <b>Loop</b><span className={s.awake ? 'awake' : 'asleep'}>{s.awake ? 'awake' : 'asleep · 0 GPU'}</span>
        <b>Frames</b><span>{s.frames}</span>
        <b>Scene passes</b><span>{s.sceneRenders}</span>
        <b>CPU / frame</b><span>{s.cpuMs.toFixed(2)} ms</span>
        <b>Tier A area</b><span className={s.tierAAreaPct > 25 ? 'warn' : ''}>{s.tierAAreaPct.toFixed(1)}%</span>
        <b>Surfaces</b><span>{s.surfaces}</span>
        <b>Shadow bakes</b><span>{s.shadowBakes}</span>
        <b>DPR</b><span>{s.dpr}</span>
      </>}
    </div>,
    host,
  );
}
