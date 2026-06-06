import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = 'http://localhost:8001'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/goals':    API,
      '/tasks':    API,
      '/today':    API,
      '/health':   API,
      '/review':   API,
      '/settings': API,
      '/proofs':   API,
      '/uploads':  API,
      '/contacts': API,
      '/comments': API,
      '/analytics': API,
      '/timer':     API,
    },
  },
})
