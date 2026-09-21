export const products = [
  { id: 1, textid: '1', no: 1, name: '衝鋒外套', price: 700, orPrice: 900, category: '衝鋒外套' },
  { id: 2, textid: '2', no: 2, name: '短踢', price: 300, orPrice: 500, category: '短踢' },
  { id: 3, textid: '3', no: 3, name: '飲料提袋', price: 200, orPrice: 400, category: '飲料提袋' },
  { id: 4, textid: '4', no: 4, name: '帆布袋', price: 200, orPrice: 400, category: '帆布袋' },
  { id: '5_1', textid: '5_1', no: 7, name: 'Q版建中生', price: 50, orprice: 50, category: '鑰匙圈' },
  { id: '5_2', textid: '5_2', no: 7, name: '建中校徽', price: 50, orprice: 50, category: '鑰匙圈' },
]

export const comboDeals = [
  /*{
    id: 'combo1',
    name: '套餐A',
    items: [2, 5],
    originalPrice: 750,
    comboPrice: 400,
    showdiscount: 350,
    discount: 100
  },
  {
    id: 'combo2',
    name: '套餐B',
    items: [1, 2, 2, 4],
    originalPrice: 2750,
    comboPrice: 1800,
    showdiscount: 950,
    discount: 150,
    note: '需兩件短踢，款式不限'
  },
  {
    id: 'combo3',
    name: '套餐C',
    items: [1, 2, 2, 3, 4, 5, 6, 8],
    originalPrice: 4550,
    comboPrice: 2800,
    showdiscount: 1750,
    discount: 350,
    note: '需兩件短踢，款式不限'
  }*/
]

export const sizeData1 = [
  { size: 'M', length: 67, sleeve: 60, chest: 106, shoulder: 44, productId: '1_1' },
  { size: 'L', length: 69, sleeve: 62.5, chest: 110, shoulder: 45.5, productId: '1_2' },
  { size: 'XL', length: 71, sleeve: 64, chest: 114, shoulder: 47, productId: '1_3' },
  { size: '2XL', length: 73, sleeve: 65.5, chest: 118, shoulder: 48.5, productId: '1_4' },
  { size: '3XL', length: 75, sleeve: 67, chest: 122, shoulder: 50, productId: '1_5' },
  { size: '4XL', length: 77, sleeve: 68.5, chest: 126, shoulder: 51.5, productId: '1_6' },
  { size: '5XL', length: 78.5, sleeve: 69, chest: 131, shoulder: 53, productId: '1_7' },
]

export const sizeData2 = [
  { size: 'S', length: 63, sleeve: 20, chest: 46, shoulder: 44, productId: '2_1' },
  { size: 'M', length: 65, sleeve: 20.5, chest: 48, shoulder: 47, productId: '2_2' },
  { size: 'L', length: 68, sleeve: 21, chest: 51, shoulder: 50, productId: '2_3' },
  { size: 'XL', length: 71, sleeve: 21.5, chest: 54, shoulder: 53, productId: '2_4' },
  { size: '2XL', length: 73, sleeve: 22, chest: 57, shoulder: 56, productId: '2_5' },
  { size: '3XL', length: 75, sleeve: 22.5, chest: 60, shoulder: 59, productId: '2_6' },
  { size: '4XL', length: 77, sleeve: 23, chest: 63, shoulder: 62, productId: '2_7' },
]

export const product1s = [
  { id: '1_1', no: 1, name: '衝鋒外套M', price: 700, orPrice: 900 },
  { id: '1_2', no: 1, name: '衝鋒外套L', price: 700, orPrice: 900 },
  { id: '1_3', no: 1, name: '衝鋒外套XL', price: 700, orPrice: 900 },
  { id: '1_4', no: 1, name: '衝鋒外套2XL', price: 700, orPrice: 900 },
  { id: '1_5', no: 1, name: '衝鋒外套3XL', price: 700, orPrice: 900 },
  { id: '1_6', no: 1, name: '衝鋒外套4XL', price: 700, orPrice: 900 },
  { id: '1_7', no: 1, name: '衝鋒外套5XL', price: 700, orPrice: 900 }
]

export const product2s = [
  { id: '2_1', no: 2, name: '短踢S', price: 300, orPrice: 500 },
  { id: '2_2', no: 2, name: '短踢M', price: 300, orPrice: 500 },
  { id: '2_3', no: 2, name: '短踢L', price: 300, orPrice: 500 },
  { id: '2_4', no: 2, name: '短踢XL', price: 300, orPrice: 500 },
  { id: '2_5', no: 2, name: '短踢2XL', price: 300, orPrice: 500 },
  { id: '2_6', no: 2, name: '短踢3XL', price: 300, orPrice: 500 },
  { id: '2_7', no: 2, name: '短踢4XL', price: 300, orPrice: 500 }
]

export const productPageConfigs = {
  1: {
    type: 'sized',
    title: '衝鋒外套',
    orPrice: 900,
    price: 700,
    imageId: '1',
    sizeData: sizeData1,
    variants: product1s
  },
  2: {
    type: 'sized',
    title: '短踢',
    orPrice: 500,
    price: 300,
    imageId: '2',
    sizeData: sizeData2,
    variants: product2s
  },
  3: {
    type: 'simple',
    title: '飲料提袋',
    product: { no: 3, id: 3, name: '飲料提袋', price: 200, orPrice: 400 },
    orPrice: 400,
    price: 200,
    imageId: '3'
  },
  4: {
    type: 'simple',
    title: '帆布袋',
    product: { no: 4, id: 4, name: '帆布袋', price: 400, orPrice: 200 },
    orPrice: 200,
    price: 400,
    imageId: '4',
  },
  '5_1': {
    type: 'multi',
    title: '鑰匙圈',
    price: 50,
    variants: [
      { id: '7_1', no: 7, name: 'Q版建中生', price: 50, orPrice: 50 },
      { id: '7_2', no: 7, name: '建中校徽', price: 50, orPrice: 50 }
    ]
  },
  '5_2': {
    type: 'multi',
    title: '鑰匙圈',
    price: 50,
    variants: [
      { id: '7_1', no: 7, name: '不得外出鑰匙圈', price: 50, orPrice: 50 },
      { id: '7_2', no: 7, name: 'CKHS鑰匙圈', price: 50, orPrice: 50 }
    ]
  },
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
