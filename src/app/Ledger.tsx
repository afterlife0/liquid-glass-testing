import { useMemo, useState } from 'react';
import { LEDGER, fmt } from './data';

/**
 * Tier B container, flat table. Figures a person scans or compares sit on an
 * opaque surface — glass behind a total is an unforced error. Frost the
 * container once; never a row per table row.
 */
export function Ledger() {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? LEDGER.filter(r => `${r.voucher} ${r.account} ${r.party}`.toLowerCase().includes(s)) : LEDGER;
  }, [q]);
  const dr = rows.reduce((a, r) => a + r.debit, 0);
  const cr = rows.reduce((a, r) => a + r.credit, 0);

  return (
    <section className="ledger surface-b" aria-label="General ledger">
      <header className="ledger-head">
        <div>
          <h2>General ledger</h2>
          <span className="muted">September 2026 · {rows.length} vouchers</span>
        </div>
        <input className="field" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter ledger" />
      </header>
      <div className="ledger-scroll" tabIndex={0} aria-label="Ledger rows, scrollable">
        <table className="ledger-table">
          <thead>
            <tr>
              <th scope="col">Date</th><th scope="col">Voucher</th><th scope="col">Account</th><th scope="col">Party</th>
              <th scope="col" className="num">GST</th><th scope="col" className="num">Debit ₹</th>
              <th scope="col" className="num">Credit ₹</th><th scope="col" className="num">Balance ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td className="mono">{r.voucher}</td>
                <td>{r.account}</td>
                <td>{r.party}</td>
                <td className="num">{r.gst ? `${r.gst}%` : '—'}</td>
                <td className="num">{fmt(r.debit)}</td>
                <td className="num">{fmt(r.credit)}</td>
                <td className="num strong">{fmt(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={5}>Total</th>
              <td className="num">{fmt(dr)}</td>
              <td className="num">{fmt(cr)}</td>
              <td className="num" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
