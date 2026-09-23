function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlPreserveBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

const TYPE_LABELS = {
  payment: '繳費通知',
  pickup: '取票通知',
  both: '繳費暨取票通知',
  custom: '通知'
};

export function generateOrderNotificationHTML({
  type,
  paymentTime,
  pickupTime,
  location,
  message
}) {
  const label = TYPE_LABELS[type] || TYPE_LABELS.payment;
  const isCustom = type === 'custom';
  const showPayment = !isCustom && type !== 'pickup';
  const showPickup = !isCustom && type !== 'payment';

  const infoRows = [
    showPayment ? ['繳費時間', paymentTime] : null,
    showPickup ? ['取票時間', pickupTime] : null,
    !isCustom ? ['地點', location] : null
  ].filter(Boolean);

  const infoRowsHTML = infoRows
    .map(
      ([rowLabel, value], index) => `
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
            ${escapeHtml(rowLabel)}
          </td>

          <td
            style="
              padding:13px 0;
              font-size:13px;
              line-height:1.5;
              color:#f2f0e9;
              font-weight:700;
              text-align:right;
              border-top:${index === 0 ? '0' : '1px solid rgba(242,240,233,.08)'};
            "
          >
            ${escapeHtml(value)}
          </td>
        </tr>
      `
    )
    .join('');

  const preheaderParts = [];

  if (isCustom) {
    preheaderParts.push(
      escapeHtml(String(message || '').slice(0, 80))
    );
  } else {
    if (showPayment) {
      preheaderParts.push(`繳費時間：${escapeHtml(paymentTime)}`);
    }

    if (showPickup) {
      preheaderParts.push(`取票時間：${escapeHtml(pickupTime)}`);
    }

    preheaderParts.push(`地點：${escapeHtml(location)}`);
  }

  const bodyHTML = isCustom
    ? `
      <p
        style="
          margin:0;
          color:#f2f0e9;
          font-size:14px;
          line-height:1.8;
        "
      >
        ${escapeHtmlPreserveBreaks(message)}
      </p>
    `
    : `
      <p
        style="
          margin:0 0 30px;
          color:rgba(242,240,233,.58);
          font-size:13px;
          line-height:1.8;
        "
      >
        親愛的購票者您好：<br>
        請於以下時間、地點完成${showPayment && showPickup ? '繳費與取票' : showPickup ? '取票' : '繳費'}。
      </p>

      <table
        class="info-table"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        style="
          width:100%;
          margin-bottom:30px;
          border-top:1px solid rgba(242,240,233,.14);
          border-bottom:1px solid rgba(242,240,233,.14);
        "
      >
        ${infoRowsHTML}
      </table>

      ${
        message
          ? `
            <div
              style="
                padding-top:28px;
                border-top:1px solid rgba(242,240,233,.08);
              "
            >
              <p
                style="
                  margin:0 0 16px;
                  color:#e4a468;
                  font-size:11px;
                  font-weight:700;
                  line-height:1.4;
                  letter-spacing:.28em;
                  text-transform:uppercase;
                "
              >
                Information
              </p>

              <p
                style="
                  margin:0;
                  color:rgba(242,240,233,.58);
                  font-size:13px;
                  line-height:1.8;
                "
              >
                ${escapeHtmlPreserveBreaks(message)}
              </p>
            </div>
          `
          : ''
      }
    `;

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>${escapeHtml(label)} - 2026 CK PARTY NIGHT</title>

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
      min-height:360px;
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
      width:100%;
      padding:56px 28px;
      text-align:center;
    }

    .eyebrow {
      margin:0 0 18px;
      color:#9aa3ac;
      font-size:11px;
      font-weight:700;
      line-height:1.4;
      letter-spacing:.32em;
      text-transform:uppercase;
    }

    .brand {
      margin:0;
      color:#f2f0e9;
      font-size:clamp(2.3rem,9vw,4rem);
      font-weight:400;
      line-height:1;
      letter-spacing:.42em;
      text-indent:.42em;
      white-space:nowrap;
    }

    .notification-type {
      margin:22px 0 0;
      color:rgba(242,240,233,.62);
      font-size:12px;
      line-height:1.5;
      letter-spacing:.12em;
    }

    .divider {
      width:42px;
      height:1px;
      margin:28px auto 0;
      background:#e4a468;
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

    .info-box {
      width:100%;
      padding:28px 20px;
      border:1px dashed rgba(242,240,233,.28);
      background:rgba(242,240,233,.025);
    }

    .feedback {
      margin-top:42px;
      padding:30px 0;
      border-top:1px solid rgba(242,240,233,.08);
    }

    .feedback-description {
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
      margin-left:8px;
      color:#e4a468;
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
        min-height:340px;
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
    ${preheaderParts.join('，')}
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

        <p class="notification-type">
          ${escapeHtml(label)}
        </p>

      </div>

    </section>

    <main class="content">

      <p class="section-label">
        ${escapeHtml(label)}
      </p>

      <h2>
        ${isCustom ? '活動通知' : escapeHtml(label)}
      </h2>

      ${
        isCustom
          ? `
            <div class="info-box">
              ${bodyHTML}
            </div>
          `
          : bodyHTML
      }

      <div class="feedback">

        <p class="section-label">
          Your feedback
        </p>

        <p class="feedback-description">
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
