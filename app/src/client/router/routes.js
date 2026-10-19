// Every page of the site. The public site and the staff pages (/admin) are
// two separate apps and bundles (src/client/entries/), so this table names
// pages instead of importing them: each entry supplies the loaders of its own
// pages, and the other app's routes become placeholders that load that app
// (src/client/router/index.js).
export const publicRoutes = [
  {
    path: '/',
    page: 'MainLayout',
    children: [
      // meta.shop: hidden behind /comingsoon until the shop opens (router guard)
      {
        path: '',
        name: 'home',
        page: 'HomePage',
        meta: { shop: true }
      },
      {
        path: 'survey',
        name: 'survey',
        page: 'SurveyPage'
      },
      {
        path: 'policy',
        name: 'policy',
        page: 'SalesPolicyPage'
      },
      {
        path: 'product/:id',
        name: 'product',
        page: 'ProductPage',
        meta: { shop: true }
      },
      // buyers see their orders only while signed in (the API checks this)
      {
        path: 'order-success',
        name: 'order-success',
        page: 'OrderSuccessPage',
        meta: { shop: true, requiresAuth: true }
      },
      {
        path: 'orders',
        name: 'orders',
        page: 'OrdersPage',
        meta: { shop: true, requiresAuth: true }
      },
      {
        path: 'orders/:id',
        name: 'order-detail',
        page: 'OrderDetailPage',
        meta: { shop: true, requiresAuth: true }
      },
      {
        // one Google sign-in for buyers and staff
        path: 'login',
        name: 'login',
        page: 'LoginPage'
      },
      {
        path: 'terms',
        name: 'terms',
        page: 'TermsPage'
      },
      {
        path: 'intro',
        name: 'intro',
        page: 'IntroPage'
      },
      {
        path: 'performer',
        name: 'performer',
        page: 'PerformerPage'
      },
      {
        path: 'about',
        name: 'about',
        page: 'AboutPage'
      },
      {
        path: 'comingsoon',
        name: 'comingsoon',
        page: 'ComingSoonPage'
      }
    ]
  },
  {
    path: '/:catchAll(.*)*',
    redirect: '/'
  }
]

export const adminRoutes = [
  {
    path: '/admin',
    page: 'MainLayout',
    // children inherit this meta; the router guard requires manager or above
    meta: {
      isAdminSection: true
    },
    children: [
      {
        path: '',
        name: 'admin',
        page: 'AdminPage'
      },
      {
        path: 'management',
        name: 'management',
        page: 'ManagementPage',
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'intromanagement',
        name: 'intro-management',
        page: 'IntroManagementPage',
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'performer',
        name: 'performer-management',
        page: 'PerformerManagementPage',
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        // in-page camera scanner for ticket QR codes (no phone scanner app)
        path: 'scan',
        name: 'admin-scan',
        page: 'ScanPage'
      },
      {
        path: 'orders/:id',
        name: 'admin-order-detail',
        // door staff (managers) scan ticket QR codes into this page
        page: 'OrderDetailPage'
      },
      {
        path: 'account',
        name: 'admin-account',
        page: 'AccountPage',
        meta: {
          requiresSuperAdmin: true
        }
      },
      {
        path: 'survey',
        name: 'admin-survey',
        page: 'SurveyAdminPage'
      }
    ]
  },

  {
    // old staff login address
    path: '/admin/login',
    redirect: (to) => ({ name: 'login', query: to.query })
  },

  {
    path: '/admin/:catchAll(.*)*',
    redirect: '/admin'
  }
]
