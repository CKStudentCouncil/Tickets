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
  ticketHead
} from './shared.js';
import { CANCEL_REASONS, SITE_URL } from '../lib/constants.js';

// 訂單取消通知 (cancelOrders, functions/lib/orderCancel.js): sent to the
// buyer from the cancelledOrders/{id} copy. The admin's own note stays
// internal, as on the buyer's order page. How to reach the council is in the
// shared footer.

function formatCurrency(amount) {
  return (Number(amount) || 0).toLocaleString('zh-TW');
}

function formatDate(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  // Cloud Functions run in UTC, so always format in Taiwan time.
  return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

// Why a paid order keeps its money, by 銷售條款 article
function keptNote(reason) {
  if (reason === 'uncollected') return '依銷售條款第四條，經通知三次仍未領票者視同放棄該票券，已付款項不予退還';
  if (reason === 'violation') return '依銷售條款第四條，違反第七條者不退還已付款項';
  return '本訂單已付款項不予退還';
}

export function generateCancellationHTML(orderId, order, orderUrl = '') {
  const safeOrderId = escapeHtml(orderId);
  const items = Array.isArray(order.items) ? order.items : [];
  const ticketCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const reason = CANCEL_REASONS[order.cancelReason] || '其他';
  const paid = order.paid === true;
  const refund = Number(order.refundAmount) || 0;

  /* ---------- 01 the cancellation ---------- */

  const details = [
    ['取消原因', escapeHtml(reason)],
    ['取消時間', escapeHtml(formatDate(order.cancelledAt))],
    order.customerName ? ['姓名', escapeHtml(order.customerName)] : null,
    ['訂購時間', escapeHtml(formatDate(order.createdAt))]
  ].filter(Boolean);

  const about = cardSection(`
          ${sectionHeading('01', '取消資訊')}
          ${detailList(details)}`);

  /* ---------- 02 tickets ---------- */

  const itemRows = items
    .map((item) => {
      const price = Number(item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      const border = `border-bottom:1px solid ${C.cardLineSoft};`;
      return `
        <tr>
          <td valign="top" style="padding:14px 16px 14px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.lunar};text-decoration:line-through;word-break:break-word;${border}">
            ${escapeHtml(item.name)}&nbsp;&nbsp;×&nbsp;&nbsp;${quantity}
          </td>
          <td valign="top" align="right" style="padding:14px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.lunar};text-align:right;white-space:nowrap;${border}">
            NT$&nbsp;${formatCurrency(price * quantity)}
          </td>
        </tr>`;
    })
    .join('');

  const tickets = cardSection(`
          ${sectionHeading('02', '已取消的票券')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid ${C.cardLineSoft};">
            ${itemRows}
          </table>`);

  /* ---------- 03 money ---------- */

  // what was paid and what comes back; a paid order kept in full says so
  // instead of showing a refund of NT$ 0
  const moneyRows = !paid
    ? [['付款狀態', '未付款，無須付款']]
    : refund > 0
      ? [
          ['已付金額', `NT$&nbsp;${formatCurrency(order.finalTotal)}`],
          ['退款金額', `NT$&nbsp;${formatCurrency(refund)}`]
        ]
      : [
          ['已付金額', `NT$&nbsp;${formatCurrency(order.finalTotal)}`],
          ['退款', '不予退還']
        ];

  const money = cardSection(`
          ${sectionHeading('03', paid && refund > 0 ? '退款' : '款項')}
          ${detailList(moneyRows)}`);

  // an unpaid order has nothing more to say than the lead already does
  const note = paid && refund > 0
    ? '退款將依主辦單位公告之時間、地點及方式辦理，屆時請攜帶證件'
    : paid
      ? keptNote(order.cancelReason)
      : '';

  const buttons = [orderUrl ? { href: orderUrl, label: '查看訂單' } : null, { href: `${SITE_URL}/`, label: '前往購票系統' }].filter(Boolean);

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="padding:0;">
          ${intro({
            eyebrow: 'Order cancelled',
            heading: '訂單已取消',
            lead: `親愛的購票者您好：<br>您的訂單 ${safeOrderId} 已取消（${escapeHtml(reason)}），票券 QR Code 已失效，無法再兌換紙本票券`
          })}
        </td>
      </tr>
      <tr>
        <td style="padding:32px 0 0;">
          ${card(ticketHead({ title: '訂單取消通知', orderId: safeOrderId, status: '已取消' }) + about + tickets + money + (note ? cardNote(note) : '') + cardFooter())}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;">
          ${actions(buttons)}
        </td>
      </tr>
    </table>`;

  return renderEmail({
    title: '2026 建中舞會 COSMOS 訂單取消通知',
    preheader: `您的訂單 ${safeOrderId}（${ticketCount} 張）已取消：${escapeHtml(reason)}${paid ? (refund > 0 ? `，退款 NT$ ${formatCurrency(refund)}` : '，已付款項不予退還') : ''}`,
    content
  });
}
