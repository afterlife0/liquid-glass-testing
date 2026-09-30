import { CSSProperties, ElementType, HTMLAttributes, ReactNode, Ref, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGlass, useGlassState, useLayerInactive } from './GlassContext';
import { Surface, SurfaceOptions } from './GlassRenderer';
import { concentricRadius } from './geometry';

export type GlassPanelProps = SurfaceOptions & Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  as?: ElementType;
  children?: ReactNode;
  elRef?: Ref<HTMLElement>;
  [attr: `data-${string}`]: string | undefined;
  type?: string;
  disabled?: boolean;
  /** Force Tier B. Use when the surface's backdrop is live DOM (e.g. a popover over cards):
   *  canvas glass is drawn beneath all DOM, so DOM under it would paint over the glass. */
  frost?: boolean;
};

/**
 * Registers a rect with the one canvas and renders its children as ordinary
 * DOM above it. The canvas provides the material; the DOM provides the
 * information — text is never rasterised into the texture.
 */
export function GlassPanel({
  as: Tag = 'div', frost = false, radius, pressable, ripples, shadow, z, className = '', style, children, elRef, onPointerDown, ...rest
}: GlassPanelProps) {
  const ctxGlass = useGlass();
  const glass = frost ? null : ctxGlass;
  const { tier: ctxTier } = useGlassState();
  const tier = frost && ctxTier === 'glass' ? 'frost' : ctxTier;
  const inactive = useLayerInactive();
  const ref = useRef<HTMLElement | null>(null);
  const surface = useRef<Surface | null>(null);
  const [autoRadius, setAutoRadius] = useState<number | undefined>(undefined);

  // DOM radius follows the same size rule the shader uses.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height ignore transforms — the radius belongs to the layout size.
    const ro = new ResizeObserver(() => setAutoRadius(concentricRadius(el.offsetWidth / 2, el.offsetHeight / 2)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!glass || !ref.current) return;
    const s = glass.createSurface({ radius, pressable, ripples, shadow, z });
    s.el = ref.current;
    surface.current = s;
    return () => { glass.removeSurface(s); surface.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glass]);

  useEffect(() => {
    const s = surface.current;
    if (!s || !glass) return;
    s.opts = { radius, pressable, ripples, shadow, z };
    s.enabled = !inactive;
    glass.wake();
  }, [glass, radius, pressable, ripples, shadow, z, inactive]);

  const r = radius ?? autoRadius;
  const css: CSSProperties = { ...style, borderRadius: r };
  const setRef = (el: HTMLElement | null) => {
    ref.current = el;
    if (typeof elRef === 'function') elRef(el);
    else if (elRef) (elRef as { current: HTMLElement | null }).current = el;
  };

  return (
    <Tag
      ref={setRef}
      className={`glass tier-${tier} ${className}`}
      style={css}
      data-glass-driven=""
      onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
        if (glass && surface.current && !inactive) glass.pointerDown(surface.current, e.nativeEvent);
        onPointerDown?.(e);
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
