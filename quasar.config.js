import { configure } from 'quasar/wrappers'

export default configure(() => ({
  eslint: {
    warnings: true,
    errors: true
  },

  boot: ['firebase', 'toast'],

  css: ['app.scss'],

  extras: ['material-icons'],

  build: {
    target: {
      browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
      node: 'node20'
    },

    vueRouterMode: 'history',

    // GitHub Pages project sites are served from /Tickets/.
    // Local development continues to use the root path.
    publicPath: process.env.GITHUB_ACTIONS ? '/Tickets/' : '/',

    distDir: 'dist/spa'
  },

  devServer: {
    open: true
  },

  framework: {
    config: {},
    plugins: ['Notify']
  }
}))
/*import { configure } from 'quasar/wrappers'

export default configure(() => ({
  eslint: {
    warnings: true,
    errors: true
  },
  boot: ['firebase', 'toast'],
  css: ['app.scss'],
  extras: ['material-icons'],
  build: {
    target: {
      browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
      node: 'node20'
    },
    vueRouterMode: 'history',
    publicPath: '/',
    distDir: 'dist/spa'
  },
  devServer: {
    open: true
  },
  framework: {
    config: {},
    plugins: ['Notify']
  }
}))
