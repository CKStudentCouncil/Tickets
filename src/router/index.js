import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
  createWebHashHistory
} from 'vue-router'
import routes from './routes'
import { useAuthStore } from 'src/stores/auth'
import { SHOP_OPEN_AT } from 'src/config/app'

const SHOP_ROUTES = ['home', 'product', 'order-success', 'orders', 'order-detail']

export default defineRouter(function () {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE)
  })

  Router.beforeEach(async (to) => {
    const authStore = useAuthStore()
    await authStore.init()

    if (to.meta.isAdminSection) {
      if (!authStore.isLoggedIn) {
        return { name: 'admin-login', query: { redirect: to.fullPath } }
      }
      if (!authStore.isManager) {
        return { name: 'home' }
      }
    }

    if (to.meta.requiresAdmin && !authStore.isAdmin) {
      return { name: 'admin' }
    }

    if (to.meta.requiresSuperAdmin && !authStore.isSuperAdmin) {
      return { name: 'admin' }
    }

    if (to.name === 'admin-login' && authStore.isManager) {
      return { name: 'admin' }
    }

    if (new Date() < SHOP_OPEN_AT && SHOP_ROUTES.includes(to.name) && !authStore.isManager) {
      return { name: 'comingsoon' }
    }

    return true
  })

  return Router
})
