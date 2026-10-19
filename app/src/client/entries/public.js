// The public site: shop, orders, sign-in and content (src/pages/index.astro)
import { mountApp } from 'src/setup'
import PublicApp from 'src/PublicApp.vue'
import { adminRoutes, publicRoutes } from 'src/router/routes'

// only the pages of this app, so the staff pages stay out of its bundle
const pages = {
  MainLayout: () => import('src/layouts/MainLayout.vue'),
  HomePage: () => import('src/pages/HomePage.vue'),
  SurveyPage: () => import('src/pages/SurveyPage.vue'),
  SalesPolicyPage: () => import('src/pages/SalesPolicyPage.vue'),
  ProductPage: () => import('src/pages/ProductPage.vue'),
  OrderSuccessPage: () => import('src/pages/OrderSuccessPage.vue'),
  OrdersPage: () => import('src/pages/OrdersPage.vue'),
  OrderDetailPage: () => import('src/pages/OrderDetailPage.vue'),
  LoginPage: () => import('src/pages/LoginPage.vue'),
  TermsPage: () => import('src/pages/TermsPage.vue'),
  IntroPage: () => import('src/pages/IntroPage.vue'),
  PerformerPage: () => import('src/pages/PerformerPage.vue'),
  AboutPage: () => import('src/pages/AboutPage.vue'),
  ComingSoonPage: () => import('src/pages/ComingSoonPage.vue')
}

mountApp(PublicApp, { own: publicRoutes, other: adminRoutes, pages })
