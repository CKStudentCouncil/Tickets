import { configure } from 'quasar/wrappers'

export default configure((ctx) => ({
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

    distDir: 'dist/spa',

    env: {
      // `quasar dev` only: a fixed App Check debug token, registered once in
      // the Firebase console (src/boot/firebase.js). Never in a production build.
      APP_CHECK_DEBUG_TOKEN: ctx.dev ? process.env.APP_CHECK_DEBUG_TOKEN || '' : ''
    }
  },

  devServer: {
    open: true
  },

  framework: {
    config: {},
    plugins: ['Notify']
  }
}))
