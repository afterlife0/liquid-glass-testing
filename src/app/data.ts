// Deterministic demo data. Figures in paise-free rupees.

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

export interface MonthPoint { label: string; revenue: number; expense: number }

export const SERIES: MonthPoint[] = (() => {
  const r = rng(7);
  return Array.from({ length: 24 }, (_, i) => {
    const season = Math.sin((i / 12) * Math.PI * 2 - 0.6);
    const revenue = 3_600_000 + i * 55_000 + season * 620_000 + (r() - 0.5) * 380_000;
    const expense = revenue * (0.62 + (r() - 0.5) * 0.12);
    const fy = i < 12 ? '24' : '25';
    return { label: `${MONTHS[i % 12]} ’${i % 12 >= 9 ? String(+fy + 1) : fy}`, revenue, expense };
  });
})();

export interface LedgerRow {
  id: string; date: string; voucher: string; account: string; party: string;
  debit: number; credit: number; balance: number; gst: number;
}

const ACCOUNTS = ['Sales — Domestic', 'Purchases', 'Rent', 'Professional fees', 'Bank charges', 'Sales — Export', 'Salaries', 'Office supplies', 'Freight inward', 'Software subscriptions'];
const PARTIES = ['Aarav Textiles Pvt Ltd', 'Meridian Logistics', 'Sunrise Traders', 'Kavya & Co. LLP', 'Northwind Exports', 'Blue Lotus Hospitality', 'Vertex Components', 'Harbor Pharma', 'Ganga Agro Foods', 'Orbit Systems'];

export const LEDGER: LedgerRow[] = (() => {
  const r = rng(42);
  let bal = 1_842_500;
  return Array.from({ length: 48 }, (_, i) => {
    const acc = ACCOUNTS[Math.floor(r() * ACCOUNTS.length)];
    const isSale = acc.startsWith('Sales');
    const amt = Math.round((isSale ? 40_000 + r() * 460_000 : 4_000 + r() * 180_000) / 10) * 10;
    const debit = isSale ? amt : 0, credit = isSale ? 0 : amt;
    bal += debit - credit;
    const day = 30 - Math.floor(i * 0.6);
    return {
      id: `r${i}`,
      date: `${String(Math.max(1, day)).padStart(2, '0')} Sep 2026`,
      voucher: `${isSale ? 'SI' : 'PV'}/26-27/${String(1480 - i).padStart(4, '0')}`,
      account: acc,
      party: PARTIES[Math.floor(r() * PARTIES.length)],
      debit, credit, balance: bal,
      gst: acc === 'Sales — Export' || acc === 'Salaries' || acc === 'Bank charges' ? 0 : 18,
    };
  });
})();

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const fmt = (n: number) => (n === 0 ? '—' : inr.format(Math.round(n)));
export const fmtINR = (n: number) => `₹${inr.format(Math.round(n))}`;
export const fmtLakh = (n: number) => `₹${(n / 100_000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;
