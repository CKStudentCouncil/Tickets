import { START_LOCATION, createRouter, createWebHistory } from 'vue-router'
import External from './External.vue'
import { useAuthStore } from 'src/stores/auth'
import { useShopStore } from 'src/stores/shop'
import { safeRedirect } from 'src/utils/redirect'

const joinPath = (parent, child) => (child.startsWith('/') ? child : `${parent.replace(/\/$/, '')}/${child}`.replace(/\/$/, '') || '/')

// The other app's routes, flattened, as placeholders: same paths and names
// (so links and router.push work unchanged), loaded as a full page
function externalRoutes(routes, parentPath = '', parentMeta = {}) {
  return routes.flatMap((route) => {
    const path = joinPath(parentPath, route.path)
    const meta = { ...parentMeta, ...route.meta }
    if (route.children) return externalRoutes(route.children, path, meta)
    return [{ path, ...(route.name ? { name: route.name } : {}), component: External, meta: { ...meta, external: true } }]
  })
}

// This app's routes with their pages, from the `page` names in routes.js
function ownRoutes(routes, pages) {
  return routes.map(({ page, children, ...route }) => {
    if (page && !pages[page]) throw new Error(`No loader for page ${page}`)
    return {
      ...route,
      ...(page ? { component: pages[page] } : {}),
      ...(children ? { children: ownRoutes(children, pages) } : {})
    }
  })
}

// `own`: the routes this app renders, with `pages` loading their pages;
// `other`: the other app's routes
export function createAppRouter({ own, other, pages }) {
  const router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes: [...ownRoutes(own, pages), ...externalRoutes(other)],
    history: createWebHistory()
  })

  router.beforeEach(async (to, from) => {
    // a page of the other app: load it (the Worker serves that app's HTML)
    if (to.meta.external) {
      const here = window.location.pathname + window.location.search
      if (from === START_LOCATION && to.fullPath === here) {
        // this app was served for the other app's URL: a routing mistake
        // in the Worker; reloading would only loop
        console.error('Page served by the wrong app:', to.fullPath)
        return false
      }
      window.location.assign(to.href)
      return false
    }

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
    // (the login page itself finishes a sign-in that just came back from Google)
    if (to.name === 'login' && authStore.isLoggedIn && !to.query.done) {
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

  return router
}
