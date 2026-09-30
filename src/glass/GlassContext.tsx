import { createContext, ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { detectGlass, GlassCapability, watchBattery } from './capability';
import { GlassRenderer, RendererSettings } from './GlassRenderer';

/** 'glass' = Tier A where possible, 'frost' = Tier B only, 'flat' = opaque, no material. */
export type Tier = 'glass' | 'frost' | 'flat';

interface GlassState {
  renderer: GlassRenderer | null;
  tier: Tier;
  capability: GlassCapability;
  fallbackReason: string | null;
}

const Ctx = createContext<GlassState>({
  renderer: null, tier: 'frost', capability: { ok: false, reason: 'no provider', renderer: '' }, fallbackReason: null,
});
const LayerCtx = createContext(false);

export function GlassProvider({ preferred, settings, batterySaver = true, children }: {
  preferred: Tier; settings: Partial<RendererSettings>;
  /** Drop to Tier B below 25% battery when not charging (the brief's default). */
  batterySaver?: boolean;
  children: ReactNode;
}) {
  const capability = useMemo(detectGlass, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<GlassRenderer | null>(null);
  const [contextOk, setContextOk] = useState(true);
  const [lowBattery, setLowBattery] = useState(false);
  const want = preferred === 'glass' && capability.ok;

  useLayoutEffect(() => {
    if (!want || !canvasRef.current) return;
    let r: GlassRenderer;
    try { r = new GlassRenderer(canvasRef.current); } catch (e) { console.warn('[glass] init failed', e); return; }
    r.onContextChange = ok => setContextOk(ok);
    setRenderer(r); setContextOk(true);
    // ?debug exposes the renderer for diagnostics (print values before rewriting code — bug #5)
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __glass: GlassRenderer }).__glass = r;
    return () => { r.destroy(); setRenderer(null); };
  }, [want]);

  useEffect(() => { renderer?.updateSettings(settings); }, [renderer, settings]);
  useEffect(() => {
    if (!batterySaver) { setLowBattery(false); return; }
    return watchBattery(setLowBattery);
  }, [batterySaver]);

  // useGlass() returning null turns every Tier A panel into a Tier B one.
  const live = want && contextOk && !lowBattery ? renderer : null;
  const fallbackReason = preferred !== 'glass' ? null
    : !capability.ok ? capability.reason
    : !contextOk ? 'WebGL context lost — recovering'
    : lowBattery ? 'battery below 25%' : null;
  const tier: Tier = live ? 'glass' : preferred === 'flat' ? 'flat' : 'frost';
  const value = useMemo(() => ({ renderer: live, tier, capability, fallbackReason }), [live, tier, capability, fallbackReason]);

  return (
    <Ctx.Provider value={value}>
      {want && (
        <canvas
          ref={canvasRef}
          className="glass-canvas"
          aria-hidden="true"
          style={{ visibility: live ? 'visible' : 'hidden' }}
        />
      )}
      {children}
    </Ctx.Provider>
  );
}

/** The single switch: a renderer, or null → Tier B. */
export function useGlass(): GlassRenderer | null { return useContext(Ctx).renderer; }
export function useGlassState() { return useContext(Ctx); }

/** Panels inside an inactive layer stop drawing glass (e.g. the page behind a modal). */
export function GlassLayer({ inactive, children }: { inactive: boolean; children: ReactNode }) {
  return <LayerCtx.Provider value={inactive}>{children}</LayerCtx.Provider>;
}
export function useLayerInactive() { return useContext(LayerCtx); }
