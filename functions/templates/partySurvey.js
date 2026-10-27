import {
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

// 舞會滿意度調查 (functions/lib/partySurvey.js): sent to every buyer and
// 公關票 guest after the party, from /admin/party-survey through
// prepareOrderNotification (type survey). One link to /party-survey; the
// questions change every year, so the email only says what they cover.
export function generatePartySurveyInvitationHTML() {
  const about = cardSection(`
          ${sectionHeading('01', '關於這份問卷')}
          ${detailList([
            ['內容', '舞會現場、演出與購票系統的使用體驗'],
            ['填寫時間', '約需 5 分鐘'],
            ['填寫方式', '點選下方按鈕，登入帳號後於網頁上填寫']
          ])}`);

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      <tr>
        <td style="padding:0;">
          ${intro({
            eyebrow: 'Thank you for coming',
            heading: '感謝您的參與',
            lead: '親愛的參加者您好：<br>感謝您與我們一起參與了 2026 建中舞會 COSMOS！誠摯邀請您填寫舞會滿意度調查，您的每一則回饋都會成為下一屆舞會規劃的參考'
          })}
        </td>
      </tr>
      <tr>
        <td style="padding:32px 0 0;">
          ${card(
            about +
              cardNote('問卷不記名，回覆不會連結到您的帳號或訂單，資料僅用於活動檢討與改善；問卷關閉後將不再接受填寫') +
              cardFooter()
          )}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;">
          ${actions(
            [{ href: `${SITE_URL}/party-survey`, label: '填寫舞會滿意度調查' }],
            '期待下一屆舞會再與您相見'
          )}
        </td>
      </tr>
    </table>`;

  return renderEmail({
    title: '2026 建中舞會 COSMOS 滿意度調查',
    preheader: '感謝您參與 2026 建中舞會 COSMOS，邀請您花幾分鐘填寫舞會滿意度調查',
    content,
    heroCaption: 'Survey'
  });
}
