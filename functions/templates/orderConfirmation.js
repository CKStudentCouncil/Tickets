import { escapeHtml, C, FONT, MONO, sectionLabel } from './shared.js';
import { SITE_URL } from '../lib/constants.js';

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('zh-TW');
}

function formatOrderDate(createdAt) {
  let date = null;

  if (createdAt && typeof createdAt.toDate === 'function') {
    date = createdAt.toDate();
  } else if (createdAt) {
    date = new Date(createdAt);
  }

  if (!date || Number.isNaN(date.getTime())) return '';

  // Cloud Functions run in UTC, so always format in Taiwan time.
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

export function generateEmailHTML(orderId, order) {
  const formattedDate = formatOrderDate(order.createdAt);

  const items = Array.isArray(order.items) ? order.items : [];

  const totalTicketCount = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0
  );

  const itemRows = items
    .map((item, index) => {
      const subtotal =
        (Number(item.price) || 0) * (Number(item.quantity) || 0);

      const isLast = index === items.length - 1;

      const border = isLast ? '0' : `1px solid ${C.lineSoft}`;

      const cell = `padding:15px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.text};border-bottom:${border};`;

      return `
        <tr>
          <td style="${cell}word-break:break-word;">
            ${escapeHtml(item.name)}
          </td>
          <td align="center" width="56" style="${cell}text-align:center;width:56px;">
            ${escapeHtml(item.quantity)}
          </td>
          <td align="right" width="96" style="${cell}text-align:right;width:96px;white-space:nowrap;">
            NT$&nbsp;${formatCurrency(subtotal)}
          </td>
        </tr>`;
    })
    .join('');

  const detailRows = [
    ['票券編號', escapeHtml(orderId), true],
    ['學校', escapeHtml(order.school)],
    order.class ? ['班級', escapeHtml(order.class)] : null,
    order.number ? ['座號', escapeHtml(order.number)] : null,
    order.office ? ['辦公室', escapeHtml(order.office)] : null,
    order.customerName ? ['姓名', escapeHtml(order.customerName)] : null,
    ['購票時間', escapeHtml(formattedDate)]
  ].filter(Boolean);

  const detailRowsHTML = detailRows
    .map(([label, value, mono], index) => {
      const border = index === 0 ? '0' : `1px solid ${C.lineSoft}`;

      return `
        <tr>
          <td valign="top" width="84" style="padding:13px 12px 13px 0;width:84px;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.lunar};border-top:${border};white-space:nowrap;">
            ${label}
          </td>
          <td valign="top" align="right" style="padding:13px 0;font-family:${mono ? MONO : FONT};font-size:13px;line-height:1.5;color:${C.text};text-align:right;border-top:${border};word-break:break-all;${mono ? 'letter-spacing:.02em;' : ''}">
            ${value}
          </td>
        </tr>`;
    })
    .join('');

  // Padded with zero-width joiners + non-breaking spaces so Gmail (and
  // similar clients) can't fall through to whatever visible text happens
  // to come right after this block for their inbox-preview snippet.
  const preheaderPadding = '&zwnj;&nbsp;'.repeat(40);

  return `<!DOCTYPE html>
<html lang="zh-TW" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>2026 建中舞會 COSMOS 購票成功通知</title>

  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link
    href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
    rel="stylesheet"
  >

  <style>
    :root {
      color-scheme: dark;
      supported-color-schemes: dark;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background: ${C.bg};
    }

    * {
      -ms-text-size-adjust: 100%;
      -webkit-text-size-adjust: 100%;
    }

    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    table {
      border-collapse: collapse;
    }

    img {
      border: 0;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }

    /* Phones and narrow windows */
    @media only screen and (max-width: 640px) {
      .outer-pad {
        padding: 0 !important;
      }

      .mail {
        width: 100% !important;
        max-width: 100% !important;
        border-left: 0 !important;
        border-right: 0 !important;
      }

      .hero-pad {
        padding: 48px 20px !important;
      }

      .brand {
        font-size: 30px !important;
        letter-spacing: .22em !important;
        padding-left: .22em !important;
      }

      .content-pad {
        padding: 34px 22px 0 !important;
      }

      .footer-pad {
        padding: 22px 22px 30px !important;
      }

      .heading {
        font-size: 23px !important;
      }

      .total-value {
        font-size: 20px !important;
      }

      .ticket-pad {
        padding: 24px 14px !important;
      }

      .ticket-note {
        font-size: 12px !important;
      }
    }

    /* Very small phones */
    @media only screen and (max-width: 360px) {
      .brand {
        font-size: 26px !important;
      }

      .content-pad {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }

      .footer-pad {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }
    }
  </style>
</head>

<body style="margin:0;padding:0;background:${C.bg};">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">
    您的 COSMOS 購票已確認，票券編號 ${escapeHtml(orderId)}，共 ${totalTicketCount} 張，總金額 NT$ ${formatCurrency(order.finalTotal)}
    ${preheaderPadding}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
    <tr>
      <td align="center" class="outer-pad" style="padding:40px 16px;">

        <!--[if mso]>
        <table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td>
        <![endif]-->

        <table role="presentation" class="mail" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="width:100%;max-width:640px;background:${C.bg};border:1px solid ${C.lineSoft};">

          <!-- Hero -->
          <tr>
            <td
              class="hero-pad"
              align="center"
              bgcolor="#0a0e16"
              style="
                padding:64px 28px;
                background-color:#0a0e16;
                background-image:
                  radial-gradient(1.5px 1.5px at 8% 14%,#fff,transparent),
                  radial-gradient(1.2px 1.2px at 22% 32%,#fff,transparent),
                  radial-gradient(1.4px 1.4px at 36% 10%,#fff,transparent),
                  radial-gradient(1px 1px at 48% 48%,#cfd6df,transparent),
                  radial-gradient(1.8px 1.8px at 60% 18%,#fff,transparent),
                  radial-gradient(1.2px 1.2px at 74% 36%,#fff,transparent),
                  radial-gradient(1.6px 1.6px at 86% 12%,#fff,transparent),
                  radial-gradient(1.2px 1.2px at 94% 26%,#fff,transparent),
                  linear-gradient(180deg,#030405 0%,#0a0e16 55%,#111822 100%);
              "
            >
              <p style="margin:0 0 18px;font-family:${FONT};font-size:11px;font-weight:700;line-height:1.4;letter-spacing:.32em;text-transform:uppercase;color:${C.lunar};">
                2026 CK PARTY NIGHT
              </p>

              <h1 class="brand" style="margin:0;font-family:${FONT};font-size:44px;font-weight:400;line-height:1.1;letter-spacing:.36em;padding-left:.36em;color:${C.text};">
                COSMOS
              </h1>

              <table role="presentation" width="42" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:26px auto 0;">
                <tr>
                  <td height="1" style="height:1px;line-height:1px;font-size:1px;background:${C.ember};">&nbsp;</td>
                </tr>
              </table>

              <p style="margin:20px 0 0;font-family:${FONT};font-size:11px;font-weight:700;line-height:1.4;letter-spacing:.32em;text-transform:uppercase;color:${C.lunar};">
                Confirmation Email
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="content-pad" style="padding:42px 36px 0;background:${C.bg};">

              <p style="${sectionLabel()}">
                Ticket confirmed
              </p>

              <h2 class="heading" style="margin:0 0 10px;font-family:${FONT};font-size:26px;font-weight:800;line-height:1.4;letter-spacing:.02em;color:${C.text};">
                購票成功
              </h2>

              <p style="margin:0 0 30px;font-family:${FONT};font-size:13px;line-height:1.8;color:${C.muted};">
                親愛的購票者您好：<br>
                感謝您使用建中舞會購票系統，以下是您的購票明細。
              </p>

              <!-- Order details -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:36px;border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};">
                ${detailRowsHTML}
              </table>

              <p style="${sectionLabel()}">
                Ticket details
              </p>

              <!-- Ticket list -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td style="padding:0 0 10px;font-family:${FONT};font-size:10px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:${C.lunar};border-bottom:1px solid ${C.line};">
                    票種
                  </td>
                  <td align="center" width="56" style="padding:0 0 10px;width:56px;font-family:${FONT};font-size:10px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:${C.lunar};text-align:center;border-bottom:1px solid ${C.line};">
                    張數
                  </td>
                  <td align="right" width="96" style="padding:0 0 10px;width:96px;font-family:${FONT};font-size:10px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:${C.lunar};text-align:right;border-bottom:1px solid ${C.line};">
                    小計
                  </td>
                </tr>
                ${itemRows}
              </table>

              <!-- Total -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td valign="bottom" style="padding:24px 0 34px;font-family:${FONT};font-size:13px;font-weight:700;color:${C.text};">
                    票券總額
                  </td>
                  <td valign="bottom" align="right" class="total-value" style="padding:24px 0 34px;font-family:${FONT};font-size:22px;font-weight:800;color:${C.text};text-align:right;white-space:nowrap;">
                    NT$&nbsp;${formatCurrency(order.finalTotal)}
                  </td>
                </tr>
              </table>

              <!-- QR code -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td class="ticket-pad" align="center" bgcolor="${C.boxBg}" style="padding:28px 20px;background:${C.boxBg};border:1px dashed ${C.dashed};text-align:center;">

                    <p style="margin:0 0 7px;font-family:${FONT};font-size:14px;font-weight:700;line-height:1.5;color:${C.text};">
                      兌換憑證
                    </p>

                    <p class="ticket-note" style="margin:0 0 20px;font-family:${FONT};font-size:11px;line-height:1.7;color:${C.lunar};">
                      請於指定時間、地點出示此 QR Code 給工作人員兌換紙本票券。<br>
                      入場時須持紙本票券方可入場，敬請妥善保存。
                    </p>

                    <table role="presentation" width="150" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 14px;">
                      <tr>
                        <td bgcolor="#ffffff" style="padding:10px;background:#ffffff;">
                          <img
                            src="cid:qrcode"
                            width="130"
                            height="130"
                            alt="票券 QR Code"
                            style="display:block;width:130px;height:130px;border:0;"
                          >
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0;font-family:${MONO};font-size:10px;line-height:1.5;letter-spacing:.08em;color:${C.lunar};word-break:break-all;">
                      ${escapeHtml(orderId)}
                    </p>

                  </td>
                </tr>
              </table>

              <!-- Feedback -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:42px;">
                <tr>
                  <td style="padding:30px 0;border-top:1px solid ${C.lineSoft};">

                    <p style="${sectionLabel(16)}">
                      Your feedback
                    </p>

                    <p style="margin:0 0 16px;font-family:${FONT};font-size:12px;line-height:1.8;color:${C.muted};">
                      為了讓我們持續改進購票體驗，誠摯邀請您填寫意見反饋表單。
                    </p>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="border:1px solid #6e6f6d;">
                          <a
                            href="${SITE_URL}/survey"
                            target="_blank"
                            rel="noopener"
                            style="display:block;padding:11px 22px;font-family:${FONT};font-size:12px;font-weight:700;line-height:1.4;letter-spacing:.08em;color:${C.text};text-decoration:none;"
                          >
                            填寫意見反饋
                            <span style="color:${C.ember};margin-left:8px;">&#8599;</span>
                          </a>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="footer-pad" style="padding:22px 36px 30px;background:${C.bg};border-top:1px solid ${C.lineSoft};font-family:${FONT};font-size:10.5px;line-height:1.8;color:${C.footer};">
              2026 CK PARTY NIGHT · COSMOS<br>
              如有任何問題，歡迎寄信至
              <a href="mailto:ckhssc@gl.ck.tp.edu.tw" style="color:${C.lunar};text-decoration:none;">ckhssc@gl.ck.tp.edu.tw</a>
              聯繫我們，並請勿回復本自動寄送之郵件。
            </td>
          </tr>

        </table>

        <!--[if mso]>
        </td></tr></table>
        <![endif]-->

      </td>
    </tr>
  </table>

</body>
</html>`;
}
