/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║              🤖 RINDELL AI ASSISTANT v5.0                 ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const { spawn } = require('child_process')

// Comprehensive spam patterns to filter
const SPAM_PATTERNS = [
  'Decrypted message',
  'Closing session',
  'SessionEntry',
  '_chains',
  'registrationId',
  'currentRatchet',
  'ephemeralKeyPair',
  'Buffer 05',
  'Buffer a0',
  'Buffer <Buffer',
  'baseKey',
  'indexInfo',
  'pendingPreKey',
  'lastRemoteEphemeralKey',
  'previousCounter',
  'rootKey',
  'chainKey',
  'chainType',
  'messageKeys',
  'privKey',
  'pubKey',
  'signedKeyId',
  'preKeyId',
  'closed:',
  'used:',
  'created:',
  'Closing open session',
  'prekey bundle',
  'BQ0L', // Session identifiers
  'favor of incoming'
]

function shouldFilter(line) {
  return SPAM_PATTERNS.some(pattern => line.includes(pattern))
}

console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║                 🤖 RINDELL AI ASSISTANT v5.0               ║')
console.log('╚════════════════════════════════════════════════════════════╝\n')

// Start the bot
const bot = spawn('node', ['index.js'], {
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '1' }
})

let buffer = ''

bot.stdout.on('data', (data) => {
  buffer += data.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() // Keep incomplete line in buffer
  
  lines.forEach(line => {
    if (!shouldFilter(line) && line.trim()) {
      console.log(line)
    }
  })
})

bot.stderr.on('data', (data) => {
  const output = data.toString()
  const lines = output.split('\n')
  
  lines.forEach(line => {
    if (!shouldFilter(line) && line.trim()) {
      process.stderr.write(line + '\n')
    }
  })
})

bot.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.log(`\n⚠️  Bot exited with code ${code}`)
  }
  process.exit(code || 0)
})

process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...')
  bot.kill('SIGINT')
  setTimeout(() => process.exit(0), 1000)
})

process.on('SIGTERM', () => {
  bot.kill('SIGTERM')
  setTimeout(() => process.exit(0), 1000)
})