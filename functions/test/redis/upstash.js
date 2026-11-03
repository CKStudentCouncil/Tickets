// A local stand-in for Upstash, for the stock gate tests: a real redis-server
// (so the gate's Lua scripts run as they would on Upstash) behind a small
// HTTP server that speaks Upstash's REST protocol (POST a JSON command array,
// get { result } or { error }). Needs `redis-server` on the PATH.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'

const encode = (args) =>
  `*${args.length}\r\n` + args.map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join('')

// Parses one RESP reply at `offset`; returns [value, next offset] or null
// when the buffer does not hold all of it yet. Errors become { error }.
function parse(buffer, offset = 0) {
  const end = buffer.indexOf('\r\n', offset)
  if (end < 0) return null
  const type = buffer[offset]
  const line = buffer.toString('utf8', offset + 1, end)
  const next = end + 2
  if (type === 43) return [line, next] // +
  if (type === 45) return [{ error: line }, next] // -
  if (type === 58) return [Number(line), next] // :
  if (type === 36) { // $
    const length = Number(line)
    if (length < 0) return [null, next]
    if (buffer.length < next + length + 2) return null
    return [buffer.toString('utf8', next, next + length), next + length + 2]
  }
  if (type === 42) { // *
    const count = Number(line)
    if (count < 0) return [null, next]
    const items = []
    let at = next
    for (let i = 0; i < count; i++) {
      const item = parse(buffer, at)
      if (!item) return null
      items.push(item[0])
      at = item[1]
    }
    return [items, at]
  }
  throw new Error(`unexpected RESP reply ${String.fromCharCode(type)}`)
}

async function redisClient(port) {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  let buffer = Buffer.alloc(0)
  const waiting = []
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    for (let reply = parse(buffer); reply && waiting.length > 0; reply = parse(buffer)) {
      buffer = buffer.subarray(reply[1])
      waiting.shift()(reply[0])
    }
  })
  return {
    call: (args) => new Promise((resolve) => {
      waiting.push(resolve)
      socket.write(encode(args))
    }),
    close: () => socket.destroy()
  }
}

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  server.close()
  return port
}

export const hasRedisServer = () => spawnSync('redis-server', ['--version']).status === 0

// Starts redis-server and the REST front. Returns { url, token, redis, stop }.
export async function startUpstash() {
  const port = await freePort()
  const server = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
  let redis
  for (let i = 0; !redis; i++) {
    try {
      redis = await redisClient(port)
    } catch (error) {
      if (i > 50) throw error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const token = 'test-token'
  const http = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    res.setHeader('Content-Type', 'application/json')
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }
    const reply = await redis.call(JSON.parse(body))
    if (reply?.error) {
      res.statusCode = 400
      return res.end(JSON.stringify({ error: reply.error }))
    }
    res.end(JSON.stringify({ result: reply }))
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')

  return {
    // the gate takes plain http only to 127.0.0.1, for this stand-in
    url: `http://127.0.0.1:${http.address().port}`,
    token,
    redis,
    async stop() {
      redis.close()
      http.close()
      server.kill()
    }
  }
}
