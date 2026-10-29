// Layout, helpers and design tokens shared by every email template. The look
// follows the site's COSMOS theme: the homepage hero on top, the order receipt
// card in the middle and the site footer at the bottom.

import { readFileSync } from 'node:fs';

import { SITE_URL } from '../lib/constants.js';

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeHtmlPreserveBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

// The site's palette (src/css/mainlayout.scss). Its translucent lines and
// text are pre-blended onto the colour they sit on, since mail clients don't
// all handle rgba.
export const C = {
  void: '#050608',
  midnight: '#0d131f',
  surface: '#0d1015',
  qrBg: '#13161b',
  text: '#f2f0e9',
  muted: '#989793',
  lunar: '#9aa3ac',
  ember: '#e4a468',
  emberHover: '#efb77c',
  emberInk: '#111111',
  emberLine: '#6e533a',
  line: '#262729',
  cardLine: '#2d2f33',
  cardLineSoft: '#1f2226',
  qrLine: '#202328',
  footerLine: '#1f252f',
  footerText: '#7f8284',
  footerLink: '#a3a39f',
  footerFaint: '#5d6066'
};

export const FONT =
  "'Manrope','Noto Sans TC','PingFang TC','Microsoft JhengHei',Arial,sans-serif";

export const MONO = "'SF Mono',SFMono-Regular,Consolas,Menlo,monospace";

const HERO = readFileSync(new URL('./assets/hero.jpg', import.meta.url));

// Inline image referenced by the hero as cid:hero; every email that uses
// renderEmail() must attach it.
export function heroAttachment() {
  return {
    filename: 'cosmos.jpg',
    content: HERO,
    contentType: 'image/jpeg',
    cid: 'hero',
    contentDisposition: 'inline'
  };
}

// Arrow kept as text (not emoji) on iOS
const ARROW = '&#8599;&#65038;';

/* ---------- building blocks ---------- */

export function intro({ eyebrow, heading, lead = '' }) {
  return `
    <p style="margin:0 0 14px;font-family:${FONT};font-size:11px;font-weight:700;line-height:1.5;letter-spacing:.28em;text-transform:uppercase;color:${C.ember};">
      ${eyebrow}
    </p>
    <h2 class="display" style="margin:0;font-family:${FONT};font-size:32px;font-weight:800;line-height:1.25;letter-spacing:.02em;color:${C.text};">
      ${heading}
    </h2>
    ${lead ? `
    <p style="margin:14px 0 0;font-family:${FONT};font-size:13.5px;line-height:1.9;color:${C.muted};">
      ${lead}
    </p>` : ''}`;
}

// The receipt card from the order page: surface panel under a bright rule.
// `rows` are <tr> strings from the helpers below.
export function card(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="width:100%;background:${C.surface};border-top:2px solid ${C.text};">
      ${rows}
    </table>`;
}

export function cardSection(body, { divider = true, padding = '30px 32px' } = {}) {
  return `
      <tr>
        <td class="card-px" style="padding:${padding};${divider ? `border-bottom:1px solid ${C.cardLine};` : ''}">
          ${body}
        </td>
      </tr>`;
}

// "01  購票資訊" style heading used inside card sections
export function sectionHeading(index, title) {
  return `
    <p style="margin:0 0 20px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.4;letter-spacing:.02em;color:${C.text};">
      <span style="font-family:${MONO};font-size:11px;font-weight:400;letter-spacing:0;color:${C.ember};">${index}</span>
      <span style="padding-left:12px;">${title}</span>
    </p>`;
}

// Label / value rows. Values must already be escaped. `large` gives the
// values more weight and stacks each label above its value on phones.
export function detailList(rows, { large = false } = {}) {
  const html = rows
    .map(([label, value, { mono = false } = {}], index) => {
      const border = index === rows.length - 1 ? '' : `border-bottom:1px solid ${C.cardLineSoft};`;
      const labelClass = large ? 'stack stack-label' : '';
      const valueClass = large ? 'stack stack-value' : '';
      const valueFont = mono ? MONO : FONT;
      const valueSize = large ? 'font-size:16px;font-weight:700;' : 'font-size:13px;';

      return `
        <tr>
          <td class="${labelClass}" valign="top" width="110" style="width:110px;padding:13px 16px 13px 0;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.lunar};${border}">
            ${label}
          </td>
          <td class="${valueClass}" valign="top" style="padding:13px 0;font-family:${valueFont};${valueSize}line-height:1.6;color:${C.text};word-break:break-word;${border}">
            ${value}
          </td>
        </tr>`;
    })
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      ${html}
    </table>`;
}

// Top of a ticket card: title, order number and a status pill. Values must
// already be escaped.
export function ticketHead({ title, orderId, status }) {
  return `
      <tr>
        <td class="card-px card-head" style="padding:28px 32px 24px;border-bottom:1px solid ${C.cardLine};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td class="stack" valign="bottom" style="padding:0;">
                <p style="margin:0 0 8px;font-family:${FONT};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:.18em;color:${C.ember};">
                  CK PARTY NIGHT
                </p>
                <p style="margin:0;font-family:${FONT};font-size:26px;font-weight:500;line-height:1.25;letter-spacing:-.01em;color:${C.text};">
                  ${title}
                </p>
              </td>
              <td class="stack stack-block" valign="bottom" align="right" style="padding:0 0 0 16px;text-align:right;">
                <p style="margin:0 0 5px;font-family:${FONT};font-size:10px;line-height:1.4;letter-spacing:.08em;color:${C.lunar};">
                  訂單編號
                </p>
                <p style="margin:0;font-family:${MONO};font-size:13px;font-weight:600;line-height:1.5;letter-spacing:.02em;color:${C.text};word-break:break-all;">
                  ${orderId}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td class="card-px" style="padding:14px 32px;border-bottom:1px solid ${C.cardLineSoft};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding:5px 10px;border:1px solid ${C.emberLine};font-family:${FONT};font-size:11px;line-height:1.4;color:${C.ember};white-space:nowrap;">
                <span style="font-size:8px;vertical-align:1px;">&#9679;</span>&nbsp;&nbsp;${status}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

// The ticket QR code (attachment cid:qrcode) door staff scan. `orderId` must
// already be escaped.
export function ticketQr(orderId) {
  return cardSection(`
          ${sectionHeading('QR', '兌換憑證')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.qrBg}" style="width:100%;background:${C.qrBg};border:1px solid ${C.qrLine};">
            <tr>
              <td class="qr-pad" align="center" style="padding:28px 20px;text-align:center;">
                <!--[if mso]><table role="presentation" width="220" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
                <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:220px;margin:0 auto;">
                  <tr>
                    <td bgcolor="#ffffff" style="padding:12px;background:#ffffff;border-radius:12px;">
                      <img
                        src="cid:qrcode"
                        width="196"
                        height="196"
                        alt="票券 QR Code"
                        style="display:block;width:100%;max-width:196px;height:auto;border:0;"
                      >
                    </td>
                  </tr>
                </table>
                <!--[if mso]></td></tr></table><![endif]-->
                <p style="margin:16px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.8;color:${C.lunar};">
                  請於指定時間、地點出示此 QR Code<br>給工作人員兌換紙本票券。
                </p>
                <p style="margin:8px 0 0;font-family:${MONO};font-size:10px;line-height:1.5;letter-spacing:.08em;color:${C.footerText};word-break:break-all;">
                  ${orderId}
                </p>
              </td>
            </tr>
          </table>`);
}

// NOTE row between the last section and the card footer
export function cardNote(text) {
  return `
      <tr>
        <td class="card-px" style="padding:0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-bottom:1px solid ${C.cardLine};">
            <tr>
              <td class="stack stack-label" valign="top" width="80" style="width:80px;padding:22px 16px 22px 0;font-family:${FONT};font-size:10px;font-weight:700;line-height:1.9;letter-spacing:.15em;color:${C.ember};">
                NOTE
              </td>
              <td class="stack stack-value" valign="top" style="padding:22px 0;font-family:${FONT};font-size:12.5px;line-height:1.8;color:${C.lunar};word-break:break-word;">
                ${text}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

export function cardFooter() {
  const cell = `font-family:${FONT};font-size:10px;line-height:1.6;letter-spacing:.03em;color:${C.lunar};`;

  return `
      <tr>
        <td class="card-px" style="padding:16px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td class="stack" style="${cell}">臺北市立建國高級中學班聯會</td>
              <td class="stack stack-after" align="right" style="${cell}text-align:right;">CK PARTY NIGHT 2026 · COSMOS</td>
            </tr>
          </table>
        </td>
      </tr>`;
}

// Stacked call-to-action buttons, like the order success page: the first is
// the solid ember one, the rest are outlined.
export function actions(buttons, note = '') {
  const rows = buttons
    .map(({ href, label }, index) => {
      const primary = index === 0;
      const cellStyle = primary
        ? `background:${C.ember};border:1px solid ${C.ember};`
        : `border:1px solid ${C.cardLine};`;
      const linkStyle = primary
        ? `background:${C.ember};color:${C.emberInk};`
        : `color:${C.text};`;
      const arrowColor = primary ? C.emberInk : C.ember;

      return `
        ${index > 0 ? '<tr><td height="12" style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>' : ''}
        <tr>
          <td class="${primary ? 'btn-primary' : 'btn-ghost'}" align="center" ${primary ? `bgcolor="${C.ember}"` : ''} style="${cellStyle}">
            <a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:block;padding:15px 20px;font-family:${FONT};font-size:13px;font-weight:700;line-height:1.4;letter-spacing:.06em;text-align:center;text-decoration:none;${linkStyle}">
              ${label}<span style="padding-left:10px;color:${arrowColor};">${ARROW}</span>
            </a>
          </td>
        </tr>`;
    })
    .join('');

  // Fluid up to 320px; Outlook ignores max-width, so it gets a fixed table
  return `
    <!--[if mso]><table role="presentation" width="320" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" class="btn-table" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:320px;margin:0 auto;">
      ${rows}
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
    ${note ? `
    <p style="margin:18px auto 0;max-width:320px;font-family:${FONT};font-size:11.5px;line-height:1.8;text-align:center;color:${C.lunar};">
      ${note}
    </p>` : ''}`;
}

/* ---------- page shell ---------- */

function footer() {
  const link = `color:${C.footerLink};text-decoration:none;`;
  const sep = `<span style="padding:0 10px;color:${C.footerFaint};">/</span>`;

  return `
          <tr>
            <td class="footer-pad" bgcolor="${C.midnight}" style="padding:36px 40px 40px;border-top:1px solid ${C.footerLine};">
              <p style="margin:0 0 6px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.5;letter-spacing:.02em;color:${C.text};">
                建中舞會購票系統
              </p>
              <p style="margin:0 0 22px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.footerText};">
                Taipei Municipal Chien Kuo High School Student Council
              </p>
              <p style="margin:0 0 26px;font-family:${FONT};font-size:11px;font-weight:600;line-height:2;letter-spacing:.1em;">
                <a href="${SITE_URL}" target="_blank" rel="noopener" style="${link}">首頁</a>${sep}<a href="${SITE_URL}/orders" target="_blank" rel="noopener" style="${link}">已購門票</a>${sep}<a href="${SITE_URL}/policy" target="_blank" rel="noopener" style="${link}">銷售條款</a>${sep}<a href="${SITE_URL}/terms" target="_blank" rel="noopener" style="${link}">使用者條款</a>
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td style="padding-top:22px;border-top:1px solid ${C.footerLine};font-family:${FONT};font-size:11px;line-height:1.8;color:${C.footerText};">
                    如有任何問題，歡迎寄信至
                    <a href="mailto:ckhssc@gl.ck.tp.edu.tw" style="color:${C.lunar};text-decoration:none;">ckhssc@gl.ck.tp.edu.tw</a>
                    聯繫我們。本郵件由系統自動寄送，請勿直接回覆。
                    <br>
                    <span style="color:${C.footerFaint};">© ${new Date().getFullYear()} CK Tickets. All rights reserved.</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

// Full document: head, hidden preheader, hero, `content` and the footer.
// `title` and `preheader` must already be escaped. `heroCaption` is the line
// under COSMOS that names the kind of email (Confirmation, Notification).
export function renderEmail({ title, preheader, content, heroCaption }) {
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
  <title>${title}</title>

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
    href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
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
      background: ${C.void};
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

    .btn-primary:hover,
    .btn-primary:hover a {
      background: ${C.emberHover} !important;
      border-color: ${C.emberHover} !important;
    }

    .btn-ghost:hover {
      border-color: ${C.emberLine} !important;
    }

    .btn-ghost:hover a {
      color: ${C.ember} !important;
    }

    /* Phones and narrow windows */
    @media only screen and (max-width: 640px) {
      .outer-pad {
        padding: 0 !important;
      }

      .mail {
        border: 0 !important;
      }

      .content-pad {
        padding: 36px 20px 44px !important;
      }

      .display {
        font-size: 28px !important;
      }

      .card-px {
        padding-left: 20px !important;
        padding-right: 20px !important;
      }

      .card-head {
        padding-top: 24px !important;
      }

      .stack {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
      }

      .stack-label {
        padding-bottom: 0 !important;
        border-bottom: 0 !important;
      }

      .stack-value {
        padding-top: 4px !important;
      }

      .stack-after {
        padding-top: 4px !important;
      }

      .stack-block {
        padding-top: 16px !important;
        padding-left: 0 !important;
      }

      .total-value {
        font-size: 22px !important;
      }

      .btn-table {
        max-width: 100% !important;
      }

      .footer-pad {
        padding: 32px 20px 36px !important;
      }
    }

    /* Very small phones */
    @media only screen and (max-width: 380px) {
      .content-pad,
      .footer-pad {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }

      .card-px {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }

      .qr-pad {
        padding-left: 12px !important;
        padding-right: 12px !important;
      }
    }
  </style>
</head>

<body id="body" style="margin:0;padding:0;background:${C.void};">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">
    ${preheader}
    ${preheaderPadding}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.void}" style="background:${C.void};">
    <tr>
      <td align="center" class="outer-pad" style="padding:40px 0;">

        <!--[if mso]>
        <table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td>
        <![endif]-->

        <table role="presentation" class="mail" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.void}" style="width:100%;max-width:640px;background:${C.void};border:1px solid ${C.line};">

          <!-- Hero: the homepage poster with the COSMOS lockup, then the email's caption -->
          <tr>
            <td bgcolor="${C.void}" style="padding:0;font-size:0;line-height:0;background:${C.void};">
              <img
                src="cid:hero"
                width="640"
                height="380"
                alt="2026 CK PARTY NIGHT · COSMOS"
                style="display:block;width:100%;max-width:640px;height:auto;border:0;color:${C.text};font-family:${FONT};font-size:16px;line-height:1.4;text-align:center;"
              >
            </td>
          </tr>
          <tr>
            <td align="center" bgcolor="${C.void}" style="padding:0 24px;background:${C.void};text-align:center;">
              <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;letter-spacing:.05em;color:${C.muted};">
                ${heroCaption}
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="content-pad" bgcolor="${C.void}" style="padding:44px 40px 52px;background:${C.void};">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          ${footer()}

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
