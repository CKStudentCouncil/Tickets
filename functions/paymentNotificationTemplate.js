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

// Solid colours (no rgba) for rock-solid cross-client rendering
const C = {
  bg: '#050608',
  text: '#f2f0e9',
  muted: '#8e8e8a',
  lunar: '#9aa3ac',
  ember: '#e4a468',
  line: '#26292c',
  lineSoft: '#181a1d',
  dashed: '#474a4c',
  boxBg: '#0b0c0e',
  footer: '#70757c'
};

const FONT =
  "'Manrope','Noto Sans TC','PingFang TC','Microsoft JhengHei',Arial,sans-serif";

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
    .map(([rowLabel, value], index) => {
      const border = index === 0 ? '0' : `1px solid ${C.lineSoft}`;

      return `
        <tr>
          <td
            valign="top"
            width="90"
            style="
              padding:13px 12px 13px 0;
              width:90px;
              font-family:${FONT};
              font-size:13px;
              line-height:1.5;
              color:${C.lunar};
              border-top:${border};
              white-space:nowrap;
            "
          >
            ${escapeHtml(rowLabel)}
          </td>
          <td
            valign="top"
            align="right"
            style="
              padding:13px 0;
              font-family:${FONT};
              font-size:13px;
              line-height:1.5;
              color:${C.text};
              font-weight:700;
              text-align:right;
              border-top:${border};
              word-break:break-all;
            "
          >
            ${escapeHtml(value)}
          </td>
        </tr>`;
    })
    .join('');

  const preheaderParts = [];

  if (isCustom) {
    preheaderParts.push(escapeHtml(String(message || '').slice(0, 80)));
  } else {
    if (showPayment) preheaderParts.push(`繳費時間：${escapeHtml(paymentTime)}`);
    if (showPickup) preheaderParts.push(`取票時間：${escapeHtml(pickupTime)}`);
    preheaderParts.push(`地點：${escapeHtml(location)}`);
  }

  const sectionLabelStyle = `margin:0 0 22px;font-family:${FONT};font-size:11px;font-weight:700;line-height:1.4;letter-spacing:.28em;text-transform:uppercase;color:${C.ember};`;

  const bodyHTML = isCustom
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
        <tr>
          <td
            bgcolor="${C.boxBg}"
            style="
              padding:28px 20px;
              background:${C.boxBg};
              border:1px dashed ${C.dashed};
              font-family:${FONT};
              font-size:14px;
              line-height:1.8;
              color:${C.text};
            "
          >
            ${escapeHtmlPreserveBreaks(message)}
          </td>
        </tr>
      </table>
    `
    : `
      <p style="margin:0 0 30px;font-family:${FONT};font-size:13px;line-height:1.8;color:${C.muted};">
        親愛的購票者您好：<br>
        請於以下時間、地點完成${showPayment && showPickup ? '繳費與取票' : showPickup ? '取票' : '繳費'}。
      </p>

      <table
        role="presentation"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        border="0"
        style="
          width:100%;
          margin-bottom:30px;
          border-top:1px solid ${C.line};
          border-bottom:1px solid ${C.line};
        "
      >
        ${infoRowsHTML}
      </table>

      ${
        message
          ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr>
                <td style="padding-top:28px;border-top:1px solid ${C.lineSoft};">
                  <p style="${sectionLabelStyle.replace('margin:0 0 22px', 'margin:0 0 16px')}">
                    Information
                  </p>
                  <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.8;color:${C.muted};">
                    ${escapeHtmlPreserveBreaks(message)}
                  </p>
                </td>
              </tr>
            </table>
          `
          : ''
      }
    `;

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
  <title>${escapeHtml(label)} - 2026 CK PARTY NIGHT</title>

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
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background: ${C.bg};
    }

    * {
      -ms-text-size-adjust: 100%;
      -webkit-text-size-adjust: 100%;
      box-sizing: border-box;
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
    ${preheaderParts.join('，')}
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
                ${escapeHtml(label)}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="content-pad" style="padding:42px 36px 0;background:${C.bg};">

              <p style="${sectionLabelStyle}">
                ${escapeHtml(label)}
              </p>

              <h2 class="heading" style="margin:0 0 10px;font-family:${FONT};font-size:26px;font-weight:800;line-height:1.4;letter-spacing:.02em;color:${C.text};">
                ${isCustom ? '活動通知' : escapeHtml(label)}
              </h2>

              ${bodyHTML}

              <!-- Feedback -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:42px;">
                <tr>
                  <td style="padding:30px 0;border-top:1px solid ${C.lineSoft};">

                    <p style="${sectionLabelStyle.replace('margin:0 0 22px', 'margin:0 0 16px')}">
                      Your feedback
                    </p>

                    <p style="margin:0 0 16px;font-family:${FONT};font-size:12px;line-height:1.8;color:${C.muted};">
                      為了讓我們持續改進購票體驗，誠摯邀請您填寫意見反饋表單。
                    </p>

                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="border:1px solid #6e6f6d;">
                          <a
                            href="https://tickets.cksc.tw/survey"
                            target="_blank"
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