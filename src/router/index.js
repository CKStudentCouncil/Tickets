import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
  createWebHashHistory
} from 'vue-router'
import routes from './routes'
import { useAuthStore } from 'src/stores/auth'
import { USE_MOCK_ORDERS, MOCK_ALLOW_ADMIN_WITHOUT_AUTH } from 'src/config/app'

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

    if (authStore.loading) {
      await authStore.init()
    }

    const mockAdminOk = USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH
    const role = authStore.user?.role
    const hasManagerAccess = ['manager', 'admin', 'super_admin'].includes(role)
    const hasAdminAccess = ['admin', 'super_admin'].includes(role)

    if (to.meta.requiresManager && !mockAdminOk) {
      if (!authStore.isLoggedIn || !hasManagerAccess) {
        return { name: 'comingsoon' }
      }
    }

    if (to.meta.isAdminSection && !mockAdminOk) {
      if (!authStore.isLoggedIn) {
        return { name: 'admin-login', query: { redirect: to.fullPath } }
      }
      if (!hasManagerAccess) {
        return { name: 'home' }
      }
    }

    if (to.meta.requiresAdmin && !mockAdminOk) {
      if (!hasAdminAccess) {
        return { name: 'admin' }
      }
    }

    if (to.meta.requiresSuperAdmin && !mockAdminOk) {
      if (!authStore.isSuperAdmin) {
        return { name: 'admin' }
      }
    }

    if (to.name === 'admin-login' && hasManagerAccess) {
      return { name: 'admin' }
    }

    const starttime = new Date('2026-11-05T12:00:00+08:00')
    const isAfterStartTime = new Date() >= starttime
    const shopRoutes = ['home', 'product', 'cart', 'order-success', 'orders', 'order-detail']

    if (!USE_MOCK_ORDERS && !isAfterStartTime && shopRoutes.includes(to.name)) {
      if (!hasManagerAccess) {
        return { name: 'comingsoon' }
      }
    }

    return true
  })

  return Router
})