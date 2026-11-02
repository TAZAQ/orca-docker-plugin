import { createApp } from 'vue'
import App from './App.vue'
import { createHostBridge, type OrcaFrameApi } from './bridge'

declare global {
  interface Window {
    orca: OrcaFrameApi
  }
}

createApp(App, { host: createHostBridge(window.orca) }).mount('#app')
