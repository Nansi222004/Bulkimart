// Customer confirmation emails: product orders, service requests and parcel bookings.
// Best effort: a missing email address, missing SMTP settings or a mail-server error never affects the business
// action that triggered it. Each email is sent at most once per event key (models/EmailLog.js).
// SMTP settings come from .env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_FROM_NAME.
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import EmailLog from '../models/EmailLog.js';

let transport;
function mailer() {
  if (transport !== undefined) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  transport = SMTP_HOST && SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT) || 587, secure: String(SMTP_SECURE).toLowerCase() === 'true', auth: { user: SMTP_USER, pass: SMTP_PASS } })
    : null;
  if (!transport) console.warn('[EMAIL] SMTP is not configured; customer confirmation emails are off.');
  return transport;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rupees = amount => `₹${(Math.round(Number(amount || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const siteUrl = path => `${(process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://bulkimart.in').replace(/\/+$/, '')}${path}`;
const PAYMENT_LABEL = { cod: 'Cash on delivery', online: 'Paid online', wallet: 'Bulkimart wallet', pay_driver: 'Pay the delivery partner in cash' };

/** A simple branded layout. `rows` are [label, value] pairs; `table` is an optional pre-built HTML block. */
function layout({ name, heading, intro, rows = [], table = '', button, footer }) {
  const detail = rows.map(([label, value]) => `<tr><td style="padding:6px 0;color:#64748b">${esc(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a">${esc(value)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#172b4d">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#7a0010;padding:18px 24px;color:#ffffff;font-size:20px;font-weight:700">Bulkimart</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:#0f172a">${esc(heading)}</h1>
<p style="margin:0 0 16px;line-height:1.5">Hi ${esc(name || 'there')},<br>${esc(intro)}</p>
${detail ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin-bottom:16px">${detail}</table>` : ''}
${table}
${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#d71d2b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>` : ''}
<p style="margin:16px 0 0;font-size:13px;color:#64748b;line-height:1.5">${esc(footer || 'Thank you for choosing Bulkimart.')}</p>
</td></tr></table>
<p style="font-size:12px;color:#94a3b8;margin:12px 0 0">This is an automated message from Bulkimart. Please do not reply to this email.</p>
</td></tr></table></body></html>`;
}

/**
 * Sends one email to the customer, once per `key`. Never throws.
 * `build(user)` returns { subject, html, text } or null to skip.
 */
export async function sendCustomerEmail(userId, key, build) {
  try {
    if (!userId || !key) return false;
    const smtp = mailer();
    if (!smtp) return false;
    const user = await User.findById(userId).select('name email').lean();
    const to = String(user?.email || '').trim();
    if (!EMAIL.test(to)) return false; // the customer has not added an email address
    const message = await build(user);
    if (!message) return false;
    try { await EmailLog.create({ key, userId, subject: message.subject }); }
    catch (err) { if (err.code === 11000) return false; throw err; } // already sent (or being sent) for this event
    try {
      const fromName = process.env.MAIL_FROM_NAME || 'Bulkimart';
      const from = process.env.MAIL_FROM || process.env.SMTP_USER;
      await smtp.sendMail({ from: `"${fromName.replace(/"/g, '')}" <${from}>`, to, subject: message.subject, html: message.html, text: message.text });
      await EmailLog.updateOne({ key }, { status: 'sent' });
      return true;
    } catch (err) {
      console.error('[EMAIL] send failed:', key, err.message);
      // Free the key so a later retry of the same event can send it.
      await EmailLog.deleteOne({ key }).catch(() => {});
      return false;
    }
  } catch (err) {
    console.error('[EMAIL] failed:', key, err.message);
    return false;
  }
}

/** Order placed. `orders` are Order documents from one checkout (one per seller in a mixed basket). */
export function emailOrderConfirmation(userId, orders) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
  if (!list.length) return Promise.resolve(false);
  const key = `order:${list.map(o => String(o._id)).sort().join(',')}`;
  return sendCustomerEmail(userId, key, user => {
    const numbers = list.map(o => `#${o.orderNo}`).join(', ');
    const total = list.reduce((sum, o) => sum + Number(o.pricing?.totalAmount || 0), 0);
    const lines = list.flatMap(o => (o.items || []).map(i => `<tr><td style="padding:6px 0">${esc(i.name)} × ${esc(i.qty)}</td><td style="padding:6px 0;text-align:right">${esc(rupees(Number(i.finalItemPrice || i.price || 0) * Number(i.qty || 0)))}</td></tr>`)).join('');
    const address = list[0].shippingAddress || {};
    const where = [address.name, address.addressLine1 || address.address || address.line1, address.city, address.state, address.pincode].filter(Boolean).join(', ');
    const rows = [['Order number', numbers], ['Payment', PAYMENT_LABEL[list[0].paymentMethod] || list[0].paymentMethod || '—'], ['Total', rupees(total)]];
    if (where) rows.push(['Deliver to', where]);
    const table = lines ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:8px;font-size:14px"><tr><td style="padding:6px 0;font-weight:700">Items</td><td></td></tr>${lines}</table>` : '';
    const subject = `Order confirmed ${numbers} – Bulkimart`;
    return {
      subject,
      html: layout({ name: user.name, heading: 'Your order is confirmed', intro: `Thank you for shopping with Bulkimart. We have received your order ${numbers}.`, rows, table, button: { label: 'Track your order', url: siteUrl('/orders') }, footer: 'We will notify you when your order is on its way.' }),
      text: `Hi ${user.name || 'there'},\n\nYour Bulkimart order ${numbers} is confirmed.\nTotal: ${rupees(total)}\nPayment: ${rows[1][1]}\n\nTrack it at ${siteUrl('/orders')}\n\nThank you for choosing Bulkimart.`,
    };
  });
}

/** Service request received (free service) or paid and submitted (fixed-price service). */
export function emailServiceConfirmation(application, { paid = false } = {}) {
  if (!application || application.applicantType !== 'customer') return Promise.resolve(false);
  const id = String(application._id);
  return sendCustomerEmail(application.user, `service:${id}:submitted`, user => {
    const name = application.snapshot?.name || 'Service';
    const reference = `SR-${id.slice(-6).toUpperCase()}`;
    const amountPaise = application.billing?.amountPaise;
    const rows = [['Service', name], ['Request ID', reference]];
    if (paid && amountPaise > 0) rows.push(['Amount paid', rupees(amountPaise / 100)]);
    const subject = `${paid ? 'Payment received' : 'Request received'}: ${name} – Bulkimart`;
    return {
      subject,
      html: layout({ name: user.name, heading: paid ? 'Payment received, request submitted' : 'Your service request is submitted', intro: `We have received your request for ${name}. Our team will review it and update you.`, rows, button: { label: 'View my request', url: siteUrl(`/legal-services/requests/${id}`) }, footer: 'You will be notified if we need more information from you.' }),
      text: `Hi ${user.name || 'there'},\n\nWe have received your request for ${name} (${reference}).${paid && amountPaise > 0 ? `\nAmount paid: ${rupees(amountPaise / 100)}` : ''}\nOur team will review it and update you.\n\nView it at ${siteUrl(`/legal-services/requests/${id}`)}`,
    };
  });
}
// Parcel bookings intentionally get no confirmation email (push notifications only).

