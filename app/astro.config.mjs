// The site: one Astro page that mounts the Vue app (vue-router handles the
// paths; the Worker's static assets fall back to it for every page URL).
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'

const client = fileURLToPath(new URL('./src/client', import.meta.url))

export default defineConfig({
  output: 'static',
  outDir: './dist',
  integrations: [vue({ appEntrypoint: '/src/client/appSetup.js' })],
  vite: {
    resolve: { alias: { src: client } },
    build: { target: ['chrome115', 'safari14'] }
  }
})
