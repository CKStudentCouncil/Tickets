import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

export default defineConfig({
  resolve: { alias: { src: path.join(root, 'src/client') } },
  test: {
    projects: [
      // pure logic, in Node
      { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.{js,ts}'], environment: 'node' } },
      // the Worker in workerd with local D1, R2 and Queues
      {
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            main: path.join(root, 'src/worker/index.ts'),
            miniflare: {
              compatibilityDate: '2026-10-01',
              compatibilityFlags: ['nodejs_compat'],
              d1Databases: ['DB'],
              r2Buckets: ['MEDIA'],
              queueProducers: { MAIL_QUEUE: 'mail' },
              serviceBindings: { ASSETS: () => new Response('asset', { status: 200 }) },
              bindings: {
                SITE_URL: 'http://localhost',
                TURNSTILE_HOSTNAMES: 'localhost',
                ENFORCE_TURNSTILE: 'false',
                SES_RECIPIENTS_PER_SECOND: '1000',
                BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
                GOOGLE_CLIENT_ID: 'client-id',
                GOOGLE_CLIENT_SECRET: 'client-secret',
                TEST_MIGRATIONS: await readD1Migrations(path.join(root, 'migrations'))
              }
            }
          }))
        ],
        test: { name: 'worker', include: ['test/integration/**/*.test.ts'], setupFiles: ['test/integration/setup.ts'] }
      }
    ]
  }
})
