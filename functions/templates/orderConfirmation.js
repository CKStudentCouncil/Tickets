import {
  escapeHtml,
  C,
  FONT,
  renderEmail,
  intro,
  card,
  cardSection,
  sectionHeading,
  detailList,
  cardNote,
  cardFooter,
  actions,
  ticketHead,
  ticketQr
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

  const head = ticketHead({ title: '購票收據', orderId: safeOrderId, status: '訂單已成立' });
  const qr = ticketQr(safeOrderId);

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
          ${card(head + qr + buyer + tickets + cardNote('入場時須持紙本票券方可入場，敬請妥善保存') + cardFooter())}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;">
          ${actions(buttons, '為了讓我們持續改進購票體驗，誠摯邀請您填寫意見表單')}
        </td>
      </tr>
    </table>`;

  return renderEmail({
    title: '2026 建中舞會 COSMOS 購票成功通知',
    preheader: `您的 COSMOS 購票已確認，票券編號 ${safeOrderId}，共 ${totalTicketCount} 張，總金額 NT$ ${formatCurrency(order.finalTotal)}`,
    content,
    heroCaption: 'Confirmation'
  });
}
