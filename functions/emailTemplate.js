function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('zh-TW');
}

export function generateEmailHTML(orderId, order) {
  const formattedDate = new Date(order.createdAt.toDate()).toLocaleString('zh-TW');

  const items = order.items || [];
  const totalTicketCount = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0
  );

  const itemRows = items
    .map((item, index) => {
      const subtotal =
        (Number(item.price) || 0) * (Number(item.quantity) || 0);

      const isLast = index === items.length - 1;

      return `
        <tr>
          <td
            style="
              padding:15px 0;
              font-size:13px;
              line-height:1.5;
              color:#f2f0e9;
              border-bottom:${isLast ? '0' : '1px solid rgba(242,240,233,.08)'};
            "
          >
            ${escapeHtml(item.name)}
          </td>

          <td
            style="
              padding:15px 0;
              font-size:13px;
              line-height:1.5;
              color:#f2f0e9;
              text-align:center;
              border-bottom:${isLast ? '0' : '1px solid rgba(242,240,233,.08)'};
            "
          >
            ${escapeHtml(item.quantity)}
          </td>

          <td
            style="
              padding:15px 0;
              font-size:13px;
              line-height:1.5;
              color:#f2f0e9;
              text-align:right;
              border-bottom:${isLast ? '0' : '1px solid rgba(242,240,233,.08)'};
            "
          >
            NT$ ${formatCurrency(subtotal)}
          </td>
        </tr>
      `;
    })
    .join('');

  const detailRows = [
    ['票券編號', escapeHtml(orderId), true],
    ['學校', escapeHtml(order.school)],
    order.class ? ['班級', escapeHtml(order.class)] : null,
    order.number ? ['座號', escapeHtml(order.number)] : null,
    order.customerName ? ['姓名', escapeHtml(order.customerName)] : null,
    ['購票時間', escapeHtml(formattedDate)]
  ].filter(Boolean);

  const detailRowsHTML = detailRows
    .map(
      ([label, value, mono], index) => `
        <tr>
          <td
            style="
              padding:13px 0;
              font-size:13px;
              line-height:1.5;
              color:#9aa3ac;
              width:90px;
              border-top:${index === 0 ? '0' : '1px solid rgba(242,240,233,.08)'};
            "
          >
            ${label}
          </td>

          <td
            style="
              padding:13px 0;
              font-size:13px;
              line-height:1.5;
              color:#f2f0e9;
              text-align:right;
              border-top:${index === 0 ? '0' : '1px solid rgba(242,240,233,.08)'};
              ${mono ? "font-family:'SF Mono',Consolas,monospace; letter-spacing:.02em;" : ''}
            "
          >
            ${value}
          </td>
        </tr>
      `
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>2026 建中舞會 COSMOS 購票成功通知</title>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link
    href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
    rel="stylesheet"
  >

  <style>
    :root {
      --void:#050608;
      --charcoal:#14171c;
      --lunar:#9aa3ac;
      --off-white:#f2f0e9;
      --ember:#e4a468;
      --line:rgba(242,240,233,.14);
      --line-soft:rgba(242,240,233,.08);
    }

    * {
      box-sizing:border-box;
    }

    html,
    body {
      margin:0;
      padding:0;
      background:#050608;
    }

    body {
      padding:40px 16px;
      color:#f2f0e9;
      font-family:'Manrope','Noto Sans TC',Arial,sans-serif;
      -webkit-font-smoothing:antialiased;
    }

    table {
      border-collapse:collapse;
    }

    img {
      border:0;
    }

    a {
      color:inherit;
      text-decoration:none;
    }

    .mail {
      width:100%;
      max-width:640px;
      margin:0 auto;
      background:#050608;
      border:1px solid rgba(242,240,233,.08);
      overflow:hidden;
    }

    .hero {
      position:relative;
      min-height:420px;
      overflow:hidden;
      display:flex;
      align-items:center;
      justify-content:center;

      background:
        radial-gradient(
          ellipse 65% 60% at 80% 28%,
          rgba(150,90,44,.28),
          transparent 65%
        ),
        radial-gradient(
          ellipse 45% 45% at 10% 65%,
          rgba(90,58,32,.18),
          transparent 70%
        ),
        linear-gradient(
          180deg,
          #030405 0%,
          #0a0e16 48%,
          #111822 100%
        );
    }

    .stars {
      position:absolute;
      inset:0;
      opacity:.85;

      background-image:
        radial-gradient(1.5px 1.5px at 8% 14%,#fff,transparent),
        radial-gradient(1.2px 1.2px at 18% 32%,#fff,transparent),
        radial-gradient(1.4px 1.4px at 27% 8%,#fff,transparent),
        radial-gradient(1px 1px at 36% 46%,#cfd6df,transparent),
        radial-gradient(1.8px 1.8px at 44% 18%,#fff,transparent),
        radial-gradient(1.1px 1.1px at 52% 36%,#fff,transparent),
        radial-gradient(1.3px 1.3px at 61% 12%,#fff,transparent),
        radial-gradient(1px 1px at 69% 27%,#cfd6df,transparent),
        radial-gradient(1.6px 1.6px at 78% 9%,#fff,transparent),
        radial-gradient(1.2px 1.2px at 85% 22%,#fff,transparent),
        radial-gradient(1.4px 1.4px at 92% 15%,#fff,transparent),
        radial-gradient(1px 1px at 6% 5%,#cfd6df,transparent);
    }

    .hero-content {
      position:relative;
      z-index:2;
      text-align:center;
      padding:56px 28px;
    }

    .eyebrow {
      margin:0 0 18px;
      font-size:11px;
      font-weight:700;
      line-height:1.4;
      letter-spacing:.32em;
      text-transform:uppercase;
      color:#9aa3ac;
    }

    .brand {
      margin:0;
      font-size:clamp(2.3rem,9vw,4rem);
      font-weight:400;
      line-height:1;
      letter-spacing:.42em;
      text-indent:.42em;
      white-space:nowrap;
      color:#f2f0e9;
    }

    .event {
      margin:20px 0 0;
      color:rgba(242,240,233,.62);
      font-size:13px;
      letter-spacing:.08em;
    }

    .divider {
      width:42px;
      height:1px;
      background:#e4a468;
      margin:28px auto 0;
    }

    .content {
      padding:42px 36px 0;
      background:#050608;
    }

    .section-label {
      margin:0 0 22px;
      color:#e4a468;
      font-size:11px;
      font-weight:700;
      line-height:1.4;
      letter-spacing:.28em;
      text-transform:uppercase;
    }

    h2 {
      margin:0 0 10px;
      color:#f2f0e9;
      font-family:'Noto Sans TC','Manrope',sans-serif;
      font-size:26px;
      font-weight:800;
      line-height:1.4;
      letter-spacing:.02em;
    }

    .intro {
      margin:0 0 30px;
      color:rgba(242,240,233,.58);
      font-size:13px;
      line-height:1.8;
    }

    .details {
      width:100%;
      margin-bottom:36px;
      border-top:1px solid rgba(242,240,233,.14);
      border-bottom:1px solid rgba(242,240,233,.14);
    }

    .tickets {
      width:100%;
      margin-bottom:0;
    }

    .tickets-head {
      border-bottom:1px solid rgba(242,240,233,.14);
    }

    .tickets-head td {
      padding:0 0 10px;
      color:#9aa3ac;
      font-size:10px;
      line-height:1.4;
      letter-spacing:.14em;
      text-transform:uppercase;
    }

    .ticket-table {
      width:100%;
      margin-bottom:0;
    }

    .ticket-table td {
      vertical-align:middle;
    }

    .center {
      text-align:center;
    }

    .right {
      text-align:right;
    }

    .total {
      width:100%;
      border-collapse:collapse;
    }

    .total td {
      padding:24px 0 34px;
      vertical-align:bottom;
    }

    .total-label {
      color:#f2f0e9;
      font-size:13px;
      font-weight:700;
    }

    .total-value {
      color:#f2f0e9;
      font-size:22px;
      font-weight:800;
    }

    .ticket-box {
      width:100%;
      border:1px dashed rgba(242,240,233,.28);
      background:rgba(242,240,233,.025);
      padding:28px 20px;
      text-align:center;
    }

    .ticket-title {
      margin:0 0 7px;
      color:#f2f0e9;
      font-size:14px;
      font-weight:700;
      line-height:1.5;
    }

    .ticket-note {
      margin:0 0 20px;
      color:#9aa3ac;
      font-size:11px;
      line-height:1.7;
    }

    .qr {
      width:150px;
      height:150px;
      margin:0 auto 14px;
      padding:10px;
      background:#fff;
    }

    .qr img {
      display:block;
      width:130px;
      height:130px;
      margin:0;
    }

    .qr-id {
      margin:0;
      color:#9aa3ac;
      font-family:'SF Mono',Consolas,monospace;
      font-size:10px;
      line-height:1.5;
      letter-spacing:.08em;
    }

    .feedback {
      margin-top:42px;
      padding:30px 0;
      border-top:1px solid rgba(242,240,233,.08);
    }

    .feedback .section-label {
      margin-bottom:16px;
    }

    .feedback p.description {
      margin:0 0 16px;
      color:rgba(242,240,233,.58);
      font-size:12px;
      line-height:1.8;
    }

    .button {
      display:inline-block;
      padding:11px 22px;
      border:1px solid rgba(242,240,233,.35);
      color:#f2f0e9;
      font-size:12px;
      font-weight:700;
      line-height:1.4;
      letter-spacing:.08em;
    }

    .button-arrow {
      color:#e4a468;
      margin-left:8px;
    }

    .footer {
      padding:22px 36px 30px;
      border-top:1px solid rgba(242,240,233,.08);
      background:#050608;
      color:#70757c;
      font-size:10.5px;
      line-height:1.8;
    }

    .footer a {
      color:#9aa3ac;
    }

    @media only screen and (max-width:640px) {
      body {
        padding:0;
      }

      .mail {
        border-left:0;
        border-right:0;
      }

      .hero {
        min-height:390px;
      }

      .content {
        padding:36px 22px 0;
      }

      .footer {
        padding-left:22px;
        padding-right:22px;
      }

      .brand {
        font-size:2.15rem;
        letter-spacing:.28em;
        text-indent:.28em;
      }
    }
  </style>
</head>

<body>

  <div
    style="
      display:none;
      max-height:0;
      overflow:hidden;
      opacity:0;
      color:transparent;
      font-size:1px;
      line-height:1px;
    "
  >
    您的 COSMOS 購票已確認，票券編號 ${escapeHtml(orderId)}，共 ${totalTicketCount} 張，總金額 NT$ ${formatCurrency(order.finalTotal)}
  </div>

  <div class="mail">

    <section class="hero">
      <div class="stars"></div>

      <div class="hero-content">

        <p class="eyebrow">
          2026 CK PARTY NIGHT
        </p>

        <h1 class="brand">
          COSMOS
        </h1>

        <p class="eyebrow" style="margin-top:20px;margin-bottom:0;">
          Confirmation Email
        </p>

      </div>
    </section>

    <main class="content">

      <p class="section-label">
        Ticket confirmed
      </p>

      <h2>
        購票成功
      </h2>

      <p class="intro">
        親愛的購票者您好：<br>
        感謝您使用建中舞會購票系統，以下是您的購票明細。
      </p>

      <table class="details" width="100%" cellpadding="0" cellspacing="0">
        ${detailRowsHTML}
      </table>

      <p class="section-label">
        Ticket details
      </p>

      <table
        class="tickets"
        width="100%"
        cellpadding="0"
        cellspacing="0"
      >
        <tr class="tickets-head">
          <td>
            票種
          </td>

          <td
            class="center"
            style="width:60px;"
          >
            張數
          </td>

          <td
            class="right"
            style="width:100px;"
          >
            小計
          </td>
        </tr>

        ${itemRows}
      </table>

      <table
        class="total"
        width="100%"
        cellpadding="0"
        cellspacing="0"
      >
        <tr>
          <td>
            <span class="total-label">
              票券總額
            </span>
          </td>

          <td class="right">
            <span class="total-value">
              NT$ ${formatCurrency(order.finalTotal)}
            </span>
          </td>
        </tr>
      </table>

      <table
        class="ticket-box"
        width="100%"
        cellpadding="0"
        cellspacing="0"
      >
        <tr>
          <td align="center">

            <p class="ticket-title">
              兌換憑證
            </p>

            <p class="ticket-note">
              請於於指定時間於指定地點出示此 QR Code 給工作人員兌換紙本票券
              <br>入場時須持紙本票券方可入場，敬請妥善保存。
            </p>

            <div class="qr">
              <img
                src="cid:qrcode"
                width="130"
                height="130"
                alt="票券 QR Code"
              >
            </div>

            <p class="qr-id">
              ${escapeHtml(orderId)}
            </p>

          </td>
        </tr>
      </table>

      <div class="feedback">

        <p class="section-label">
          Your feedback
        </p>

        <p class="description">
          為了讓我們持續改進購票體驗，誠摯邀請您填寫意見反饋表單。
        </p>

        <a
          class="button"
          href="https://souvenir.cksc.tw/survey"
          target="_blank"
        >
          填寫意見反饋
          <span class="button-arrow">↗</span>
        </a>

      </div>

    </main>

    <footer class="footer">

      2026 CK PARTY NIGHT · COSMOS<br>

      如有任何問題，歡迎寄信至
      <a href="mailto:ckhssc@gl.ck.tp.edu.tw">
        ckhssc@gl.ck.tp.edu.tw
      </a>
      聯繫我們，並請勿回復本自動寄送之郵件。

    </footer>

  </div>

</body>
</html>
  `;
}
