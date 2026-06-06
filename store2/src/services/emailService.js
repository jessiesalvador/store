const { transporter } = require("../config/mailer");

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Shared HTML wrapper ──────────────────────────────────────────────────────
function emailWrapper(title, body) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin:0; padding:0; background:#f4f7f4; font-family: ui-sans-serif, system-ui, sans-serif; color:#1a2e23; }
    .wrap { max-width:560px; margin:2rem auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.08); }
    .header { background:#0d6b57; padding:1.5rem 2rem; }
    .header h1 { margin:0; color:#fff; font-size:1.3rem; letter-spacing:-.01em; }
    .header p { margin:.3rem 0 0; color:rgba(255,255,255,.75); font-size:.9rem; }
    .body { padding:1.8rem 2rem; }
    .body h2 { margin:0 0 1rem; font-size:1.1rem; }
    table { width:100%; border-collapse:collapse; margin:1rem 0; }
    th { text-align:left; font-size:.78rem; text-transform:uppercase; letter-spacing:.06em; color:#5a7a6a; padding:.4rem 0; border-bottom:2px solid #e8f0ec; }
    td { padding:.55rem 0; border-bottom:1px solid #f0f5f2; font-size:.9rem; }
    .total-row td { font-weight:700; border-top:2px solid #0d6b57; border-bottom:0; padding-top:.8rem; }
    .btn { display:inline-block; margin-top:1.2rem; padding:.7rem 1.4rem; background:#0d6b57; color:#fff!important; text-decoration:none; border-radius:8px; font-weight:700; font-size:.9rem; }
    .footer { padding:1rem 2rem; background:#f4f7f4; font-size:.8rem; color:#7a9a8a; text-align:center; }
    .badge { display:inline-block; padding:.2rem .6rem; border-radius:999px; font-size:.75rem; font-weight:800; background:#e8f0ec; color:#0d6b57; }
    .temp-pw { display:inline-block; font-family:monospace; font-size:1.1rem; font-weight:700; background:#f0f5f2; border:1px solid #c5ddd5; border-radius:6px; padding:.4rem .8rem; letter-spacing:.05em; color:#0d6b57; margin:.5rem 0; }
    .warning { background:#fff8e6; border-left:4px solid #f59e0b; padding:.7rem 1rem; border-radius:0 6px 6px 0; font-size:.88rem; margin-top:1rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🛒 FreshCart</h1>
      <p>${title}</p>
    </div>
    <div class="body">${body}</div>
    <div class="footer">FreshCart · Automated notification · Do not reply to this email</div>
  </div>
</body>
</html>`;
}

// ─── New order notification → store admin ─────────────────────────────────────
async function sendOrderNotification(order, adminEmail) {
  const rows = order.items
    .map(
      (i) =>
        `<tr>
          <td>${escapeHtml(i.name)}</td>
          <td style="text-align:center">${i.quantity}</td>
          <td style="text-align:right">${money.format(i.lineTotal)}</td>
        </tr>`
    )
    .join("");

  const body = `
    <h2>New order received <span class="badge">Order #${order._id.toString().slice(-6).toUpperCase()}</span></h2>
    <p>A customer has sent an order to <strong>${escapeHtml(order.storeName)}</strong>.</p>
    <p>
      <strong>Customer:</strong> ${escapeHtml(order.customer.name || "Not provided")}<br>
      <strong>Email:</strong> ${escapeHtml(order.customer.email)}<br>
      <strong>Phone:</strong> ${escapeHtml(order.customer.phone || "Not provided")}
    </p>
    ${order.customer.note ? `<p><strong>Note:</strong> ${escapeHtml(order.customer.note)}</p>` : ""}
    <table>
      <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td colspan="2">Order total</td><td style="text-align:right">${money.format(order.total)}</td></tr></tfoot>
    </table>
    <a class="btn" href="${process.env.CLIENT_URL}/admin.html">View in admin dashboard</a>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: adminEmail,
    subject: `New FreshCart order - ${order.storeName}`,
    html: emailWrapper("New order notification", body),
  });
}

// ─── Order email OTP → customer ───────────────────────────────────────────────
async function sendOrderOtpEmail(customerEmail, storeName, code) {
  const body = `
    <h2>Verify your email</h2>
    <p>Use this code to finish sending your order to <strong>${escapeHtml(storeName)}</strong>.</p>
    <div class="temp-pw">${escapeHtml(code)}</div>
    <p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: customerEmail,
    subject: `FreshCart verification code - ${storeName}`,
    html: emailWrapper("Order email verification", body),
  });
}

// ─── Temporary password → new store admin ─────────────────────────────────────
async function sendTempPasswordEmail(adminEmail, adminName, tempPassword, storeName) {
  const body = `
    <h2>Welcome to FreshCart, ${escapeHtml(adminName)}!</h2>
    <p>The super admin has created a store admin account for you to manage <strong>${escapeHtml(storeName)}</strong>.</p>
    <p>Your temporary login credentials:</p>
    <p><strong>Email:</strong> ${escapeHtml(adminEmail)}</p>
    <p><strong>Temporary password:</strong></p>
    <div class="temp-pw">${escapeHtml(tempPassword)}</div>
    <div class="warning">
      ⚠️ You will be prompted to set a new password immediately after your first login. This temporary password expires once changed.
    </div>
    <a class="btn" href="${process.env.CLIENT_URL}/admin.html">Log in to your dashboard</a>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: adminEmail,
    subject: `Your FreshCart admin account — ${storeName}`,
    html: emailWrapper("Admin account created", body),
  });
}

// ─── Password changed confirmation ────────────────────────────────────────────
async function sendPasswordChangedEmail(adminEmail, adminName) {
  const body = `
    <h2>Password updated</h2>
    <p>Hi ${escapeHtml(adminName)}, your FreshCart admin password was just changed successfully.</p>
    <p>If you did not make this change, please contact the super admin immediately.</p>
    <a class="btn" href="${process.env.CLIENT_URL}/admin.html">Go to dashboard</a>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: adminEmail,
    subject: "FreshCart — password changed",
    html: emailWrapper("Password updated", body),
  });
}

// ─── Password reset link ──────────────────────────────────────────────────────
async function sendPasswordResetEmail(adminEmail, adminName, resetUrl) {
  const body = `
    <h2>Reset your password</h2>
    <p>Hi ${escapeHtml(adminName)}, use the button below to set a new FreshCart password.</p>
    <p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>
    <a class="btn" href="${escapeHtml(resetUrl)}">Reset password</a>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: adminEmail,
    subject: "FreshCart - reset your password",
    html: emailWrapper("Password reset", body),
  });
}

// ─── Store request received confirmation → applicant ──────────────────────────
async function sendStoreRequestConfirmation(ownerEmail, ownerName, storeName) {
  const body = `
    <h2>Request received, ${escapeHtml(ownerName)}!</h2>
    <p>We've received your request to open <strong>${escapeHtml(storeName)}</strong> on FreshCart. Our team will review it and get back to you shortly.</p>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: ownerEmail,
    subject: "FreshCart — store request received",
    html: emailWrapper("Store request received", body),
  });
}

// ─── Store request approved → applicant ───────────────────────────────────────
async function sendStoreApprovedEmail(ownerEmail, ownerName, storeName, tempPassword) {
  const body = `
    <h2>You're approved, ${escapeHtml(ownerName)}! 🎉</h2>
    <p><strong>${escapeHtml(storeName)}</strong> has been approved and is now live on FreshCart.</p>
    <p>Your login credentials:</p>
    <p><strong>Email:</strong> ${escapeHtml(ownerEmail)}</p>
    <p><strong>Temporary password:</strong></p>
    <div class="temp-pw">${escapeHtml(tempPassword)}</div>
    <div class="warning">
      ⚠️ You'll be asked to set a permanent password on first login.
    </div>
    <a class="btn" href="${process.env.CLIENT_URL}/admin.html">Log in now</a>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: ownerEmail,
    subject: `FreshCart — ${storeName} is approved!`,
    html: emailWrapper("Store approved", body),
  });
}

module.exports = {
  sendOrderNotification,
  sendOrderOtpEmail,
  sendTempPasswordEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendStoreRequestConfirmation,
  sendStoreApprovedEmail,
};
