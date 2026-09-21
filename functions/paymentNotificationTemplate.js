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
  pickup: '領貨通知',
  both: '繳費暨領貨通知',
  custom: '通知'
};

export function generateOrderNotificationHTML({ type, paymentTime, pickupTime, location, message }) {
  const label = TYPE_LABELS[type] || TYPE_LABELS.payment;
  const isCustom = type === 'custom';
  const showPayment = !isCustom && type !== 'pickup';
  const showPickup = !isCustom && type !== 'payment';

  const infoRows = [
    showPayment ? ['繳費時間', paymentTime] : null,
    showPickup ? ['領貨時間', pickupTime] : null,
    !isCustom ? ['地點', location] : null
  ].filter(Boolean);

  const infoRowsHTML = infoRows
    .map(
      ([rowLabel, value], index) => `
        <tr${index === 0 ? '' : ' style="border-top: 1px solid #f0f0f0;"'}>
          <td style="padding: 9px 0; font-size: 13px; color: #6e6e73; width: 90px;">${escapeHtml(rowLabel)}</td>
          <td style="padding: 9px 0; font-size: 14px; color: #1d1d1f; font-weight: 700;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  const preheaderParts = [];
  if (isCustom) {
    preheaderParts.push(message.slice(0, 80));
  } else {
    if (showPayment) preheaderParts.push(`繳費時間：${escapeHtml(paymentTime)}`);
    if (showPickup) preheaderParts.push(`領貨時間：${escapeHtml(pickupTime)}`);
    preheaderParts.push(`地點：${escapeHtml(location)}`);
  }

  const bodyHTML = isCustom
    ? `<p style="margin: 0; font-size: 14px; color: #1d1d1f; line-height: 1.7; white-space: pre-line;">${escapeHtmlPreserveBreaks(message)}</p>`
    : `
      <p style="margin: 0 0 20px; font-size: 14px; color: #6e6e73; line-height: 1.6;">親愛的訂購者您好，請於以下時間、地點完成${showPayment && showPickup ? '繳費與領貨' : showPickup ? '領貨' : '繳費'}：</p>

      <table width="100%" style="margin-bottom: 20px; border: 1px solid #e5e5e7; border-radius: 12px; padding: 4px 14px;" cellpadding="0" cellspacing="0">
        ${infoRowsHTML}
      </table>

      ${
        message
          ? `<p style="margin: 0 0 4px; font-size: 13px; color: #1d1d1f; font-weight: 700;">說明</p>
             <p style="margin: 0; font-size: 13px; color: #6e6e73; line-height: 1.6;">${escapeHtml(message)}</p>`
          : ''
      }`;

  return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${escapeHtml(label)}</title>
      <style>
        body { margin: 0; padding: 0; background: #f2f2f2; font-family: -apple-system, BlinkMacSystemFont, Arial, 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei', 'Helvetica Neue', sans-serif; color: #1d1d1f; }
        table { border-collapse: collapse; }
        img { border: 0; }
      </style>
    </head>
    <body>
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        ${preheaderParts.join('，')}
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f2f2f2; padding: 24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background: #ffffff; border: 1px solid #e5e5e7; border-radius: 20px; overflow: hidden;">

              <tr>
                <td style="background: #1d1d1f; padding: 28px;">
                  <p style="margin: 0; color: #ffffff; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .6;">${escapeHtml(label)}</p>
                  <p style="margin: 8px 0 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -.01em;">建中校慶紀念品</p>
                </td>
              </tr>

              <tr>
                <td style="padding: 28px;">
                  ${bodyHTML}
                </td>
              </tr>

              <tr>
                <td style="padding: 28px; border-top: 1px solid #f0f0f0;">
                  <p style="margin: 0 0 12px; font-size: 14px; font-weight: 700;">需要您的回饋</p>
                  <p style="margin: 0 0 12px; font-size: 13px; color: #6e6e73; line-height: 1.6;">為了讓我們持續改進服務，誠摯邀請您填寫意見反饋表單</p>
                  <table width="100%">
                    <tr>
                      <td align="center">
                        <a href="https://souvenir.cksc.tw/survey" style="display: inline-block; padding: 10px 24px; background: #1d1d1f; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 700;">填寫意見反饋</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="padding: 20px 28px; border-top: 1px solid #f0f0f0; background: #fafafa;">
                  <p style="margin: 0; font-size: 12px; color: #8e8e93; line-height: 1.6;">如有任何問題，歡迎寄信至 ckhssc@gl.ck.tp.edu.tw 聯繫我們，並請勿回復本自動寄送之郵件。</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}