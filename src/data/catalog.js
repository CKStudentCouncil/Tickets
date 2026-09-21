export const products = [
  { id: 'campus_ticket', textid: '1', no: 1, name: '校內票', price: 700, orPrice: 700, category: '站票' },
  { id: 'first_release', textid: '2', no: 2, name: '一階票', price: 900, orPrice: 900, category: '站票' },
  { id: 'second_release', textid: '3', no: 3, name: '二階票', price: 1200, orPrice: 1200, category: '站票' }
]

export const comboDeals = []

export const productPageConfigs = {
  1: {
    type: 'simple',
    title: '校內票',
    product: { id: 'campus_ticket', no: 1, name: '校內票', price: 700, orPrice: 700, ticketTypeId: 'campus_ticket' },
    orPrice: 700,
    price: 700,
    imageId: '1',
    hideOrPrice: true
  },
  2: {
    type: 'simple',
    title: '一階票',
    product: { id: 'first_release', no: 2, name: '一階票', price: 900, orPrice: 900, ticketTypeId: 'first_release' },
    orPrice: 900,
    price: 900,
    imageId: '2',
    hideOrPrice: true
  },
  3: {
    type: 'simple',
    title: '二階票',
    product: { id: 'second_release', no: 3, name: '二階票', price: 1200, orPrice: 1200, ticketTypeId: 'second_release' },
    orPrice: 1200,
    price: 1200,
    imageId: '3',
    hideOrPrice: true
  }
}

export const schools = [
  '建國中學',
  '北一女中',
  '中山女高',
  '景美女中',
  '成功高中',
  '師大附中',
  '建中家長會',
  '建中老師',
  '其他學校或社會人士'
]
