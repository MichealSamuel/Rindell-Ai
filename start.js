/**
 * CLEAN STARTUP WRAPPER FOR RINDELL
 * Filters all Baileys spam before starting main bot
 */

const { spawn } = require('child_process')
const path = require('path')

console.log('╔════════════════════════════════════════════════════════════╗')
console.log('║                 🤖 RINDELL AI ASSISTANT v1.0               ║')
console.log('╚════════════════════════════════════════════════════════════╝\n')
console.log('Starting bot with spam filter...\n')

// Start the actual bot as a child process
const bot = spawn('node', ['index.js'], {
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe']
})

// Filter stdout
bot.stdout.on('data', (data) => {
  const output = data.toString()
  
  // Filter out Baileys spam
  const lines = output.split('\n')
  const filtered = lines.filter(line => {
    return !line.includes('Decrypted message') &&
           !line.includes('Closing session') &&
           !line.includes('SessionEntry') &&
           !line.includes('_chains') &&
           !line.includes('registrationId') &&
           !line.includes('Buffer')
  })
  
  if (filtered.join('').trim()) {
    process.stdout.write(filtered.join('\n') + (filtered.length > 0 ? '\n' : ''))
  }
})

// Filter stderr
bot.stderr.on('data', (data) => {
  const output = data.toString()
  
  if (!output.includes('Decrypted message') && 
      !output.includes('Closing session')) {
    process.stderr.write(output)
  }
})

bot.on('close', (code) => {
  console.log(`\nBot process exited with code ${code}`)
  process.exit(code)
})

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping bot...')
  bot.kill('SIGINT')
})