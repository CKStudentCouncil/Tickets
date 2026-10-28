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
      // 舞會滿意度調查: answers only while super admins have this year's open, from
      // signed-in accounts (submitPartySurvey checks too)
      {
        path: 'party-survey',
        name: 'party-survey',
        component: () => import('pages/PartySurveyPage.vue'),
        meta: { requiresAuth: true }
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
        // 學弟登記賣票; the page itself tells those not on the list
        path: 'sell',
        name: 'sell',
        component: () => import('pages/SellerPage.vue'),
        meta: { requiresAuth: true }
      },
      {
        // 公關票: officers (幹部) give out tickets from their quota; the page
        // itself tells those not on the list
        path: 'officer',
        name: 'officer',
        component: () => import('pages/OfficerPage.vue'),
        meta: { requiresAuth: true }
      },
      {
        // 公關票: a guest claims an officer's one-time invite link. Open
        // before the shop is.
        path: 'invite/:id',
        name: 'invite',
        component: () => import('pages/InvitePage.vue'),
        meta: { requiresAuth: true }
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
        // in-page camera scanner for ticket QR codes (no phone scanner app)
        path: 'scan',
        name: 'admin-scan',
        component: () => import('pages/ScanPage.vue')
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
        path: 'sellers',
        name: 'admin-sellers',
        component: () => import('pages/SellerAdminPage.vue'),
        meta: {
          requiresAdmin: true
        }
      },
      {
        path: 'survey',
        name: 'admin-survey',
        component: () => import('pages/SurveyAdminPage.vue')
      },
      {
        path: 'party-survey',
        name: 'admin-party-survey',
        component: () => import('pages/PartySurveyAdminPage.vue'),
        meta: {
          requiresSuperAdmin: true
        }
      }
    ]
  },

  {
    path: '/super_admin',
    component: () => import('layouts/MainLayout.vue'),
    // the router guard requires a super admin; firestore.rules guard the data
    meta: {
      isAdminSection: true,
      requiresSuperAdmin: true
    },
    children: [
      {
        path: '',
        redirect: { name: 'super-admin-analytics' }
      },
      {
        // live sales dashboard and the archived years (salesArchives)
        path: 'analytics',
        name: 'super-admin-analytics',
        component: () => import('pages/AnalyticsPage.vue')
      },
      {
        // 公關票: the officers and their quotas, and sends by name and email
        path: 'guests',
        name: 'super-admin-guests',
        component: () => import('pages/GuestAdminPage.vue')
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
