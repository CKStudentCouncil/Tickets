declare namespace Cloudflare {
  type ServerEnv = import('../../src/server/env').Env
  interface Env extends ServerEnv {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
