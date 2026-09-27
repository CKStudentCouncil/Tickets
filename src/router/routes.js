const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      // meta.shop: hidden behind /comingsoon until the shop opens (router guard)
      {
        path: '',
        name: 'home',
        component: () => import('pages/HomePage.vue'),
        meta: { shop: true }
      },
      {
        path: 'survey',
        name: 'survey',
        component: () => import('pages/SurveyPage.vue')
      },
      {
        path: 'policy',
        name: 'policy',
        component: () => import('pages/SalesPolicyPage.vue')
      },
      {
        path: 'product/:id',
        name: 'product',
        component: () => import('pages/ProductPage.vue'),
        meta: { shop: true }
      },
      // buyers see their orders only while signed in (firestore.rules)
      {
        path: 'order-success',
        name: 'order-success',
        component: () => import('pages/OrderSuccessPage.vue'),
        meta: { shop: true, requiresAuth: true }
      },
      {
        path: 'orders',
        name: 'orders',
        component: () => import('pages/OrdersPage.vue'),
        meta: { shop: true, requiresAuth: true }
      },
      {
        path: 'orders/:id',
        name: 'order-detail',
        component: () => import('pages/OrderDetailPage.vue'),
        meta: { shop: true, requiresAuth: true }
      },
      {
        // one Google sign-in for buyers and staff
        path: 'login',
        name: 'login',
        component: () => import('pages/LoginPage.vue')
      },
      {
        path: 'terms',
        name: 'terms',
        component: () => import('pages/TermsPage.vue')
      },
      {
        path: 'intro',
        name: 'intro',
        component: () => import('pages/IntroPage.vue')
      },
      {
        path: 'performer',
        name: 'performer',
        component: () => import('pages/PerformerPage.vue')
      },
      {
        path: 'about',
        name: 'about',
        component: () => import('pages/AboutPage.vue')
      },
      {
        path: 'comingsoon',
        name: 'comingsoon',
        component: () => import('pages/ComingSoonPage.vue')
      }
    ]
  },

  {
    path: '/admin',
    component: () => import('layouts/MainLayout.vue'),
    // children inherit this meta; the router guard requires manager or above
    meta: {
      isAdminSection: true
    },
    children: [
      {
        path: '',
        name: 'admin',
        component: () => import('pages/AdminPage.vue')
      },
      {
        path: 'management',
        name: 'management',
        component: () => import('pages/ManagementPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'intromanagement',
        name: 'intro-management',
        component: () => import('pages/IntroManagementPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'performer',
        name: 'performer-management',
        component: () => import('pages/PerformerManagementPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'orders/:id',
        name: 'admin-order-detail',
        // door staff (managers) scan ticket QR codes into this page
        component: () => import('pages/OrderDetailPage.vue')
      },
      {
        path: 'account',
        name: 'admin-account',
        component: () => import('pages/AccountPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'survey',
        name: 'admin-survey',
        component: () => import('pages/SurveyAdminPage.vue')
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
