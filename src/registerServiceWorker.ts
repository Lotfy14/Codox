import { registerSW } from 'virtual:pwa-register'

registerSW({
  onOfflineReady() {
    console.log('Codox is ready to work offline.')
  },
})
