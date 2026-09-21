export const IDENTITY_OPTIONS = [
  '建國中學學生',
  '建國中學家長',
  '建國中學教師',
  '北一女中學生',
  '中山女高學生',
  '景美女中學生',
  '成功高中學生',
  '師大附中學生',
  '其他學校學生',
  '社會人士',
  '其他'
]

export const CHANNEL_OPTIONS = [
  '班聯會官方 Instagram',
  'CK APP',
  '班代或班級轉知',
  '同學或朋友分享',
  '建中相關社群',
  '搜尋引擎',
  '其他'
]

export const DEVICE_OPTIONS = ['手機', '平板', '筆記型電腦', '桌上型電腦', '其他']

export const ISSUE_COUNT_OPTIONS = ['沒有遇到問題', '遇到過一次', '遇到過 2～3 次', '遇到過 4 次以上']

export const ISSUE_TYPE_OPTIONS = [
  '找不到商品',
  '商品資訊不清楚',
  '購物車操作',
  '填寫訂購資料',
  '訂單送出',
  '訂單確認',
  '網頁載入速度',
  '手機版介面',
  '登入或帳號',
  '其他'
]

export const SCALE_SECTIONS = [
  {
    key: 'usability',
    title: '系統使用體驗',
    questions: [
      { id: 'q4', text: '我能快速理解本系統的操作方式' },
      { id: 'q5', text: '系統介面與功能配置容易理解' },
      { id: 'q6', text: '我能順利找到想購買的商品' },
      { id: 'q7', text: '我能快速找到訂購所需的資訊' },
      { id: 'q8', text: '系統操作過程流暢' },
      { id: 'q9', text: '從選購商品到完成訂單的流程容易理解' },
      { id: 'q10', text: '整體而言，我認為本系統容易使用' }
    ]
  },
  {
    key: 'product',
    title: '商品與資訊',
    questions: [
      { id: 'q11', text: '商品圖片能清楚呈現商品外觀' },
      { id: 'q12', text: '商品介紹資訊足以幫助我做購買決定' },
      { id: 'q13', text: '商品的尺寸、規格等資訊容易理解' },
      { id: 'q14', text: '商品價格資訊清楚' },
      { id: 'q15', text: '整體而言，我喜歡本次校慶紀念品' },
      { id: 'q16', text: '我認為校慶紀念品的價格合理' }
    ]
  },
  {
    key: 'order',
    title: '訂購流程',
    questions: [
      { id: 'q17', text: '商品加入購物車的操作容易理解' },
      { id: 'q18', text: '我能清楚確認購物車中的商品與數量' },
      { id: 'q19', text: '填寫訂購資料的流程容易理解' },
      { id: 'q20', text: '我能清楚確認訂單內容後再送出' },
      { id: 'q21', text: '完成訂購後，我能清楚知道訂單是否成功' }
    ]
  },
  {
    key: 'overall',
    title: '整體評價',
    questions: [
      { id: 'q22', text: '整體而言，我對本系統感到滿意' },
      { id: 'q23', text: '本系統符合我對線上訂購紀念品的期待' },
      { id: 'q24', text: '如果未來有其他校慶紀念品，我願意再次使用本系統' },
      { id: 'q25', text: '我願意向其他人推薦使用本系統' }
    ]
  }
]