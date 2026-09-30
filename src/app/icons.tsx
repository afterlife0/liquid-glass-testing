// Inline stroke icons (24px grid, currentColor).
import { SVGProps } from 'react';

const I = (d: string | string[]) => (p: SVGProps<SVGSVGElement>) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {(Array.isArray(d) ? d : [d]).map((x, i) => <path key={i} d={x} />)}
  </svg>
);

export const IconPlus = I('M12 5v14M5 12h14');
export const IconBell = I(['M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0']);
export const IconSettings = I(['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z']);
export const IconSearch = I(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35']);
export const IconInvoice = I(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8M8 17h5']);
export const IconJournal = I(['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z', 'M9 7h7M9 11h5']);
export const IconPayment = I(['M2 7h20v12H2z', 'M2 11h20', 'M6 15h4']);
export const IconReceipt = I(['M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2l-2 2-3-2-3 2-3-2-3 2-3-2z', 'M8 9h8M8 13h6']);
export const IconExport = I(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']);
export const IconPdf = I(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M9 15h6']);
export const IconCsv = I(['M3 3h18v18H3z', 'M3 9h18M3 15h18M9 3v18']);
export const IconPrint = I(['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z']);
export const IconHome = I(['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10']);
export const IconLedger = I(['M3 3h18v18H3z', 'M3 9h18M9 21V9']);
export const IconGst = I(['M9 14l6-6', 'M9.5 8.5h.01M14.5 13.5h.01', 'M4 4h16v16H4z']);
export const IconReport = I(['M18 20V10M12 20V4M6 20v-6']);
export const IconUsers = I(['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75']);
export const IconBank = I(['M3 21h18M3 10h18M5 6l7-3 7 3', 'M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3']);
export const IconX = I('M18 6L6 18M6 6l12 12');
export const IconUp = I('M7 17L17 7M9 7h8v8');
export const IconDown = I('M7 7l10 10M17 9v8H9');
export const IconMove = I(['M5 9l-3 3 3 3', 'M19 9l3 3-3 3', 'M2 12h20']);
