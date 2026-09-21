import { comboDeals } from 'src/data/catalog'

export function checkComboDeals(cartItems) {
  const itemQuantities = {}
  cartItems.forEach((item) => {
    if (item.no) {
      itemQuantities[item.no] = (itemQuantities[item.no] || 0) + item.quantity
    }
  })

  const possibleCombos = []
  comboDeals.forEach((combo) => {
    const requiredQuantities = {}
    combo.items.forEach((itemNo) => {
      requiredQuantities[itemNo] = (requiredQuantities[itemNo] || 0) + 1
    })

    const hasAllItems = Object.entries(requiredQuantities).every(
      ([itemNo, requiredQty]) => itemQuantities[parseInt(itemNo, 10)] >= requiredQty
    )

    if (hasAllItems) {
      const maxPossibleCount = Math.min(
        ...Object.entries(requiredQuantities).map(([itemNo, requiredQty]) =>
          Math.floor(itemQuantities[parseInt(itemNo, 10)] / requiredQty)
        )
      )
      possibleCombos.push({ ...combo, maxCount: maxPossibleCount, requiredQuantities })
    }
  })

  if (possibleCombos.length === 0) {
    return { appliedCombos: [], remainingItems: itemQuantities, totalDiscount: 0 }
  }

  const findOptimalCombination = (combos, quantities) => {
    let bestResult = { totalDiscount: 0, appliedCombos: [], remainingItems: quantities }

    combos.forEach((combo) => {
      const canApply = Object.entries(combo.requiredQuantities).every(
        ([itemNo, requiredQty]) => quantities[parseInt(itemNo, 10)] >= requiredQty
      )

      if (canApply) {
        const maxApplications = Math.min(
          ...Object.entries(combo.requiredQuantities).map(([itemNo, requiredQty]) =>
            Math.floor(quantities[parseInt(itemNo, 10)] / requiredQty)
          )
        )

        for (let count = maxApplications; count >= 1; count--) {
          const newQuantities = { ...quantities }
          Object.entries(combo.requiredQuantities).forEach(([itemNo, requiredQty]) => {
            newQuantities[parseInt(itemNo, 10)] -= requiredQty * count
          })

          const currentDiscount = combo.discount * count
          const remainingCombos = combos.filter((c) => c.id !== combo.id)
          const recursiveResult =
            remainingCombos.length > 0
              ? findOptimalCombination(remainingCombos, newQuantities)
              : { totalDiscount: 0, appliedCombos: [], remainingItems: newQuantities }

          const totalDiscount = currentDiscount + recursiveResult.totalDiscount

          if (totalDiscount > bestResult.totalDiscount) {
            bestResult = {
              totalDiscount,
              appliedCombos: [
                { ...combo, applicableCount: count },
                ...recursiveResult.appliedCombos
              ],
              remainingItems: recursiveResult.remainingItems
            }
          }
        }
      }
    })

    return bestResult
  }

  return findOptimalCombination(possibleCombos, itemQuantities)
}

export function calculatePricing(cartItems, options = {}) {
  const { usePRPackage = false, isAdmin = false } = options
  const originalTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const comboResult = checkComboDeals(cartItems)

  const giftItems = cartItems.filter((item) => item.no === 7 || item.no === 8)
  const totalGiftQuantity = giftItems.reduce((sum, item) => sum + item.quantity, 0)

  const combo3Applied = comboResult.appliedCombos.find((combo) => combo.id === 'combo3')
  const giftUsedInCombo = combo3Applied ? combo3Applied.applicableCount : 0

  const availableGiftCount = totalGiftQuantity - giftUsedInCombo
  const hasAvailableGift = availableGiftCount > 0

  if (isAdmin && usePRPackage) {
    return {
      originalTotal,
      finalTotal: 0,
      totalDiscount: originalTotal,
      appliedCombos: [],
      prPackageApplied: true,
      prPackageDiscount: originalTotal,
      qualifiesForGift: false,
      giftDiscount: 0,
      hasAvailableGift: false,
      totalGiftQuantity: 0,
      giftUsedInCombo: 0,
      availableGiftCount: 0,
      amountNeededForGift: 0,
      reachedThreshold: false
    }
  }

  const totalAfterCombo = originalTotal - comboResult.totalDiscount

  let giftDiscount = 0
  let qualifiesForGift = false

  if (hasAvailableGift) {
    const firstGiftItem = giftItems[0]
    if (firstGiftItem) {
      const totalAfterGiftDiscount = totalAfterCombo - firstGiftItem.price
      if (totalAfterGiftDiscount >= 1000) {
        qualifiesForGift = true
        giftDiscount = firstGiftItem.price
      }
    }
  }

  const reachedThreshold = totalAfterCombo >= 1000

  const amountNeededForGift = hasAvailableGift
    ? Math.max(0, 1000 - (totalAfterCombo - (giftItems[0]?.price || 0)))
    : Math.max(0, 1000 - totalAfterCombo)

  const currentTotal = totalAfterCombo - giftDiscount

  return {
    originalTotal,
    finalTotal: currentTotal,
    totalDiscount: comboResult.totalDiscount,
    appliedCombos: comboResult.appliedCombos,
    remainingItems: comboResult.remainingItems,
    prPackageApplied: false,
    prPackageDiscount: 0,
    qualifiesForGift,
    giftDiscount,
    hasAvailableGift,
    totalGiftQuantity,
    giftUsedInCombo,
    availableGiftCount,
    amountNeededForGift,
    reachedThreshold
  }
}
