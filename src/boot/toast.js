import { boot } from 'quasar/wrappers'
import { useToastStore } from 'src/stores/toast'

export default boot(({ app }) => {
  const toast = useToastStore()
  app.config.globalProperties.$showToast = toast.show
  app.provide('showToast', toast.show)
})
