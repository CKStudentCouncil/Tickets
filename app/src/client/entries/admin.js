// The staff pages under /admin (src/pages/admin/index.astro)
import { mountApp } from 'src/setup'
import AdminApp from 'src/AdminApp.vue'
import { adminRoutes, publicRoutes } from 'src/router/routes'

// only the pages of this app, so the public pages stay out of its bundle
const pages = {
  MainLayout: () => import('src/layouts/MainLayout.vue'),
  AdminPage: () => import('src/pages/AdminPage.vue'),
  ManagementPage: () => import('src/pages/ManagementPage.vue'),
  IntroManagementPage: () => import('src/pages/IntroManagementPage.vue'),
  PerformerManagementPage: () => import('src/pages/PerformerManagementPage.vue'),
  ScanPage: () => import('src/pages/ScanPage.vue'),
  OrderDetailPage: () => import('src/pages/OrderDetailPage.vue'),
  AccountPage: () => import('src/pages/AccountPage.vue'),
  SurveyAdminPage: () => import('src/pages/SurveyAdminPage.vue')
}

mountApp(AdminApp, { own: adminRoutes, other: publicRoutes, pages })
