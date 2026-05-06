import nodemailer from 'nodemailer';

// ── Transporter ───────────────────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('📧 Email not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true, // Use connection pooling
    maxConnections: 5,
    maxMessages: 100,
  });
  console.log(`📧 Email service ready (${SMTP_USER})`);
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) return;
  
  // Validate email address
  if (!to || typeof to !== 'string' || !to.includes('@') || to.length < 5) {
    console.warn(`📧 Skipping email - invalid recipient: ${to}`);
    return;
  }
  
  try {
    const info = await t.sendMail({
      from: `"Roomie Split" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`📧 ✅ Sent to ${to}: ${subject}`);
    return info;
  } catch (err) {
    console.error(`📧 ❌ Email error (to: ${to}):`, err.message);
    // Don't throw - just log the error so app continues working
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatRupees(paise) {
  return '\u20B9' + (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getCategoryEmoji(category) {
  const map = {
    groceries: '🛒', electricity: '⚡', water: '💧', wifi: '📶',
    rent: '🏠', gas: '🔥', cleaning: '🧹', food: '🍕',
    transport: '🚗', medicine: '💊', entertainment: '🎬',
    household: '🧴', other: '💰',
  };
  return map[category] || '💰';
}

/**
 * Build HTTPS redirect URLs that go through our server.
 * Gmail allows HTTPS links — our server then shows a page with UPI deep links.
 */
function buildPayUrl(app, upiId, amountPaise, purpose, payerName) {
  const base = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`);
  const am   = (amountPaise / 100).toFixed(2);
  const pa   = encodeURIComponent(upiId);
  const pn   = encodeURIComponent(payerName);
  const tn   = encodeURIComponent(`RoomieSplit: ${purpose}`.slice(0, 50));
  return `${base}/pay?pa=${pa}&pn=${pn}&am=${am}&tn=${tn}&app=${app}`;
}

// ── Email wrapper ─────────────────────────────────────────────────────────
function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Roomie Split</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f0ff;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f0ff;padding:40px 16px;">
  <tr><td align="center">
  <table role="presentation" width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

    <!-- LOGO HEADER -->
    <tr>
      <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#9333ea 100%);border-radius:20px 20px 0 0;padding:36px 40px 32px;text-align:center;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center">
              <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:16px;padding:12px 20px;margin-bottom:16px;">
                <span style="font-size:28px;">🏠</span>
              </div>
              <div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;line-height:1;">Roomie Split</div>
              <div style="color:#c4b5fd;font-size:13px;margin-top:6px;font-weight:500;">Smart expense splitting for roommates</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- BODY -->
    <tr>
      <td style="background:#ffffff;padding:36px 40px;">
        ${content}
      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td style="background:#f8f7ff;border-radius:0 0 20px 20px;padding:24px 40px;text-align:center;border-top:1px solid #e5e7eb;">
        <p style="margin:0 0 6px;color:#6b7280;font-size:12px;">
          You received this because you are a member of a Roomie Split room.
        </p>
        <p style="margin:0;color:#9ca3af;font-size:11px;">
          &copy; 2025 Roomie Split &nbsp;&bull;&nbsp; Fair splits, zero drama.
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Expense Added Email ───────────────────────────────────────────────────
export async function sendExpenseAddedEmail({
  toEmail, toName, payerName, payerUpiId,
  purpose, category, totalAmount, yourShare,
  date, notes, roomName,
}) {
  if (!toEmail) return;

  const emoji    = getCategoryEmoji(category);
  const dateStr  = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const phonePe  = buildPayUrl('phonepe', payerUpiId, yourShare, purpose, payerName);
  const gpay     = buildPayUrl('gpay',    payerUpiId, yourShare, purpose, payerName);
  const upiAny   = buildPayUrl('upi',     payerUpiId, yourShare, purpose, payerName);
  const amountFmt = formatRupees(yourShare);
  const totalFmt  = formatRupees(totalAmount);

  const content = `
    <!-- Greeting -->
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
      <strong style="color:#4f46e5;">${payerName}</strong> just added a new expense in
      <strong style="color:#111827;">${roomName}</strong>. Here are the details:
    </p>

    <!-- Expense detail card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#f8f7ff;border:1.5px solid #e0e7ff;border-radius:16px;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px 16px;">
          <!-- Title row -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="width:52px;vertical-align:middle;">
                <div style="width:48px;height:48px;background:#ede9fe;border-radius:12px;text-align:center;line-height:48px;font-size:24px;">
                  ${emoji}
                </div>
              </td>
              <td style="padding-left:14px;vertical-align:middle;">
                <div style="font-size:18px;font-weight:800;color:#111827;">${purpose}</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:3px;">${dateStr} &nbsp;&bull;&nbsp; ${roomName}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Divider -->
      <tr><td style="padding:0 24px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
      <!-- Details rows -->
      <tr>
        <td style="padding:16px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:13px;color:#6b7280;">Paid by</span>
              </td>
              <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
                <span style="font-size:13px;font-weight:600;color:#111827;">${payerName}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:13px;color:#6b7280;">Total bill</span>
              </td>
              <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
                <span style="font-size:13px;font-weight:600;color:#111827;">${totalFmt}</span>
              </td>
            </tr>
            ${notes ? `
            <tr>
              <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:13px;color:#6b7280;">Note</span>
              </td>
              <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;text-align:right;">
                <span style="font-size:13px;color:#6b7280;font-style:italic;">${notes}</span>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:14px 0 4px;">
                <span style="font-size:14px;font-weight:700;color:#374151;">Your share</span>
              </td>
              <td style="padding:14px 0 4px;text-align:right;">
                <span style="font-size:24px;font-weight:800;color:#4f46e5;">${amountFmt}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="padding:0 24px 20px;"></td></tr>
    </table>

    <!-- Pay now section -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:16px;margin-bottom:28px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:800;color:#92400e;">
            Pay ${payerName} &nbsp;&#8594;&nbsp; ${amountFmt}
          </p>
          <p style="margin:0 0 20px;font-size:12px;color:#b45309;">
            UPI ID: <span style="font-family:monospace;font-weight:700;background:#fef3c7;padding:2px 6px;border-radius:4px;">${payerUpiId}</span>
          </p>

          <!-- PhonePe button -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
            <tr>
              <td align="center">
                <a href="${phonePe}"
                  style="display:block;background:#5f259f;color:#ffffff;text-decoration:none;text-align:center;padding:15px 24px;border-radius:12px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                  &#128156; &nbsp;Pay with PhonePe &mdash; ${amountFmt}
                </a>
              </td>
            </tr>
          </table>

          <!-- GPay button -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
            <tr>
              <td align="center">
                <a href="${gpay}"
                  style="display:block;background:#1a73e8;color:#ffffff;text-decoration:none;text-align:center;padding:15px 24px;border-radius:12px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                  &#128309; &nbsp;Pay with Google Pay &mdash; ${amountFmt}
                </a>
              </td>
            </tr>
          </table>

          <!-- Any UPI button -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center">
                <a href="${upiAny}"
                  style="display:block;background:#4f46e5;color:#ffffff;text-decoration:none;text-align:center;padding:15px 24px;border-radius:12px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                  &#128241; &nbsp;Pay with Any UPI App &mdash; ${amountFmt}
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;line-height:1.5;">
            Open this email on your phone and tap a button above.<br/>
            The UPI app will open with the amount already filled in.
          </p>
        </td>
      </tr>
    </table>

    <!-- Info note -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
      <tr>
        <td style="padding:14px 18px;">
          <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">
            <strong>&#9432; How to pay:</strong> Open this email on your Android phone &rarr;
            tap any Pay button above &rarr; your UPI app opens with
            <strong>${amountFmt}</strong> pre-filled &rarr; just confirm the payment.
          </p>
        </td>
      </tr>
    </table>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] ${payerName} paid ${totalFmt} for ${purpose} — your share: ${amountFmt}`,
    html: emailWrapper(content),
  });
}

// ── Payment Received Email ────────────────────────────────────────────────
export async function sendPaymentReceivedEmail({
  toEmail, toName, fromName, amount, purpose, roomName,
}) {
  if (!toEmail) return;

  const amountFmt = formatRupees(amount);

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
      Great news! You just received a payment in <strong style="color:#111827;">${roomName}</strong>.
    </p>

    <!-- Payment confirmation card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:16px;margin-bottom:28px;">
      <tr>
        <td style="padding:32px 24px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">&#9989;</div>
          <div style="font-size:32px;font-weight:800;color:#15803d;margin-bottom:6px;">${amountFmt}</div>
          <div style="font-size:15px;color:#16a34a;font-weight:600;margin-bottom:8px;">
            received from <strong>${fromName}</strong>
          </div>
          <div style="display:inline-block;background:rgba(255,255,255,0.7);border-radius:8px;padding:6px 16px;">
            <span style="font-size:13px;color:#374151;">
              for <strong>${purpose}</strong> &nbsp;&bull;&nbsp; ${roomName}
            </span>
          </div>
        </td>
      </tr>
    </table>

    <!-- Balance reminder -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#f8f7ff;border:1px solid #e0e7ff;border-radius:12px;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0;font-size:13px;color:#4f46e5;line-height:1.5;font-weight:600;">
            &#127881; Your balance has been updated in Roomie Split.
          </p>
          <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">
            Open the app to see your latest balance and pending payments.
          </p>
        </td>
      </tr>
    </table>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] ${fromName} paid you ${amountFmt} for ${purpose}`,
    html: emailWrapper(content),
  });
}

// ── Monthly Summary Email ─────────────────────────────────────────────────
export async function sendMonthlySummaryEmail({
  toEmail, toName, roomName, monthName,
  totalSpent, expenses, netBalance, totalOwed, totalOwedTo,
}) {
  if (!toEmail) return;

  const expenseRows = expenses.slice(0, 8).map(e => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${e.purpose}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;">${e.payer_name}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600;color:#111827;text-align:right;">${formatRupees(e.total_amount)}</td>
    </tr>`).join('');

  const balanceColor = netBalance >= 0 ? '#15803d' : '#cc4a12';
  const balanceText = netBalance >= 0
    ? `You are owed ${formatRupees(Math.abs(netBalance))}`
    : `You owe ${formatRupees(Math.abs(netBalance))}`;

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Here's your monthly expense summary for <strong>${roomName}</strong> — <strong>${monthName}</strong>.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:linear-gradient(135deg,#1A6B4A,#27AE78);border-radius:16px;margin-bottom:24px;">
      <tr><td style="padding:24px;text-align:center;">
        <div style="font-size:13px;color:#a7f3d0;margin-bottom:4px;">Total Group Spending</div>
        <div style="font-size:32px;font-weight:800;color:#ffffff;">${formatRupees(totalSpent)}</div>
        <div style="font-size:13px;color:#6ee7b7;margin-top:8px;">${monthName}</div>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td width="48%" style="background:#ffeee6;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:12px;color:#cc4a12;margin-bottom:4px;">You Owe</div>
          <div style="font-size:20px;font-weight:700;color:#cc4a12;">${formatRupees(totalOwed)}</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:#d4f5e7;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:12px;color:#1a6b4a;margin-bottom:4px;">Owed to You</div>
          <div style="font-size:20px;font-weight:700;color:#1a6b4a;">${formatRupees(totalOwedTo)}</div>
        </td>
      </tr>
    </table>

    <div style="background:#f8f7ff;border:1px solid #e0e7ff;border-radius:12px;padding:14px 18px;margin-bottom:24px;text-align:center;">
      <span style="font-size:15px;font-weight:700;color:${balanceColor};">${balanceText}</span>
    </div>

    <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#111827;">Expenses this month</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <th style="text-align:left;font-size:11px;color:#9ca3af;padding-bottom:8px;font-weight:600;">EXPENSE</th>
        <th style="text-align:left;font-size:11px;color:#9ca3af;padding-bottom:8px;font-weight:600;">PAID BY</th>
        <th style="text-align:right;font-size:11px;color:#9ca3af;padding-bottom:8px;font-weight:600;">AMOUNT</th>
      </tr>
      ${expenseRows}
    </table>

    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">Open Roomie Split to settle up any pending payments.</p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] ${monthName} Summary — ${roomName} spent ${formatRupees(totalSpent)}`,
    html: emailWrapper(content),
  });
}

// ── Payment Reminder Email ────────────────────────────────────────────────
export async function sendPaymentReminderEmail({
  toEmail, toName, payerName, payerUpiId,
  purpose, amount, date, roomName, splitId,
}) {
  if (!toEmail) return;

  const amountFmt = formatRupees(amount);
  const dateStr   = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
  const phonePe   = buildPayUrl('phonepe', payerUpiId, amount, purpose, payerName);
  const upiAny    = buildPayUrl('upi',     payerUpiId, amount, purpose, payerName);

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">
      Just a friendly reminder — you have a pending payment in <strong>${roomName}</strong>.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:16px;margin-bottom:24px;">
      <tr><td style="padding:24px;text-align:center;">
        <div style="font-size:13px;color:#b45309;margin-bottom:4px;">${purpose} · ${dateStr}</div>
        <div style="font-size:32px;font-weight:800;color:#cc4a12;">${amountFmt}</div>
        <div style="font-size:13px;color:#b45309;margin-top:8px;">due to <strong>${payerName}</strong></div>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
      <tr><td align="center">
        <a href="${phonePe}" style="display:block;background:#5f259f;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:12px;font-size:15px;font-weight:700;">
          Pay with PhonePe &mdash; ${amountFmt}
        </a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${upiAny}" style="display:block;background:#27ae78;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:12px;font-size:15px;font-weight:700;">
          Pay with Any UPI App &mdash; ${amountFmt}
        </a>
      </td></tr>
    </table>

    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;">
      Open this email on your phone and tap a button to pay instantly.
    </p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] Reminder: Pay ${amountFmt} to ${payerName} for ${purpose}`,
    html: emailWrapper(content),
  });
}

// ── Payment Pending Verification Email (to Payer) ─────────────────────────
export async function sendPaymentPendingEmail({
  toEmail, toName, fromName, amount, purpose, roomName, splitId,
}) {
  if (!toEmail) return;

  const amountFmt = formatRupees(amount);
  const base = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`);
  const approveUrl = `${base}/api/splits/${splitId}/payer-verify`;

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">
      <strong style="color:#4f46e5;">${fromName}</strong> claims they paid you in <strong>${roomName}</strong>.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:16px;margin-bottom:24px;">
      <tr><td style="padding:24px;text-align:center;">
        <div style="font-size:13px;color:#b45309;margin-bottom:4px;">${purpose}</div>
        <div style="font-size:32px;font-weight:800;color:#cc4a12;">${amountFmt}</div>
        <div style="font-size:13px;color:#b45309;margin-top:8px;">from <strong>${fromName}</strong></div>
      </td></tr>
    </table>

    <p style="margin:0 0 16px;font-size:14px;color:#374151;font-weight:600;">
      Did you receive this payment?
    </p>

    <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">
      Please confirm in the app whether you received ${amountFmt} from ${fromName}.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="display:block;background:#4f46e5;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:12px;font-size:15px;font-weight:700;">
          Open Roomie Split to Confirm
        </a>
      </td></tr>
    </table>

    <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;text-align:center;">
      Go to the app → Pending Payments → Confirm or Reject
    </p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] ${fromName} claims they paid ${amountFmt} for ${purpose}`,
    html: emailWrapper(content),
  });
}

// ── Payment Confirmed Email (to Debtor) ───────────────────────────────────
export async function sendPaymentConfirmedEmail({
  toEmail, toName, payerName, amount, purpose, roomName,
}) {
  if (!toEmail) return;

  const amountFmt = formatRupees(amount);

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">
      Great news! <strong style="color:#15803d;">${payerName}</strong> confirmed they received your payment in <strong>${roomName}</strong>.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:16px;margin-bottom:28px;">
      <tr>
        <td style="padding:32px 24px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">✅</div>
          <div style="font-size:32px;font-weight:800;color:#15803d;margin-bottom:6px;">${amountFmt}</div>
          <div style="font-size:15px;color:#16a34a;font-weight:600;margin-bottom:8px;">
            Payment Confirmed
          </div>
          <div style="display:inline-block;background:rgba(255,255,255,0.7);border-radius:8px;padding:6px 16px;">
            <span style="font-size:13px;color:#374151;">
              for <strong>${purpose}</strong> &nbsp;&bull;&nbsp; ${roomName}
            </span>
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">
      Your balance has been updated in Roomie Split.
    </p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] ✅ ${payerName} confirmed your ${amountFmt} payment for ${purpose}`,
    html: emailWrapper(content),
  });
}

// ── Payment Rejected Email (to Debtor) ────────────────────────────────────
export async function sendPaymentRejectedEmail({
  toEmail, toName, payerName, amount, purpose, roomName,
}) {
  if (!toEmail) return;

  const amountFmt = formatRupees(amount);

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">
      <strong style="color:#cc4a12;">${payerName}</strong> did not confirm receiving your payment in <strong>${roomName}</strong>.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:16px;margin-bottom:28px;">
      <tr>
        <td style="padding:32px 24px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">❌</div>
          <div style="font-size:32px;font-weight:800;color:#cc4a12;margin-bottom:6px;">${amountFmt}</div>
          <div style="font-size:15px;color:#dc2626;font-weight:600;margin-bottom:8px;">
            Payment Not Confirmed
          </div>
          <div style="display:inline-block;background:rgba(255,255,255,0.7);border-radius:8px;padding:6px 16px;">
            <span style="font-size:13px;color:#374151;">
              for <strong>${purpose}</strong> &nbsp;&bull;&nbsp; ${roomName}
            </span>
          </div>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Please check with ${payerName} and try paying again.
    </p>

    <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">
      The payment is still marked as unpaid in Roomie Split.
    </p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] ❌ ${payerName} did not confirm your ${amountFmt} payment for ${purpose}`,
    html: emailWrapper(content),
  });
}

// ── Bulk Payment Reminder Email (Multiple Splits) ─────────────────────────
export async function sendBulkPaymentReminderEmail({
  toEmail, toName, roomName, totalOwed, splits,
}) {
  if (!toEmail || !splits || splits.length === 0) return;

  const totalFmt = formatRupees(totalOwed);
  
  // Build list of pending payments
  const splitsList = splits.map(s => {
    const amount = s.share + (s.carry_forward || 0);
    const amountFmt = formatRupees(amount);
    const dateStr = new Date(s.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const emoji = getCategoryEmoji(s.category);
    
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">
          <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:2px;">
            ${emoji} ${s.purpose}
          </div>
          <div style="font-size:12px;color:#9ca3af;">${dateStr} · Pay ${s.payer_name}</div>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;text-align:right;">
          <div style="font-size:16px;font-weight:700;color:#cc4a12;">${amountFmt}</div>
        </td>
      </tr>
    `;
  }).join('');

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Hi ${toName},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">
      You have <strong>${splits.length} pending payment${splits.length > 1 ? 's' : ''}</strong> in <strong>${roomName}</strong>.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:16px;margin-bottom:24px;">
      <tr><td style="padding:24px;text-align:center;">
        <div style="font-size:13px;color:#b45309;margin-bottom:4px;">Total Amount Due</div>
        <div style="font-size:36px;font-weight:800;color:#cc4a12;">${totalFmt}</div>
        <div style="font-size:13px;color:#b45309;margin-top:8px;">${splits.length} pending payment${splits.length > 1 ? 's' : ''}</div>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:24px;">
      ${splitsList}
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${process.env.FRONTEND_URL || 'https://rommie-split-frontend-4dzb.vercel.app'}" 
           style="display:block;background:#4f46e5;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-size:15px;font-weight:700;">
          Open App to Pay
        </a>
      </td></tr>
    </table>

    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      Tap the button above to open the app and settle your pending payments.
    </p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] 💸 You have ${splits.length} pending payment${splits.length > 1 ? 's' : ''} (${totalFmt})`,
    html: emailWrapper(content),
  });
}

// ── Welcome Email (When Joining Room) ─────────────────────────────────────
export async function sendWelcomeEmail({
  toEmail, toName, roomName, roomCode, roommates, invitedBy,
}) {
  if (!toEmail) return;

  const roommatesList = roommates && roommates.length > 0
    ? roommates.map(r => `
        <tr>
          <td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;">
            <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:${r.color || '#6366f1'};color:#fff;text-align:center;line-height:32px;font-weight:700;font-size:14px;margin-right:12px;vertical-align:middle;">
              ${r.avatar_initials || r.name?.charAt(0) || '?'}
            </div>
            <span style="font-size:14px;font-weight:600;color:#111827;vertical-align:middle;">${r.name}</span>
          </td>
        </tr>
      `).join('')
    : '<tr><td style="padding:16px;text-align:center;color:#9ca3af;font-size:13px;">You\'re the first member!</td></tr>';

  const content = `
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#111827;">Welcome, ${toName}! 🎉</p>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">
      ${invitedBy ? `<strong>${invitedBy}</strong> invited you to join` : 'You\'ve successfully joined'} <strong>${roomName}</strong> on Roomie Split!
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);border-radius:16px;margin-bottom:24px;">
      <tr><td style="padding:24px;text-align:center;">
        <div style="font-size:13px;color:#c4b5fd;margin-bottom:8px;font-weight:600;">Your Room Code</div>
        <div style="font-size:32px;font-weight:800;color:#ffffff;letter-spacing:2px;">${roomCode}</div>
        <div style="font-size:12px;color:#c4b5fd;margin-top:8px;">Share this code with your roommates</div>
      </td></tr>
    </table>

    <div style="margin-bottom:24px;">
      <p style="font-size:14px;font-weight:600;color:#111827;margin:0 0 12px;">Your Roommates:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
        ${roommatesList}
      </table>
    </div>

    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#0369a1;">💡 Quick Tips:</p>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#0c4a6e;line-height:1.6;">
        <li>Add expenses as they happen</li>
        <li>Split bills equally or customize shares</li>
        <li>Pay directly via UPI with one tap</li>
        <li>Track who owes what in real-time</li>
      </ul>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <a href="${process.env.FRONTEND_URL || 'https://rommie-split-frontend-4dzb.vercel.app'}" 
           style="display:block;background:#4f46e5;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-size:15px;font-weight:700;">
          Open Roomie Split
        </a>
      </td></tr>
    </table>

    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
      <strong>Sharing is caring!</strong> 💚<br/>
      Keep your room finances transparent and stress-free.
    </p>
  `;

  await sendMail({
    to: toEmail,
    subject: `[Roomie Split] Welcome to ${roomName}! 🏠`,
    html: emailWrapper(content),
  });
}
