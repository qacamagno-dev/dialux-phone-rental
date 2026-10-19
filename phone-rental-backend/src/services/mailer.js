// ============================================================
// DiaLux — mail service
// Uses Brevo (HTTP API) as the primary transport.
// Works on Render, Railway, and any cloud host — no SMTP ports.
// Falls back to console logging if no API key is set.
// ============================================================

let brevoClient = null;
let transportKind = null; // 'brevo' | 'console'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * MAIL_FROM may be either a bare address (no-reply@example.com) or the common
 * display form (DiaLux <no-reply@example.com>). Brevo requires those as two
 * separate fields, so normalise the env value once here.
 */
function resolveSender() {
  const raw = String(process.env.MAIL_FROM || '').trim().replace(/^['"]|['"]$/g, '');
  const explicitEmail = String(process.env.MAIL_FROM_EMAIL || '').trim();
  const explicitName = String(process.env.MAIL_FROM_NAME || '').trim();

  if (EMAIL_RE.test(explicitEmail)) {
    return { name: explicitName || 'DiaLux', email: explicitEmail };
  }

  const bracket = raw.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (bracket && EMAIL_RE.test(bracket[2].trim())) {
    return { name: bracket[1].trim() || 'DiaLux', email: bracket[2].trim() };
  }

  const embedded = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (embedded && EMAIL_RE.test(embedded[0])) {
    const name = raw.replace(embedded[0], '').replace(/[<>]/g, '').trim();
    return { name: name || 'DiaLux', email: embedded[0] };
  }

  if (EMAIL_RE.test(raw)) return { name: 'DiaLux', email: raw };
  return { name: 'DiaLux', email: 'no-reply@dialux.ph' };
}

/* ---------------- boot ---------------- */

function resolveTransport() {
  if (transportKind) return transportKind;

  if (process.env.BREVO_API_KEY) {
    try {
      const { BrevoClient } = require('@getbrevo/brevo');
      brevoClient = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
      transportKind = 'brevo';
      const sender = resolveSender();
      console.log(`✉️  Mail transport: Brevo (${sender.name} <${sender.email}>)`);
      return transportKind;
    } catch (err) {
      console.warn('⚠️  BREVO_API_KEY is set but Brevo could not initialise:', err.message);
    }
  }

  transportKind = 'console';
  console.log('✉️  Mail transport: console (set BREVO_API_KEY to enable real delivery)');
  return transportKind;
}

/* ---------------- send ---------------- */

async function sendMail({ to, subject, text, html } = {}) {
  const recipient = String(to || '').trim();
  if (!EMAIL_RE.test(recipient) || !subject) {
    return { delivered: false, transport: 'none', error: 'a valid to address and subject are required' };
  }

  const kind = resolveTransport();

  if (kind === 'brevo') {
    try {
      const sender = resolveSender();
      const result = await brevoClient.transactionalEmails.sendTransacEmail({
        subject,
        htmlContent: html || `<pre>${String(text || '')}</pre>`,
        textContent: text || undefined,
        sender,
        to: [{ email: recipient }],
      });
      const id = result?.messageId || result?.body?.messageId || result?.response?.body?.messageId || '';
      console.log(`📧 Sent to ${recipient}${id ? ` (id: ${id})` : ''}`);
      return { delivered: true, transport: 'brevo', id };
    } catch (err) {
      const msg = err?.body?.message
        || err?.response?.body?.message
        || err?.response?.data?.message
        || err?.message
        || 'Unknown Brevo error';
      console.error('✗ Brevo send failed:', msg);
      return { delivered: false, transport: 'brevo', error: msg };
    }
  }

  printToConsole({ to: recipient, subject, text });
  return { delivered: false, transport: 'console' };
}

function printToConsole({ to, subject, text }) {
  console.log(
    '\n' +
    '┌───────────────────────────────────────────────────────────\n' +
    '│ ✉  MAIL (not sent — no provider configured)\n' +
    `│ To:      ${to}\n` +
    `│ Subject: ${subject}\n` +
    '├───────────────────────────────────────────────────────────\n' +
    String(text || '').split('\n').map(l => `│ ${l}`).join('\n') + '\n' +
    '└───────────────────────────────────────────────────────────\n'
  );
}

function mailDiagnostics() {
  const sender = resolveSender();
  return {
    transport: resolveTransport(),
    sender: `${sender.name} <${sender.email}>`,
    apiKeyConfigured: Boolean(process.env.BREVO_API_KEY),
  };
}

/** Public base URL for links inside emails. */
function appUrl() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
}

/* ---------------- shared layout ---------------- */

function emailShell({ title, subtitle, body, cta }) {
  return `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #0F172A; background: #F8FAFC; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 24px; }
  .header { background: linear-gradient(135deg, #0B1220, #0EA5E9); color: #fff; padding: 32px; text-align: center; border-radius: 16px 16px 0 0; }
  .header h1 { margin: 0 0 6px; font-size: 24px; }
  .header p { margin: 0; color: #BAE6FD; font-size: 14px; }
  .content { background: #fff; padding: 32px; border-radius: 0 0 16px 16px; }
  .details { background: #F8FAFC; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #0EA5E9; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #E2E8F0; font-size: 14px; }
  .row:last-child { border-bottom: none; }
  .row span { color: #64748B; }
  .row strong { color: #0F172A; }
  .total { font-size: 18px; font-weight: 700; color: #0EA5E9; padding-top: 12px; border-top: 2px solid #E2E8F0; margin-top: 12px; }
  .button { display: inline-block; background: #0EA5E9; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 999px; font-weight: 600; margin-top: 20px; }
  .badge { background: #D1FAE5; color: #065F46; padding: 4px 12px; border-radius: 20px; display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
  .footer { text-align: center; padding: 20px; font-size: 12px; color: #94A3B8; }
  .footer a { color: #0EA5E9; text-decoration: none; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${title}</h1>
      <p>${subtitle}</p>
    </div>
    <div class="content">
      ${body}
      ${cta ? `<div style="text-align:center;">${cta}</div>` : ''}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} DiaLux · Quezon City</p>
      <p>Questions? <a href="mailto:support@dialux.ph">support@dialux.ph</a></p>
    </div>
  </div>
</body>
</html>`;
}

/* ---------------- templates ---------------- */

function orderConfirmationMail({ to, name, order, currency = '₱' }) {
  const items = (order.items || [])
    .map(i => `<div class="row"><span>${i.qty} × ${i.name}</span><strong>${currency}${(i.rate * i.qty).toLocaleString('en-PH')}</strong></div>`)
    .join('');

  const body = `
    <h2 style="margin-top:0;">Hi ${name || 'there'} 👋</h2>
    <p>Thanks for choosing DiaLux! Your booking is confirmed and we're getting your device ready.</p>
    <div class="details">
      <h3 style="margin-top:0;">Booking ${order.invoiceNo || ''}</h3>
      ${items}
      <div class="row"><span>Rental window</span><strong>${order.startDate} → ${order.endDate}</strong></div>
      <div class="row"><span>Duration</span><strong>${order.days} day(s)</strong></div>
      <div class="row"><span>Fulfilment</span><strong style="text-transform:capitalize;">${order.orderType || 'delivery'}</strong></div>
      <div class="row"><span>Payment method</span><strong style="text-transform:uppercase;">${order.payment?.method || '—'}</strong></div>
      <div class="row total"><span>Total</span><strong>${currency}${(order.total || 0).toLocaleString('en-PH')}</strong></div>
      <div class="row"><span>Refundable deposit</span><strong>${currency}${(order.deposit || 0).toLocaleString('en-PH')}</strong></div>
    </div>
    <div style="text-align:center;margin:16px 0;"><span class="badge">✓ CONFIRMED</span></div>
    <p><strong>Delivering to:</strong><br>${order.address || '—'}</p>
    <p style="font-size:13px;color:#64748B;margin-top:20px;">Your deposit is refunded in full once the device passes our return inspection.</p>
  `;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Your DiaLux booking ${order.invoiceNo || ''} is confirmed.`,
    '',
    ...(order.items || []).map(i => `  ${i.qty} × ${i.name}`),
    '',
    `Rental window: ${order.startDate} → ${order.endDate} (${order.days} day(s))`,
    `Total:         ${currency}${order.total}`,
    `Deposit held:  ${currency}${order.deposit} (refunded after inspection)`,
    `Delivering to: ${order.address}`,
    '',
    `Track it here: ${appUrl()}/order.html?id=${order.id || order._id}`,
    '',
    '— DiaLux',
  ].join('\n');

  const html = emailShell({
    title: '🎉 Booking Confirmed!',
    subtitle: 'Your device is on its way to you',
    body,
    cta: `<a href="${appUrl()}/order.html?id=${order.id || order._id}" class="button">Track My Booking →</a>`,
  });

  return sendMail({ to, subject: `DiaLux booking confirmed — ${order.invoiceNo || ''}`, text, html });
}

function paymentReceiptMail({ to, name, order, currency = '₱' }) {
  const ref = order.payment?.referenceNo || '—';
  const method = (order.payment?.method || '—').toUpperCase();

  const body = `
    <h2 style="margin-top:0;">Hi ${name || 'there'} 🧾</h2>
    <p>We received your payment. Keep this email as your receipt.</p>
    <div class="details">
      <h3 style="margin-top:0;">Receipt ${order.invoiceNo || ''}</h3>
      <div class="row"><span>Reference</span><strong style="font-family:monospace;">${ref}</strong></div>
      <div class="row"><span>Method</span><strong>${method}</strong></div>
      <div class="row"><span>Paid at</span><strong>${order.payment?.paidAt ? new Date(order.payment.paidAt).toLocaleString('en-PH') : '—'}</strong></div>
      <div class="row total"><span>Amount</span><strong>${currency}${((order.payment?.amount || order.total) || 0).toLocaleString('en-PH')}</strong></div>
    </div>
    <div style="text-align:center;margin:16px 0;"><span class="badge">✓ PAID</span></div>
    <p style="font-size:13px;color:#64748B;">If you didn't authorize this payment, reply to this email immediately.</p>
  `;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    'We received your payment. Keep this email as your receipt.',
    '',
    `Order:     ${order.invoiceNo || ''}`,
    `Reference: ${ref}`,
    `Method:    ${method}`,
    `Amount:    ${currency}${order.payment?.amount || order.total}`,
    '',
    `View booking: ${appUrl()}/order.html?id=${order.id || order._id}`,
    '',
    '— DiaLux',
  ].join('\n');

  const html = emailShell({
    title: '🧾 Payment Received',
    subtitle: 'Thanks — your receipt is below',
    body,
    cta: `<a href="${appUrl()}/order.html?id=${order.id || order._id}" class="button">View Booking →</a>`,
  });

  return sendMail({ to, subject: `Payment receipt — ${order.invoiceNo || ''}`, text, html });
}


function welcomeMail({ to, name }) {
  const first = String(name || 'there').trim().split(/\s+/)[0] || 'there';
  const body = `
    <h2 style="margin-top:0;">Welcome, ${first}! 👋</h2>
    <p>Your DiaLux account is ready. You can now browse devices, save favorites, place rentals and track every order update from your account.</p>
    <div class="details">
      <div class="row"><span>Next step</span><strong>Add your delivery address</strong></div>
      <div class="row"><span>Then</span><strong>Choose a device and rental plan</strong></div>
    </div>
    <p style="font-size:13px;color:#64748B;">We will also email you about important payment, delivery, return and deposit updates.</p>
  `;

  const text = [
    `Welcome to DiaLux, ${first}!`,
    '',
    'Your account is ready. Add a delivery address, then choose a device and rental plan.',
    `Open your account: ${appUrl()}/profile.html`,
    '',
    '— DiaLux',
  ].join('\n');

  const html = emailShell({
    title: 'Welcome to DiaLux',
    subtitle: 'Your account is ready',
    body,
    cta: `<a href="${appUrl()}/profile.html" class="button">Open My Account →</a>`,
  });

  return sendMail({ to, subject: 'Welcome to DiaLux', text, html });
}

function statusUpdateMail({ to, name, order, status, message }) {
  const label = String(status || 'updated').replace(/-/g, ' ');
  const ref = order?.invoiceNo || `#${String(order?.id || order?._id || '').slice(-6).toUpperCase()}`;
  const body = `
    <h2 style="margin-top:0;">Hi ${name || 'there'} 👋</h2>
    <p>Your DiaLux booking <strong>${ref}</strong> has a new update.</p>
    <div class="details">
      <div class="row"><span>Status</span><strong style="text-transform:capitalize;">${label}</strong></div>
      <div class="row"><span>Update</span><strong>${message || `Your booking is now ${label}.`}</strong></div>
    </div>
  `;

  const id = order?.id || order?._id;
  const link = id ? `${appUrl()}/order.html?id=${id}` : `${appUrl()}/profile.html#orders`;
  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Booking ${ref}: ${message || `status changed to ${label}.`}`,
    `Track it here: ${link}`,
    '',
    '— DiaLux',
  ].join('\n');

  const html = emailShell({
    title: 'Booking Update',
    subtitle: ref,
    body,
    cta: `<a href="${link}" class="button">View Booking →</a>`,
  });

  return sendMail({ to, subject: `DiaLux update — ${ref}: ${label}`, text, html });
}

function passwordResetMail({ to, name, resetUrl, ttlMinutes }) {
  const body = `
    <h2 style="margin-top:0;">Reset your password</h2>
    <p>Hi ${name || 'there'}, someone asked to reset the password on your DiaLux account.</p>
    <p>Click the button below within <strong>${ttlMinutes} minutes</strong> to choose a new one.</p>
    <p style="font-size:13px;color:#64748B;">If that wasn't you, ignore this email — your password stays as it is.</p>
  `;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    'Someone asked to reset the password on your DiaLux account.',
    `Open this link within ${ttlMinutes} minutes to choose a new one:`,
    '',
    resetUrl,
    '',
    "If that wasn't you, ignore this email.",
    '',
    '— DiaLux',
  ].join('\n');

  const html = emailShell({
    title: '🔑 Reset Password',
    subtitle: 'A quick link to set a new one',
    body,
    cta: `<a href="${resetUrl}" class="button">Reset Password →</a>`,
  });

  return sendMail({ to, subject: 'Reset your DiaLux password', text, html });
}

function returnReminderMail({ to, name, order, currency = '₱' }) {
  const body = `
    <h2 style="margin-top:0;">⏰ Rental Due Soon</h2>
    <p>Hi ${name || 'there'}, your DiaLux rental <strong>${order.invoiceNo || ''}</strong> is due on <strong>${order.endDate}</strong>.</p>
    <p>Request the return from your account and we'll arrange pickup.</p>
    <p style="font-size:13px;color:#64748B;">Your ${currency}${(order.deposit || 0).toLocaleString('en-PH')} deposit is refunded once the device passes inspection.</p>
  `;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Your DiaLux rental is due back on ${order.endDate}.`,
    `Request the return from your account: ${appUrl()}/profile.html#orders`,
    '',
    `Your ${currency}${order.deposit} deposit is refunded after inspection.`,
    '',
    '— DiaLux',
  ].join('\n');

  const html = emailShell({
    title: '⏰ Rental Due Soon',
    subtitle: 'Time to schedule the return',
    body,
    cta: `<a href="${appUrl()}/profile.html#orders" class="button">Request Return →</a>`,
  });

  return sendMail({ to, subject: 'Your DiaLux rental is due back soon', text, html });
}

function supportReceiptMail({ to, name, ticket }) {
  const body = `
    <h2 style="margin-top:0;">We got your message ✅</h2>
    <p>Hi ${name || 'there'}, thanks for reaching out — your message is logged as <strong>${ticket.ref}</strong>.</p>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <p>Our team will reply to this address, and you'll see the reply in your account notifications too.</p>
  `;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Thanks for getting in touch — your message is logged as ${ticket.ref}.`,
    `Subject: ${ticket.subject}`,
    '',
    '— DiaLux Support',
  ].join('\n');

  const html = emailShell({
    title: '✅ We Got Your Message',
    subtitle: 'Our team will reply shortly',
    body,
  });

  return sendMail({ to, subject: `We got your message — ${ticket.ref}`, text, html });
}

module.exports = {
  sendMail,
  appUrl,
  welcomeMail,
  statusUpdateMail,
  passwordResetMail,
  orderConfirmationMail,
  paymentReceiptMail,
  returnReminderMail,
  supportReceiptMail,
  currentTransport: () => resolveTransport(),
  mailDiagnostics,
};