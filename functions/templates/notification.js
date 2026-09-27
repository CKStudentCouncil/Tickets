import {
  escapeHtml,
  escapeHtmlPreserveBreaks,
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
  actions
} from './shared.js';
import { SITE_URL } from '../lib/constants.js';

const TYPE_LABELS = {
  payment: '繳費通知',
  pickup: '取票通知',
  both: '繳費暨取票通知',
  custom: '通知'
};

const TYPE_EYEBROWS = {
  payment: 'Payment notice',
  pickup: 'Pickup notice',
  both: 'Payment & pickup',
  custom: 'Notice'
};

export function generateOrderNotificationHTML({
  type,
  paymentTime,
  pickupTime,
  location,
  message
}) {
  const knownType = TYPE_LABELS[type] ? type : 'payment';
  const label = TYPE_LABELS[knownType];
  const isCustom = knownType === 'custom';
  const showPayment = !isCustom && knownType !== 'pickup';
  const showPickup = !isCustom && knownType !== 'payment';

  const preheaderParts = [];

  if (isCustom) {
    preheaderParts.push(escapeHtml(String(message || '').slice(0, 80)));
  } else {
    if (showPayment) preheaderParts.push(`繳費時間：${escapeHtml(paymentTime)}`);
    if (showPickup) preheaderParts.push(`取票時間：${escapeHtml(pickupTime)}`);
    preheaderParts.push(`地點：${escapeHtml(location)}`);
  }

  let cardRows;

  if (isCustom) {
    cardRows = cardSection(`
          ${sectionHeading('01', '通知內容')}
          <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.9;color:${C.text};word-break:break-word;">
            ${escapeHtmlPreserveBreaks(message)}
          </p>`);
  } else {
    const schedule = [
      showPayment ? ['繳費時間', escapeHtml(paymentTime)] : null,
      showPickup ? ['取票時間', escapeHtml(pickupTime)] : null,
      ['地點', escapeHtml(location)]
    ].filter(Boolean);

    cardRows =
      cardSection(`
          ${sectionHeading('01', '時間與地點')}
          ${detailList(schedule, { large: true })}`) +
      (message ? cardNote(escapeHtmlPreserveBreaks(message)) : '');
  }

  const task = showPayment && showPickup ? '繳費與取票' : showPickup ? '取票' : '繳費';

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="padding:0;">
          ${intro({
            eyebrow: TYPE_EYEBROWS[knownType],
            heading: isCustom ? '活動通知' : label,
            lead: isCustom ? '' : `親愛的購票者您好：<br>請於以下時間、地點完成${task}。`
          })}
        </td>
      </tr>
      <tr>
        <td style="padding:32px 0 0;">
          ${card(cardRows + cardFooter())}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;">
          ${actions(
            [
              { href: `${SITE_URL}/orders`, label: '查看已購門票' },
              { href: `${SITE_URL}/survey`, label: '填寫意見反饋' }
            ],
            '為了讓我們持續改進購票體驗，誠摯邀請您填寫意見反饋表單。'
          )}
        </td>
      </tr>
    </table>`;

  return renderEmail({
    title: `${label} - 2026 CK PARTY NIGHT`,
    preheader: preheaderParts.join('，'),
    content
  });
}
