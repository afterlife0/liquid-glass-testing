import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlassLayer, GlassProvider, Tier, useGlass, useGlassState } from '../glass/GlassContext';
import { GlassPanel } from '../glass/GlassPanel';
import { MeltMenu, SplitControl } from '../glass/Morph';
import { Backdrop } from './Backdrop';
import { DebugHud } from './DebugHud';
import { JournalDialog } from './JournalDialog';
import { Ledger } from './Ledger';
import { SettingsPopover } from './SettingsPopover';
import { SERIES, fmtINR, fmtLakh } from './data';
import { panStore } from './pan';
import { applyTheme, Scheme } from './tokens';
import {
  IconBank, IconBell, IconCsv, IconDown, IconExport, IconGst, IconHome, IconInvoice, IconJournal, IconLedger,
  IconMove, IconPayment, IconPdf, IconPlus, IconPrint, IconReceipt, IconReport, IconSearch, IconSettings, IconUp, IconUsers,
} from './icons';

export interface AppSettings {
  material: Tier;
  appearance: 'system' | Scheme;
  ripples: boolean;
  refraction: number;
  hud: boolean;
}

const DEFAULTS: AppSettings = {
  material: 'glass', appearance: 'dark', ripples: true, refraction: 1,
  hud: typeof window !== 'undefined' && window.innerWidth > 900, // the HUD would cover the ledger on a phone
};
const KEY = 'ledgerline.settings.v1';

function loadSettings(): AppSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
}

function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function App() {
  const [settings, setSettingsState] = useState(loadSettings);
  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState(s => {
      const next = { ...s, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: settings are session-only */ }
      return next;
    });
  }, []);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const reducedTransparency = useMedia('(prefers-reduced-transparency: reduce)');
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const scheme: Scheme = settings.appearance === 'system' ? (systemDark ? 'dark' : 'light') : settings.appearance;
  useLayoutEffect(() => applyTheme(scheme), [scheme]);

  // Reduced transparency means no translucency at all — the flat theme.
  const material: Tier = reducedTransparency ? 'flat' : settings.material;
  const rendererSettings = useMemo(
    () => ({ ripples: settings.ripples, refraction: settings.refraction, reducedMotion, shadowAmount: scheme === 'dark' ? 0.30 : 0.18 }),
    [settings.ripples, settings.refraction, reducedMotion, scheme],
  );

  return (
    <GlassProvider preferred={material} settings={rendererSettings}>
      <Shell scheme={scheme} settings={settings} setSettings={setSettings} reducedTransparency={reducedTransparency} />
    </GlassProvider>
  );
}

function Shell({ scheme, settings, setSettings, reducedTransparency }: {
  scheme: Scheme; settings: AppSettings; setSettings: (p: Partial<AppSettings>) => void; reducedTransparency: boolean;
}) {
  const glass = useGlass();
  const { tier } = useGlassState();
  const [dialog, setDialog] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const settingsBtn = useRef<HTMLElement>(null);

  useEffect(() => { glass?.setDim(dialog ? 0.42 : 0); }, [glass, dialog]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((m: string) => setToast(m), []);

  return (
    <div className="app" data-tier={tier}>
      <Backdrop scheme={scheme} />
      <GlassLayer inactive={dialog}>
        <div className={`page ${dialog ? 'is-behind' : ''}`} aria-hidden={dialog || undefined} inert={dialog || undefined}>
          <Sidebar />
          <main className="main">
            <Toolbar
              settingsRef={settingsBtn}
              onSettings={() => setSettingsOpen(o => !o)}
              settingsOpen={settingsOpen}
              onNew={() => setDialog(true)}
              notify={notify}
            />
            <Kpis />
            <section className="chart-slot" data-chart-slot aria-label="Revenue and expenses, 24 months">
              <ChartPan />
              <div className="legend plate">
                <strong>Cash flow</strong>
                <span><i className="swatch rev" />Revenue</span>
                <span><i className="swatch exp" />Expenses</span>
                <span className="muted pan-hint"><IconMove width={14} height={14} /> drag to pan</span>
              </div>
              <div className="split-anchor">
                <SplitControl
                  label="Export"
                  icon={<IconExport width={16} height={16} />}
                  actions={[
                    { key: 'pdf', label: 'Export PDF', icon: <IconPdf />, onSelect: () => notify('Exported cash-flow report as PDF') },
                    { key: 'csv', label: 'Export CSV', icon: <IconCsv />, onSelect: () => notify('Exported 24 rows as CSV') },
                    { key: 'print', label: 'Print', icon: <IconPrint />, onSelect: () => notify('Sent to printer') },
                  ]}
                />
              </div>
              <div className="fab-anchor">
                <MeltMenu
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  label="Create"
                  icon={<IconPlus width={24} height={24} />}
                  items={[
                    { key: 'inv', label: 'New invoice', icon: <IconInvoice />, onSelect: () => notify('Draft invoice SI/26-27/1481 created') },
                    { key: 'jv', label: 'Journal entry', icon: <IconJournal />, onSelect: () => setDialog(true) },
                    { key: 'pay', label: 'Record payment', icon: <IconPayment />, onSelect: () => notify('Payment voucher opened') },
                    { key: 'rcpt', label: 'Receipt', icon: <IconReceipt />, onSelect: () => notify('Receipt voucher opened') },
                  ]}
                />
              </div>
            </section>
            <Ledger />
          </main>
        </div>
      </GlassLayer>

      {dialog && <JournalDialog onClose={() => setDialog(false)} onPost={m => { setDialog(false); notify(m); }} />}
      <SettingsPopover
        open={settingsOpen}
        anchor={settingsBtn}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        reducedTransparency={reducedTransparency}
      />
      <div className="toast-host" role="status" aria-live="polite">
        {toast && <div className="toast surface-b">{toast}</div>}
      </div>
      {settings.hud && <DebugHud />}
    </div>
  );
}

function Sidebar() {
  const nav = [
    { icon: <IconHome />, label: 'Dashboard', active: true },
    { icon: <IconLedger />, label: 'Ledgers' },
    { icon: <IconInvoice />, label: 'Invoices' },
    { icon: <IconBank />, label: 'Banking' },
    { icon: <IconGst />, label: 'GST filing' },
    { icon: <IconReport />, label: 'Reports' },
    { icon: <IconUsers />, label: 'Parties' },
  ];
  return (
    <aside className="sidebar surface-b" aria-label="Primary">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">₹</span>
        <div><strong>Ledgerline</strong><small>Kavya &amp; Co. LLP · FY 26–27</small></div>
      </div>
      <nav>
        {nav.map(n => (
          <a key={n.label} href="#" className={`nav-row ${n.active ? 'active' : ''}`} aria-current={n.active ? 'page' : undefined}
            onClick={e => e.preventDefault()}>
            {n.icon}<span>{n.label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="gst-due">
          <small>GSTR-3B due</small>
          <strong>20 Oct</strong>
          <span className="muted">Tax payable {fmtINR(412_380)}</span>
        </div>
      </div>
    </aside>
  );
}

function Toolbar({ settingsRef, onSettings, settingsOpen, onNew, notify }: {
  settingsRef: React.RefObject<HTMLElement | null>; onSettings: () => void; settingsOpen: boolean; onNew: () => void; notify: (m: string) => void;
}) {
  return (
    <GlassPanel className="toolbar" z={1} ripples>
      <div className="title">
        <h1>Dashboard</h1>
        <span className="muted">Updated 09:37</span>
      </div>
      <label className="search">
        <IconSearch width={16} height={16} />
        <input placeholder="Search vouchers, parties, GSTIN…" aria-label="Search" />
        <kbd>Ctrl K</kbd>
      </label>
      <div className="toolbar-actions">
        <GlassPanel as="button" type="button" className="icon-btn" pressable z={2} aria-label="Notifications"
          onClick={() => notify('3 invoices overdue · 1 GST notice')}>
          <IconBell />
        </GlassPanel>
        <GlassPanel as="button" type="button" className="icon-btn" pressable z={2} aria-label="Settings"
          aria-expanded={settingsOpen} elRef={settingsRef} onClick={onSettings}>
          <IconSettings />
        </GlassPanel>
        <button type="button" className="btn-primary" onClick={onNew} aria-label="Post entry">
          <IconPlus width={18} height={18} /> <span className="label">Post entry</span>
        </button>
      </div>
    </GlassPanel>
  );
}

function Kpis() {
  const last = SERIES[SERIES.length - 1], prev = SERIES[SERIES.length - 2];
  const cards = [
    { label: 'Revenue · Sep', value: fmtLakh(last.revenue), delta: (last.revenue / prev.revenue - 1) * 100, good: true },
    { label: 'Receivables', value: fmtLakh(2_184_600), delta: -4.2, good: true, note: '12 invoices open' },
    { label: 'GST payable', value: fmtINR(412_380), delta: 6.1, good: false, note: 'GSTR-3B · 20 Oct' },
    { label: 'Cash & bank', value: fmtLakh(6_842_150), delta: 2.4, good: true, note: '3 accounts' },
  ];
  return (
    <section className="kpis" data-kpi-row aria-label="Key figures">
      {cards.map(c => {
        const up = c.delta >= 0;
        const favourable = up === c.good;
        return (
          <GlassPanel key={c.label} className="kpi" z={1}>
            <span className="kpi-label">{c.label}</span>
            <span className="kpi-figure plate">{c.value}</span>
            <span className={`kpi-delta plate ${favourable ? 'pos' : 'neg'}`}>
              {up ? <IconUp width={14} height={14} /> : <IconDown width={14} height={14} />}
              {Math.abs(c.delta).toFixed(1)}%
              {c.note && <em>{c.note}</em>}
            </span>
          </GlassPanel>
        );
      })}
    </section>
  );
}

/** Drag / wheel on the empty chart area pans the backdrop — content moving behind glass. */
function ChartPan() {
  const drag = useRef<{ x: number; pan: number } | null>(null);
  return (
    <div
      className="chart-pan"
      onPointerDown={e => { drag.current = { x: e.clientX, pan: panStore.get() }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current) panStore.set(drag.current.pan - (e.clientX - drag.current.x)); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onWheel={e => panStore.set(panStore.get() + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY))}
    />
  );
}
