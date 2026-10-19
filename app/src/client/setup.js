// Shared by both apps: the store, the router and the two Quasar components
// the pages still use (q-dialog, q-icon), now plain Vue.
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createAppRouter } from 'src/router'
import QDialog from 'src/components/QDialog.vue'
import QIcon from 'src/components/QIcon.vue'
import 'src/css/app.scss'

export function mountApp(App, { own, other, pages }) {
  const app = createApp(App)
  app.use(createPinia())
  app.use(createAppRouter({ own, other, pages }))
  app.component('QDialog', QDialog)
  app.component('QIcon', QIcon)
  app.mount('#app')
}
