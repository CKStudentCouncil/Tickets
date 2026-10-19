declare namespace Cloudflare {
  interface Env extends import('../../src/server/env').Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
