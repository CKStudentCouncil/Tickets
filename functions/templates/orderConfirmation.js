import {
  escapeHtml,
  C,
  FONT,
  MONO,
  renderEmail,
  intro,
  card,
  cardSection,
  sectionHeading,
  detailList,
  cardNote,
  cardFooter,
  actions
} from './shared.js';
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

// orderUrl: the buyer's order page (opened by signing in with the same account)
export function generateEmailHTML(orderId, order, orderUrl = '') {
  const safeOrderId = escapeHtml(orderId);
  const items = Array.isArray(order.items) ? order.items : [];

  const totalTicketCount = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0
  );

  /* ---------- receipt head: title and order number ---------- */

  const head = `
      <tr>
        <td class="card-px card-head" style="padding:28px 32px 24px;border-bottom:1px solid ${C.cardLine};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td class="stack" valign="bottom" style="padding:0;">
                <p style="margin:0 0 8px;font-family:${FONT};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:.18em;color:${C.ember};">
                  CK PARTY NIGHT
                </p>
                <p style="margin:0;font-family:${FONT};font-size:26px;font-weight:500;line-height:1.25;letter-spacing:-.01em;color:${C.text};">
                  購票收據
                </p>
              </td>
              <td class="stack stack-block" valign="bottom" align="right" style="padding:0 0 0 16px;text-align:right;">
                <p style="margin:0 0 5px;font-family:${FONT};font-size:10px;line-height:1.4;letter-spacing:.08em;color:${C.lunar};">
                  訂單編號
                </p>
                <p style="margin:0;font-family:${MONO};font-size:13px;font-weight:600;line-height:1.5;letter-spacing:.02em;color:${C.text};word-break:break-all;">
                  ${safeOrderId}
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
                <span style="font-size:8px;vertical-align:1px;">&#9679;</span>&nbsp;&nbsp;訂單已成立
              </td>
            </tr>
          </table>
        </td>
      </tr>`;

  /* ---------- QR code ---------- */

  const qr = cardSection(`
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
                  ${safeOrderId}
                </p>
              </td>
            </tr>
          </table>`);

  /* ---------- 01 buyer details ---------- */

  const details = [
    ['學校', escapeHtml(order.school)],
    order.class ? ['班級', escapeHtml(order.class)] : null,
    order.number ? ['座號', escapeHtml(order.number)] : null,
    order.office ? ['辦公室', escapeHtml(order.office)] : null,
    order.customerName ? ['姓名', escapeHtml(order.customerName)] : null,
    ['購票時間', escapeHtml(formatOrderDate(order.createdAt))]
  ].filter(Boolean);

  const buyer = cardSection(`
          ${sectionHeading('01', '購票資訊')}
          ${detailList(details)}`);

  /* ---------- 02 tickets and total ---------- */

  const itemRows = items
    .map((item) => {
      const price = Number(item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      const border = `border-bottom:1px solid ${C.cardLineSoft};`;

      return `
        <tr>
          <td valign="top" style="padding:16px 16px 16px 0;${border}">
            <p style="margin:0;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.5;color:${C.text};word-break:break-word;">
              ${escapeHtml(item.name)}
            </p>
            <p style="margin:4px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.lunar};">
              NT$&nbsp;${formatCurrency(price)}&nbsp;&nbsp;×&nbsp;&nbsp;${quantity}
            </p>
          </td>
          <td valign="top" align="right" style="padding:16px 0;font-family:${FONT};font-size:14px;font-weight:600;line-height:1.5;color:${C.text};text-align:right;white-space:nowrap;${border}">
            NT$&nbsp;${formatCurrency(price * quantity)}
          </td>
        </tr>`;
    })
    .join('');

  const tickets = cardSection(`
          ${sectionHeading('02', '票券明細')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid ${C.cardLineSoft};">
            ${itemRows}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
            <tr>
              <td valign="bottom" style="padding:22px 16px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.lunar};">
                應付總額<br>
                <span style="font-size:11px;color:${C.footerText};">共 ${totalTicketCount} 張</span>
              </td>
              <td class="total-value" valign="bottom" align="right" style="padding:22px 0 0;font-family:${FONT};font-size:26px;font-weight:600;line-height:1.2;letter-spacing:-.02em;color:${C.ember};text-align:right;white-space:nowrap;">
                NT$&nbsp;${formatCurrency(order.finalTotal)}
              </td>
            </tr>
          </table>`);

  /* ---------- page ---------- */

  const buttons = [
    orderUrl ? { href: orderUrl, label: '查看我的訂單' } : null,
    { href: `${SITE_URL}/survey`, label: '填寫意見反饋' }
  ].filter(Boolean);

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="padding:0;">
          ${intro({
            eyebrow: 'Order confirmed',
            heading: '購票成功',
            lead: '親愛的購票者您好：<br>感謝您使用建中舞會購票系統，以下是您的購票明細。'
          })}
        </td>
      </tr>
      <tr>
        <td style="padding:32px 0 0;">
          ${card(head + qr + buyer + tickets + cardNote('入場時須持紙本票券方可入場，敬請妥善保存。') + cardFooter())}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;">
          ${actions(buttons, '為了讓我們持續改進購票體驗，誠摯邀請您填寫意見反饋表單。')}
        </td>
      </tr>
    </table>`;

  return renderEmail({
    title: '2026 建中舞會 COSMOS 購票成功通知',
    preheader: `您的 COSMOS 購票已確認，票券編號 ${safeOrderId}，共 ${totalTicketCount} 張，總金額 NT$ ${formatCurrency(order.finalTotal)}`,
    content
  });
}
