import { configure } from 'quasar/wrappers'

export default configure(() => ({
  boot: ['firebase'],

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
