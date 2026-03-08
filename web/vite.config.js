import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 8834,
    host: '0.0.0.0',
    allowedHosts: ['g-8834.cicy.de5.net']
  }
})
