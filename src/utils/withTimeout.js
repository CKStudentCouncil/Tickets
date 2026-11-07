// Rejects with code 'deadline-exceeded' when `promise` takes longer than
// `ms`. A Firestore read can wait a long time on a phone whose connection
// dropped (back from the background, weak 4G); the page should say so
export function withTimeout(promise, ms) {
  let timer
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' })), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

export const isTimeout = (error) => error?.code === 'deadline-exceeded'
