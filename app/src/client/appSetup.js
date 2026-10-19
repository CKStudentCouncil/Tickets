// Astro's Vue app entry: the store, the router and the two Quasar components
// the pages still use (q-dialog, q-icon), now plain Vue.
import { createPinia } from 'pinia'
import { createAppRouter } from 'src/router'
import QDialog from 'src/components/QDialog.vue'
import QIcon from 'src/components/QIcon.vue'
import 'src/css/app.scss'

export default (app) => {
  app.use(createPinia())
  app.use(createAppRouter())
  app.component('QDialog', QDialog)
  app.component('QIcon', QIcon)
}
