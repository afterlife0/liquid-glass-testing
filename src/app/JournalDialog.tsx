import { useEffect, useRef, useState } from 'react';
import { GlassPanel } from '../glass/GlassPanel';
import { fmt } from './data';
import { IconX } from './icons';

const ACCOUNTS = ['Rent', 'Professional fees', 'HDFC Bank — Current', 'Input CGST', 'Input SGST', 'Sundry creditors'];

interface Line { account: string; debit: string; credit: string }

/**
 * Tier A dialog. The page behind fades and its glass stops drawing: glass is
 * drawn beneath all DOM, so page content must not sit over the dialog's glass.
 * Nesting: a glass Cancel control inside the glass dialog (one level) is fine;
 * the primary action is a solid fill; the lines and totals sit on a flat surface.
 */
export function JournalDialog({ onClose, onPost }: { onClose: () => void; onPost: (msg: string) => void }) {
  const [lines, setLines] = useState<Line[]>([
    { account: 'Rent', debit: '85000', credit: '' },
    { account: 'Input CGST', debit: '7650', credit: '' },
    { account: 'Input SGST', debit: '7650', credit: '' },
    { account: 'HDFC Bank — Current', debit: '', credit: '100300' },
  ]);
  const first = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && dialog.current) {
        const f = dialog.current.querySelectorAll<HTMLElement>('input, select, button:not([disabled])');
        const a = f[0], b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);

  const num = (s: string) => (Number.isFinite(+s) ? +s : 0);
  const dr = lines.reduce((a, l) => a + num(l.debit), 0);
  const cr = lines.reduce((a, l) => a + num(l.credit), 0);
  const diff = dr - cr;
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="dialog-layer">
      <GlassPanel as="section" className="dialog" z={30} role="dialog" aria-modal="true" aria-labelledby="jv-title" elRef={dialog}>
        <header className="dialog-head">
          <div>
            <h2 id="jv-title">Journal entry</h2>
            <span className="muted">JV/26-27/0318 · 30 Sep 2026</span>
          </div>
          <GlassPanel as="button" type="button" className="icon-btn small" pressable z={31} aria-label="Close" onClick={onClose}>
            <IconX width={18} height={18} />
          </GlassPanel>
        </header>
        <label className="narration">
          <span>Narration</span>
          <input ref={first} className="field" defaultValue="Office rent for September incl. GST @18%" />
        </label>
        <div className="jv-lines">
          <table>
            <thead><tr><th scope="col">Account</th><th scope="col" className="num">Debit ₹</th><th scope="col" className="num">Credit ₹</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="field" value={l.account} onChange={e => set(i, { account: e.target.value })} aria-label={`Line ${i + 1} account`}>
                      {ACCOUNTS.map(a => <option key={a}>{a}</option>)}
                    </select>
                  </td>
                  <td><input className="field num" inputMode="decimal" value={l.debit} onChange={e => set(i, { debit: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Line ${i + 1} debit`} /></td>
                  <td><input className="field num" inputMode="decimal" value={l.credit} onChange={e => set(i, { credit: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Line ${i + 1} credit`} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">Total</th><td className="num">{fmt(dr)}</td><td className="num">{fmt(cr)}</td></tr>
            </tfoot>
          </table>
          <p className={`balance ${diff === 0 ? 'ok' : 'bad'}`} role="status">
            {diff === 0 ? 'Balanced — debits equal credits' : `Out of balance by ₹${fmt(Math.abs(diff))}`}
          </p>
        </div>
        <footer className="dialog-foot">
          <GlassPanel as="button" type="button" className="btn-glass" pressable z={31} onClick={onClose}>Cancel</GlassPanel>
          <button type="button" className="btn-primary" disabled={diff !== 0}
            onClick={() => onPost(`Posted JV/26-27/0318 · ₹${fmt(dr)}`)}>Post entry</button>
        </footer>
      </GlassPanel>
    </div>
  );
}
