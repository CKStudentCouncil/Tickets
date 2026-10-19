import { EVENT_DATE_LONG, EVENT_VENUE } from 'src/config/app'
import { SCHOOL_ACCOUNT_DOMAIN } from 'src/data/schools'

// 購票教學: opens on a visitor's first visit, then from the ? in the header
export const BUY_GUIDE_STEPS = [
  {
    title: '登入 Google 帳號',
    lines: [
      '購票前請先從右上角選單登入 Google 帳號，訂單會綁定這個帳號',
      `限建中學生的票種，須使用建中帳號（@${SCHOOL_ACCOUNT_DOMAIN}）登入才能購買`
    ]
  },
  {
    title: '選擇票種',
    lines: [
      '在首頁「GET YOUR TICKETS」選擇要購買的票種',
      '購買前請確認價格、購買資格與每人限購張數；開賣前網站會顯示倒數'
    ]
  },
  {
    title: '填寫訂購資訊',
    lines: [
      '依序填寫數量、學校／身分、班級座號、姓名與電話',
      '確認應付金額，勾選同意銷售條款與使用者條款，通過驗證後按「確認送出訂單」'
    ]
  },
  {
    title: '保存 QR Code',
    lines: [
      '訂單成立後，確認信會寄到你登入的 Email，信中附有訂單 QR Code',
      '也可以隨時在選單的「已購門票」查看訂單與 QR Code'
    ]
  },
  {
    title: '現場付款與領票',
    lines: [
      '目前僅提供現場付款；請留意建中班聯會或友校班聯會、代聯會、學生會公告的時間與地點',
      '付款、領票時請出示 QR Code 與學生證等身分證件，工作人員掃描後交付紙本票券'
    ]
  },
  {
    title: '憑紙本票券入場',
    lines: [
      `舞會於 ${EVENT_DATE_LONG}在${EVENT_VENUE}舉行，入場時須持紙本票券`,
      '紙本票券請妥善保存。之後可隨時按右上角的「?」再看一次教學'
    ]
  }
]
