import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const CART_KEY = 'cksc_guest_cart'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(CART_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items))
}

export const useCartStore = defineStore('cart', () => {
  const cartItems = ref(loadFromStorage())

  watch(
    cartItems,
    (items) => saveToStorage(items),
    { deep: true }
  )

  function addToCart(product) {
    const exists = cartItems.value.find((item) => item.id === product.id)
    if (exists) {
      cartItems.value = cartItems.value.map((item) =>
        item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
      )
    } else {
      cartItems.value = [...cartItems.value, { ...product, quantity: 1 }]
    }
  }

  function removeFromCart(id) {
    cartItems.value = cartItems.value.filter((item) => item.id !== id)
  }

  function updateQuantity(id, amount) {
    cartItems.value = cartItems.value
      .map((item) =>
        item.id === id
          ? { ...item, quantity: Math.max(item.quantity + amount, 0) }
          : item
      )
      .filter((item) => item.quantity > 0)
  }

  function clearCart() {
    cartItems.value = []
  }

  function setCartItems(items) {
    cartItems.value = items
  }

  return {
    cartItems,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    setCartItems
  }
})
