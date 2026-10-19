const routes = [
  {
    path: '/',
    component: () => import('src/layouts/MainLayout.vue'),
    children: [
      // meta.shop: hidden behind /comingsoon until the shop opens (router guard)
      {
        path: '',
        name: 'home',
        component: () => import('src/pages/HomePage.vue'),
        meta: { shop: true }
      },
      {
        path: 'survey',
        name: 'survey',
        component: () => import('src/pages/SurveyPage.vue')
      },
      {
        path: 'policy',
        name: 'policy',
        component: () => import('src/pages/SalesPolicyPage.vue')
      },
      {
        path: 'product/:id',
        name: 'product',
        component: () => import('src/pages/ProductPage.vue'),
        meta: { shop: true }
      },
      // buyers see their orders only while signed in (the API checks this)
      {
        path: 'order-success',
        name: 'order-success',
        component: () => import('src/pages/OrderSuccessPage.vue'),
        meta: { shop: true, requiresAuth: true }
      },
      {
        path: 'orders',
        name: 'orders',
        component: () => import('src/pages/OrdersPage.vue'),
        meta: { shop: true, requiresAuth: true }
      },
      {
        path: 'orders/:id',
        name: 'order-detail',
        component: () => import('src/pages/OrderDetailPage.vue'),
        meta: { shop: true, requiresAuth: true }
      },
      {
        // one Google sign-in for buyers and staff
        path: 'login',
        name: 'login',
        component: () => import('src/pages/LoginPage.vue')
      },
      {
        path: 'terms',
        name: 'terms',
        component: () => import('src/pages/TermsPage.vue')
      },
      {
        path: 'intro',
        name: 'intro',
        component: () => import('src/pages/IntroPage.vue')
      },
      {
        path: 'performer',
        name: 'performer',
        component: () => import('src/pages/PerformerPage.vue')
      },
      {
        path: 'about',
        name: 'about',
        component: () => import('src/pages/AboutPage.vue')
      },
      {
        path: 'comingsoon',
        name: 'comingsoon',
        component: () => import('src/pages/ComingSoonPage.vue')
      }
    ]
  },

  {
    path: '/admin',
    component: () => import('src/layouts/MainLayout.vue'),
    // children inherit this meta; the router guard requires manager or above
    meta: {
      isAdminSection: true
    },
    children: [
      {
        path: '',
        name: 'admin',
        component: () => import('src/pages/AdminPage.vue')
      },
      {
        path: 'management',
        name: 'management',
        component: () => import('src/pages/ManagementPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'intromanagement',
        name: 'intro-management',
        component: () => import('src/pages/IntroManagementPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'performer',
        name: 'performer-management',
        component: () => import('src/pages/PerformerManagementPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        // in-page camera scanner for ticket QR codes (no phone scanner app)
        path: 'scan',
        name: 'admin-scan',
        component: () => import('src/pages/ScanPage.vue')
      },
      {
        path: 'orders/:id',
        name: 'admin-order-detail',
        // door staff (managers) scan ticket QR codes into this page
        component: () => import('src/pages/OrderDetailPage.vue')
      },
      {
        path: 'account',
        name: 'admin-account',
        component: () => import('src/pages/AccountPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'survey',
        name: 'admin-survey',
        component: () => import('src/pages/SurveyAdminPage.vue')
      }
    ]
  },

  {
    // old staff login address
    path: '/admin/login',
    redirect: (to) => ({ name: 'login', query: to.query })
  },

  {
    path: '/:catchAll(.*)*',
    redirect: '/'
  }
]

export default routes
