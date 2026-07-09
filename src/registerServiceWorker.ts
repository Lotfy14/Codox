import { registerSW } from 'virtual:pwa-register'

registerSW({
  onNeedRefresh() {
    console.log('Codox update available.')
  },
  onOfflineReady() {
    console.log('Codox is ready to work offline.')
  },
})
