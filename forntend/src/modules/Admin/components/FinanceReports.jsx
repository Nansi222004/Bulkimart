import React, { useState } from 'react';
import { adminGet, adminGetBlob } from '../../../utils/adminApi';
import { hint, rupeesFromPaise as money } from './financeText';

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const download = async path => {
  const { blob, filename } = await adminGetBlob(path);
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
};

export function TaxReportPanel() {
  const [month, setMonth] = useState(istToday().slice(0, 7)), [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async work => { setBusy(true); setError(''); try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const load = event => { event.preventDefault(); run(async () => setReport((await adminGet(`/finance/tax-report?month=${month}`)).data)); };
  return <section className="finance-workflow"><h2>Tax reports</h2>
    <p>TCS (GST section 52) and TDS (section 194-O) Bulkimart withheld from each seller in a month, with the sales they were worked out on. Use it to file GSTR-8 and the TDS return, and to give sellers their figures.</p>
    {error && <p role="alert">{error}</p>}
    <form className="finance-panel finance-grid" onSubmit={load}>
      <label>Month<input type="month" required value={month} onChange={e => setMonth(e.target.value)} />{hint('India time. Entries are counted in the month they were recorded, including refunds that reduce them.')}</label>
      <div><button disabled={busy}>Show report</button><button type="button" disabled={busy} onClick={() => run(() => download(`/finance/tax-report?month=${month}&format=csv`))}>Download CSV</button></div>
    </form>
    {report && <div className="finance-panel">
      {report.sellersMissingIds > 0 && <p role="alert">{`${report.sellersMissingIds} seller(s) are missing a GSTIN or PAN. Ask them to add it in their profile before you file.`}</p>}
      <div className="finance-table" role="region" tabIndex={0} aria-label="Tax report"><table><thead><tr>{['Seller', 'GSTIN', 'PAN', 'Item sales (incl. GST)', 'Taxable value', 'TCS', 'TDS'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {report.rows.map(row => <tr key={row.sellerId}><td>{row.sellerName}</td><td>{row.gstin || 'Missing'}</td><td>{row.pan || 'Missing'}</td><td>{money(row.grossPaise)}</td><td>{money(row.taxablePaise)}</td><td>{money(row.tcsPaise)}</td><td>{money(row.tdsPaise)}</td></tr>)}
        {!report.rows.length && <tr><td colSpan={7}>No seller sales were recorded in this month.</td></tr>}
        {report.rows.length > 0 && <tr><td><strong>Total</strong></td><td /><td /><td>{money(report.totals.grossPaise)}</td><td>{money(report.totals.taxablePaise)}</td><td>{money(report.totals.tcsPaise)}</td><td>{money(report.totals.tdsPaise)}</td></tr>}
      </tbody></table></div>
    </div>}
  </section>;
}

export function AccountingExportPanel() {
  const today = istToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`), [to, setTo] = useState(today), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async work => { setBusy(true); setError(''); try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const query = `from=${from}&to=${to}`;
  return <section className="finance-workflow"><h2>Accounting export</h2>
    <p>Every marketplace money event as a balanced debit/credit entry, ready to import into your accounting software (for example Tally or Zoho Books). The trial balance always adds up; “Customer payments clearing” shows prepaid customer money still due from the payment gateway.</p>
    {error && <p role="alert">{error}</p>}
    <form className="finance-panel finance-grid" onSubmit={event => { event.preventDefault(); run(async () => setResult((await adminGet(`/finance/trial-balance?${query}`)).data)); }}>
      <label>From<input type="date" required value={from} onChange={e => setFrom(e.target.value)} />{hint('First day included (India time).')}</label>
      <label>To<input type="date" required value={to} onChange={e => setTo(e.target.value)} />{hint('Last day included. At most one year.')}</label>
      <div><button disabled={busy}>Show trial balance</button><button type="button" disabled={busy} onClick={() => run(() => download(`/finance/trial-balance?${query}&format=csv`))}>Download trial balance</button><button type="button" disabled={busy} onClick={() => run(() => download(`/finance/journal?${query}&format=csv`))}>Download journal</button></div>
    </form>
    {result && <div className="finance-panel">
      <p>{result.balanced ? '✓ Debits equal credits.' : 'Debits and credits differ — contact support.'}</p>
      <div className="finance-table" role="region" tabIndex={0} aria-label="Trial balance"><table><thead><tr>{['Account', 'Debit', 'Credit', 'Balance'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {result.rows.map(row => <tr key={row.account}><td>{row.account}</td><td>{money(row.debitPaise)}</td><td>{money(row.creditPaise)}</td><td>{`${money(Math.abs(row.balancePaise))} ${row.balancePaise > 0 ? 'Dr' : row.balancePaise < 0 ? 'Cr' : ''}`}</td></tr>)}
        {!result.rows.length && <tr><td colSpan={4}>No money events in these dates.</td></tr>}
        <tr><td><strong>Total</strong></td><td>{money(result.totals.debitPaise)}</td><td>{money(result.totals.creditPaise)}</td><td /></tr>
      </tbody></table></div>
    </div>}
  </section>;
}
