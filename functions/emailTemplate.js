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
  const itemRows = items
    .map((item, index) => {
      const subtotal = (Number(item.price) || 0) * (Number(item.quantity) || 0);
      const isLast = index === items.length - 1;
      return `
        <tr>
          <td style="padding: 10px 0; font-size: 14px; border-bottom: ${isLast ? 'none' : '1px solid #f0f0f0'};">${escapeHtml(item.name)}</td>
          <td style="padding: 10px 0; font-size: 14px; text-align: center; border-bottom: ${isLast ? 'none' : '1px solid #f0f0f0'};">${escapeHtml(item.quantity)}</td>
          <td style="padding: 10px 0; font-size: 14px; text-align: right; border-bottom: ${isLast ? 'none' : '1px solid #f0f0f0'};">NT$ ${formatCurrency(subtotal)}</td>
        </tr>`;
    })
    .join('');

  const detailRows = [
    ['訂單編號', escapeHtml(orderId), true],
    ['學校', escapeHtml(order.school)],
    order.class ? ['班級', escapeHtml(order.class)] : null,
    order.number ? ['座號', escapeHtml(order.number)] : null,
    order.customerName ? ['姓名', escapeHtml(order.customerName)] : null,
    ['訂單時間', escapeHtml(formattedDate)]
  ].filter(Boolean);

  const detailRowsHTML = detailRows
    .map(
      ([label, value, mono], index) => `
      <tr style="${index === 0 ? '' : 'border-top: 1px solid #f0f0f0;'}">
        <td style="padding: 8px 0; font-size: 13px; color: #6e6e73; width: 90px;">${label}</td>
        <td style="padding: 8px 0; font-size: 13px; ${mono ? "font-family: 'SF Mono', Consolas, monospace;" : ''}">${value}</td>
      </tr>`
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>訂單確認 - ${escapeHtml(orderId)}</title>
      <style>
        body { margin: 0; padding: 0; background: #f2f2f2; font-family: Arial, 'PingFang TC', 'Microsoft JhengHei', 'Helvetica Neue', sans-serif; color: #1d1d1f; }
        table { border-collapse: collapse; }
        img { border: 0; }
      </style>
    </head>
    <body>
      <!-- preheader: shown in inbox preview, hidden in the email body -->
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
        訂單 ${escapeHtml(orderId)} 已確認，總金額 NT$ ${formatCurrency(order.finalTotal)}
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f2f2f2; padding: 24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background: #ffffff; border: 1px solid #e5e5e7; border-radius: 12px; overflow: hidden;">

              <tr>
                <td style="background: #1d1d1f; padding: 24px 28px;">
                  <p style="margin: 0; color: #ffffff; font-size: 13px; letter-spacing: .02em; opacity: .7;">訂單確認</p>
                  <p style="margin: 6px 0 0; color: #ffffff; font-size: 20px; font-weight: 700;">建中校慶紀念品</p>
                </td>
              </tr>

              <tr>
                <td style="padding: 28px;">
                  <p style="margin: 0 0 4px; font-size: 15px;">親愛的訂購者您好：</p>
                  <p style="margin: 0 0 24px; font-size: 14px; color: #6e6e73;">感謝您訂購建中校慶紀念品，以下是您的訂單明細：</p>

                  <table width="100%" style="margin-bottom: 24px;">
                    ${detailRowsHTML}
                  </table>

                  <p style="margin: 0 0 10px; font-size: 14px; font-weight: 700;">商品清單</p>
                  <table width="100%" style="margin-bottom: 16px;">
                    <tr style="border-bottom: 1px solid #e5e5e7;">
                      <td style="padding: 8px 0; font-size: 12px; color: #6e6e73;">品項</td>
                      <td style="padding: 8px 0; font-size: 12px; color: #6e6e73; text-align: center;">數量</td>
                      <td style="padding: 8px 0; font-size: 12px; color: #6e6e73; text-align: right;">小計</td>
                    </tr>
                    ${itemRows}
                  </table>

                  <table width="100%" style="margin-bottom: 24px;">
                    <tr>
                      <td style="padding: 10px 0; font-size: 15px; font-weight: 700;">訂單總額</td>
                      <td style="padding: 10px 0; font-size: 18px; font-weight: 700; text-align: right;">NT$ ${formatCurrency(order.finalTotal)}</td>
                    </tr>
                  </table>

                  <table width="100%">
                    <tr>
                      <td align="center" style="padding: 20px; border: 1px dashed #c7c7cc; border-radius: 12px;">
                        <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700;">取貨憑證</p>
                        <p style="margin: 0 0 4px; font-size: 14px; font-weight: 700;">請出示此 QR Code 給現場工作人員</p>
                        <p style="margin: 0 0 16px; font-size: 12px; color: #6e6e73;">請於取貨時出示此 QR Code</p>
                        <img src="cid:qrcode" width="140" height="140" background-color="#ffffff" alt="訂單 QR Code" style="display: block; margin: 0 auto; border-radius: 8px;" />
                      </td>
                    </tr>
                  </table>
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
