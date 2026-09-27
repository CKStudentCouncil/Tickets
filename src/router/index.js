import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createMemoryHistory,
  createWebHistory,
  createWebHashHistory
} from 'vue-router'
import routes from './routes'
import { useAuthStore } from 'src/stores/auth'
import { useShopStore } from 'src/stores/shop'
import { safeRedirect } from 'src/utils/redirect'

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
    const shopStore = useShopStore()

    // load the opening time while the sign-in state resolves, not after
    if (to.meta.shop) shopStore.init()
    await authStore.init()

    if (to.meta.isAdminSection) {
      if (!authStore.isLoggedIn) {
        return { name: 'login', query: { redirect: to.fullPath } }
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

    // already signed in: go where the login was meant to lead
    if (to.name === 'login' && authStore.isLoggedIn) {
      return safeRedirect(to.query.redirect, authStore.isManager ? '/admin' : '/')
    }

    if (to.meta.shop && !authStore.isManager) {
      await shopStore.init()

      if (!shopStore.isOpen()) {
        // /comingsoon brings the visitor back here once the shop opens
        return { name: 'comingsoon', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
      }
    }

    if (to.meta.requiresAuth && !authStore.isLoggedIn) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    return true
  })

  return Router
})
