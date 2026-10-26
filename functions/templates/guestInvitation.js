import {
  escapeHtml,
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
import { SITE_URL, guestRelationText } from '../lib/constants.js';

// 公關票 (functions/lib/guests.js): the invitation sent in place of the
// purchase confirmation, with the same ticket QR code. It links to no order
// page: the shop may not be open yet when it is sent.
export function generateGuestInvitationHTML(orderId, order) {
  const safeOrderId = escapeHtml(orderId);
  const items = Array.isArray(order.items) ? order.items : [];
  const ticketCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const name = escapeHtml(order.customerName);
  const relation = guestRelationText(order.guest);

  const details = [
    order.customerName ? ['姓名', name] : null,
    relation ? ['身分', escapeHtml(relation)] : null,
    ['張數', `${ticketCount} 張`]
  ].filter(Boolean);

  const guest = cardSection(`
          ${sectionHeading('01', '來賓資訊')}
          ${detailList(details)}`);

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="padding:0;">
          ${intro({
            eyebrow: 'You are invited',
            heading: '誠摯邀請',
            lead: `${name ? `${name} 您好：` : '您好：'}<br>誠摯邀請您蒞臨 2026 建中舞會 COSMOS，以下是我們為您保留的公關票。`
          })}
        </td>
      </tr>
      <tr>
        <td style="padding:32px 0 0;">
          ${card(
            ticketHead({ title: '公關票', orderId: safeOrderId, status: '已為您保留' }) +
              ticketQr(safeOrderId) +
              guest +
              cardNote('入場時須持紙本票券方可入場，敬請妥善保存；此票券僅供受邀來賓使用') +
              cardFooter()
          )}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;">
          ${actions(
            [
              { href: `${SITE_URL}/lineup`, label: '社團與藝人' },
              { href: `${SITE_URL}/survey`, label: '填寫意見反饋' }
            ],
            '活動資訊與演出陣容請見舞會官網，期待與您相見'
          )}
        </td>
      </tr>
    </table>`;

  return renderEmail({
    title: '2026 建中舞會 COSMOS 公關票',
    preheader: `誠摯邀請您蒞臨 2026 建中舞會 COSMOS，公關票編號 ${safeOrderId}，共 ${ticketCount} 張`,
    content,
    heroCaption: 'Invitation'
  });
}
