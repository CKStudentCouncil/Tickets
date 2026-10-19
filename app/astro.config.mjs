// The site: two Astro pages, each mounting its own Vue app and bundle: the
// public site (src/pages/index.astro) and the staff pages under /admin
// (src/pages/admin/index.astro). vue-router handles the paths in each.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import vue from '@astrojs/vue'

const client = fileURLToPath(new URL('./src/client', import.meta.url))

export default defineConfig({
  output: 'static',
  outDir: './dist',
  // compiles the .vue files; each page mounts its own app (src/client/entries)
  integrations: [vue()],
  vite: {
    resolve: { alias: { src: client } },
    build: { target: ['chrome115', 'safari14'] }
  }
})
