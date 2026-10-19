import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: path.join(import.meta.dirname, 'wrangler.jsonc') },
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')) } }
    }))
  ],
  test: { include: ['**/*.spike.test.ts'], setupFiles: [path.join(import.meta.dirname, 'setup.ts')] }
})
