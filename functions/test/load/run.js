// `yarn test:load`: runs every scenario in its own emulator (after a large
// run the emulator stalls later scenarios in the same process).
import { spawnSync } from 'node:child_process'

import { SCENARIOS } from './scenarios.js'

for (const index of SCENARIOS.keys()) {
  const command = `firebase emulators:exec --only firestore --project demo-cksc-ticket "node test/load/createOrder.load.js ${index}"`
  const { status } = spawnSync(command, { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}
