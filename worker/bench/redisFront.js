// The benchmark's Redis: redis-server and the Upstash-style REST front, in a
// process of their own so they do not share a thread with the handler.
// Prints { url, token } on its first line; stops when stdin closes.
import { startUpstash } from '../../functions/test/redis/upstash.js'

const upstash = await startUpstash()
console.log(JSON.stringify({ url: upstash.url, token: upstash.token }))
process.stdin.resume()
process.stdin.on('end', async () => {
  await upstash.stop()
  process.exit(0)
})
