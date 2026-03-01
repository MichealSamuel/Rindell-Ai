/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║              🤖 RINDELL AI ASSISTANT v5.0                 ║
 * ║              WhatsApp Document Analysis Bot               ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const { Boom } = require('@hapi/boom')
const fs = require('fs')
const path = require('path')
const FormData = require('form-data')
const axios = require('axios')
const qrcode = require('qrcode-terminal')
const pino = require('pino')

/* ═══════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════ */

const CONFIG = {
  VERSION: '5.0',
  ASSISTANT_NUMBER: '2349167066476@c.us',
  MAKE_WEBHOOK_URL: 'https://hook.eu2.make.com/2uyff0akin8p1jlkp527qu9tffr45887',
  WEBHOOK_TIMEOUT: 120000,
  UPLOADS_DIR: path.join(__dirname, 'uploads'),
  AUTH_DIR: path.join(__dirname, 'auth'),
  LOGS_DIR: path.join(__dirname, 'logs'),
  
  SUPPORTED_TYPES: {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
    'application/msword': 'Word Document (Legacy)',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet',
    'text/plain': 'Text File'
  }
}

/* ═══════════════════════════════════════════════════════════
   KEEP-ALIVE SYSTEM (Prevents Session Expiration)
   ═══════════════════════════════════════════════════════════ */

let keepAliveInterval = null

function startKeepAlive(sock) {
  // Clear any existing interval
  if (keepAliveInterval) clearInterval(keepAliveInterval)
  
  // Ping WhatsApp every 30 minutes to keep session alive
  keepAliveInterval = setInterval(async () => {
    if (isConnected) {
      try {
        await sock.sendPresenceUpdate('available')
        console.log('[Keep-Alive] Session refreshed at', new Date().toLocaleTimeString())
      } catch (error) {
        console.log('[Keep-Alive] Ping failed:', error.message)
      }
    }
  }, 30 * 60 * 1000) // 30 minutes
  
  Logger.info('Keep-alive system activated (30min intervals)')
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
    Logger.info('Keep-alive system stopped')
  }
}

/* ═══════════════════════════════════════════════════════════
   LOGGING UTILITIES
   ═══════════════════════════════════════════════════════════ */

class Logger {
  static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
  }

  static ensureLogDir() {
    if (!fs.existsSync(CONFIG.LOGS_DIR)) {
      fs.mkdirSync(CONFIG.LOGS_DIR, { recursive: true })
    }
  }

  static timestamp() {
    const now = new Date()
    return now.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  static log(icon, color, message, data = null) {
    const time = this.timestamp()
    const colorCode = this.colors[color] || this.colors.reset
    const resetCode = this.colors.reset
    
    console.log(`${this.colors.dim}[${time}]${resetCode} ${colorCode}${icon} ${message}${resetCode}`)
    
    if (data) {
      console.log(`${this.colors.dim}   ${JSON.stringify(data, null, 2)}${resetCode}`)
    }

    this.ensureLogDir()
    const logFile = path.join(CONFIG.LOGS_DIR, `rindell-${new Date().toISOString().split('T')[0]}.log`)
    const logEntry = `[${new Date().toISOString()}] ${icon} ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`
    fs.appendFileSync(logFile, logEntry)
  }

  static divider() {
    console.log(`${this.colors.dim}${'─'.repeat(60)}${this.colors.reset}`)
  }

  static success(message, data) { this.log('✅', 'green', message, data) }
  static info(message, data) { this.log('ℹ️ ', 'blue', message, data) }
  static warn(message, data) { this.log('⚠️ ', 'yellow', message, data) }
  static error(message, data) { this.log('❌', 'red', message, data) }
  static processing(message, data) { this.log('⏳', 'cyan', message, data) }
  static document(message, data) { this.log('📄', 'magenta', message, data) }
  static network(message, data) { this.log('🌐', 'blue', message, data) }
  static ai(message, data) { this.log('🤖', 'cyan', message, data) }
}

/* ═══════════════════════════════════════════════════════════
   FILE UTILITIES
   ═══════════════════════════════════════════════════════════ */

class FileManager {
  static ensureDirectories() {
    [CONFIG.UPLOADS_DIR, CONFIG.AUTH_DIR, CONFIG.LOGS_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    })
  }

  static isSupported(mimeType) {
    return CONFIG.SUPPORTED_TYPES.hasOwnProperty(mimeType)
  }

  static getFileTypeName(mimeType) {
    return CONFIG.SUPPORTED_TYPES[mimeType] || 'Unknown File Type'
  }

  static formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  static async saveFile(buffer, fileName) {
    const filePath = path.join(CONFIG.UPLOADS_DIR, fileName)
    fs.writeFileSync(filePath, buffer)
    return filePath
  }

  static async downloadMedia(message, messageType) {
    try {
      const stream = await downloadContentFromMessage(message, messageType)
      let buffer = Buffer.from([])
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
      }
      return buffer
    } catch (error) {
      throw new Error(`Media download failed: ${error.message}`)
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   MESSAGE HANDLER
   ═══════════════════════════════════════════════════════════ */

class MessageHandler {
  static async process(sock, msg) {
    try {
      if (!msg?.message) return
      if (msg.key.fromMe) return
      if (msg.key.remoteJid === 'status@broadcast') return
      if (msg.key.remoteJid?.includes('broadcast')) return
      if (msg.messageStubType) return
      if (!msg.message.documentMessage) return

      const doc = msg.message.documentMessage
      const fileName = doc.fileName || `document_${Date.now()}`
      const mimeType = doc.mimetype || 'application/octet-stream'
      const from = msg.key.remoteJid

      Logger.divider()
      Logger.document('NEW DOCUMENT RECEIVED', {
        fileName,
        from: from.split('@')[0],
        type: FileManager.getFileTypeName(mimeType)
      })

      if (!FileManager.isSupported(mimeType)) {
        Logger.warn('Unsupported file type', { mimeType })
        await sock.sendMessage(from, {
          text: '⚠️ Sorry, this file type is not supported yet.\n\n' +
                'Supported types:\n' +
                '• PDF Documents\n' +
                '• Word Documents (.docx, .doc)\n' +
                '• PowerPoint Presentations\n' +
                '• Excel Spreadsheets'
        })
        return
      }

      Logger.processing('Sending acknowledgment to user')
      await sock.sendMessage(from, {
        text: `✅ *Rindell successfully received your document!*\n\n` +
              `📄 ${fileName}\n\n` +
              `⏳ Processing with AI...\n` +
              `Please wait, this may take a moment.`
      })
      Logger.success('Acknowledgment sent')

      Logger.processing('Downloading document')
      const buffer = await FileManager.downloadMedia(doc, 'document')
      const fileSize = FileManager.formatSize(buffer.length)
      Logger.success(`Downloaded: ${fileSize}`)

      Logger.processing('Saving file locally')
      const filePath = await FileManager.saveFile(buffer, fileName)
      Logger.success(`Saved to: ${filePath}`)

      Logger.network('Sending to Make.com webhook')
      const form = new FormData()
      form.append('file', buffer, { filename: fileName, contentType: mimeType })
      form.append('filename', fileName)
      form.append('mimeType', mimeType)
      form.append('source', from)
      form.append('size', buffer.length.toString())

      const startTime = Date.now()

      try {
        const response = await axios.post(CONFIG.MAKE_WEBHOOK_URL, form, {
          headers: { ...form.getHeaders() },
          timeout: CONFIG.WEBHOOK_TIMEOUT,
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        })

        const processingTime = ((Date.now() - startTime) / 1000).toFixed(1)
        Logger.success(`Make.com responded in ${processingTime}s`)

        let summary = null
        Logger.info('Extracting summary from response...')

        // ✅ PLAIN TEXT RESPONSE (Simplified)
        if (typeof response.data === 'string') {
          console.log('✅ Response is plain text')
          summary = response.data.trim()
          Logger.info(`Received ${summary.length} characters`)
          
        } else if (response.data && typeof response.data === 'object') {
          console.log('Response is object (fallback)')
          
          summary = response.data.summary || 
                    response.data.Result ||
                    response.data.result ||
                    response.data.Body || 
                    response.data.text ||
                    JSON.stringify(response.data)
          
          Logger.info('Extracted from object')
        }

        console.log('─'.repeat(60))
        console.log('SUMMARY:')
        console.log('  Length:', summary ? summary.length : 0)
        console.log('  Preview:', summary ? summary.substring(0, 100).replace(/\n/g, ' ') + '...' : 'null')
        console.log('─'.repeat(60))

        if (summary && summary.length > 10) {
          Logger.ai(`AI analysis received (${summary.length} chars)`)
          
          // ✅ Clean and fix JID
          let myJid = sock.user?.id || CONFIG.ASSISTANT_NUMBER
          
          // Remove port number if present (e.g., :38)
          if (myJid.includes(':')) {
            const parts = myJid.split(':')
            myJid = parts[0] + '@' + parts[1].split('@')[1]
          }
          
          // Convert old format to new
          if (myJid.endsWith('@c.us')) {
            myJid = myJid.replace('@c.us', '@s.whatsapp.net')
          }
          
          console.log('Target JID:', myJid)
          
          Logger.processing('Sending summary to your WhatsApp')
          try {
            await sock.sendMessage(myJid, {
              text: this.formatSummary({ summary }, fileName, from, fileSize)
            })
            Logger.success('✅ Summary sent to you!')
          } catch (sendError) {
            Logger.error('Failed to send summary', { error: sendError.message })
            console.log('Send error:', sendError)
          }

          Logger.processing('Sending completion message to user')
          try {
            await sock.sendMessage(from, {
              text: `✅ *Analysis Complete!*\n\n` +
                    `📄 ${fileName}\n\n` +
                    `Your document has been analyzed by Rindell AI.\n` +
                    `The summary has been delivered! 🎉`
            })
            Logger.success('✅ Completion message sent!')
          } catch (sendError) {
            Logger.error('Failed to send completion', { error: sendError.message })
          }

        } else {
          Logger.warn('No valid summary received')
          console.log('Response data:', response.data)
          
          await sock.sendMessage(from, {
            text: '⚠️ Analysis completed but no summary was received.\n' +
                  'Please try again or contact support.'
          })
        }

      } catch (webhookError) {
        Logger.error('Make.com webhook failed', { 
          error: webhookError.message,
          code: webhookError.code
        })
        
        await sock.sendMessage(from, {
          text: '❌ *Processing Error*\n\n' +
                'Sorry, there was an error analyzing your document.\n' +
                'Please try again in a moment.'
        })
      }

      Logger.divider()

    } catch (error) {
      Logger.error('Message processing failed', { error: error.message })
    }
  }

  static formatSummary(data, fileName, from, fileSize) {
    return `╔═══════════════════════════════════════╗
║     📚 RINDELL AI ANALYSIS REPORT     ║
╚═══════════════════════════════════════╝

📄 *File Details*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Name: ${fileName}
- Size: ${fileSize}
- From: ${from.split('@')[0]}
- Time: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${data.summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Powered by Rindell AI v${CONFIG.VERSION}*
🤖 Analysis by Claude via Make.com`
  }
}

/* ═══════════════════════════════════════════════════════════
   WHATSAPP CLIENT
   ═══════════════════════════════════════════════════════════ */

const logger = pino({ level: 'silent' })
let sock
let isConnected = false
let reconnectAttempts = 0

/* ═══════════════════════════════════════════════════════════
   BOT INITIALIZATION
   ═══════════════════════════════════════════════════════════ */

async function startBot() {
  try {
    FileManager.ensureDirectories()

    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR)

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: true,  // ✅ Enable QR display
      syncFullHistory: false,
      markOnlineOnConnect: true,  // ✅ Mark as online
      getMessage: async () => undefined,
      browser: ['Rindell AI', 'Chrome', '120.0'],
      shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid?.includes('broadcast'),
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,  // ✅ Keep connection alive
      emitOwnEvents: false,
      fireInitQueries: false,
      generateHighQualityLinkPreview: false,
      retryRequestDelayMs: 500,
      maxMsgRetryCount: 3
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update

      // ✅ FORCE QR CODE DISPLAY
      if (qr) {
        console.log('\n\n')
        console.log('╔════════════════════════════════════════════════════════════╗')
        console.log('║                  SCAN QR CODE WITH WHATSAPP                ║')
        console.log('╚════════════════════════════════════════════════════════════╝')
        console.log('\n')
        
        qrcode.generate(qr, { small: true })
        
        console.log('\n')
        console.log('⏱️  QR code expires in 30 seconds - scan quickly!')
        console.log('📱 Open WhatsApp > Settings > Linked Devices > Link a Device')
        console.log('\n')
      }

      if (connection === 'connecting') {
        Logger.processing('Connecting to WhatsApp...')
      }

      if (connection === 'open') {
        isConnected = true
        reconnectAttempts = 0
        
        Logger.divider()
        Logger.success('WhatsApp connected successfully!')
        Logger.info(isNewLogin ? 'New device linked' : 'Reconnected with saved session')
        Logger.info(`Version: ${CONFIG.VERSION}`)
        Logger.success('Bot is now listening for documents...')
        Logger.divider()
        
        // ✅ START KEEP-ALIVE SYSTEM
        startKeepAlive(sock)
      }

      if (connection === 'close') {
        isConnected = false
        stopKeepAlive()
        
        const statusCode = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output?.statusCode
          : 500

        Logger.warn('Connection closed', { code: statusCode })

        // ✅ HANDLE DIFFERENT DISCONNECT REASONS
        const reasons = {
          401: 'Session expired - need new QR',
          403: 'Account banned or restricted',
          428: 'Connection lost - will retry',
          440: 'Session timed out - need new QR',
          500: 'Server error - will retry',
          503: 'Service unavailable - will retry'
        }

        const reason = reasons[statusCode] || 'Unknown reason'
        Logger.info(`Reason: ${reason}`)

        // ✅ EXPIRED SESSION - DELETE AND RESTART
        if (statusCode === 401 || statusCode === 440) {
          Logger.error('Session expired after inactivity')
          Logger.info('Deleting expired session...')
          
          try {
            if (fs.existsSync(CONFIG.AUTH_DIR)) {
              fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true })
              Logger.success('Session deleted')
            }
          } catch (err) {
            Logger.warn('Could not auto-delete session')
          }
          
          Logger.info('Restarting to generate new QR code...')
          setTimeout(() => {
            reconnectAttempts = 0
            startBot()
          }, 3000)
          return
        }

        // ✅ TOO MANY FAILURES - FORCE LOGOUT
        if (reconnectAttempts >= 5) {
          Logger.error('Too many reconnection failures')
          Logger.info('Forcing logout and clean restart...')
          
          try {
            if (fs.existsSync(CONFIG.AUTH_DIR)) {
              fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true })
              Logger.success('Session deleted')
            }
          } catch (err) {
            Logger.warn('Please manually delete auth/ folder')
          }
          
          Logger.info('Restarting... new QR code will appear')
          setTimeout(() => {
            reconnectAttempts = 0
            startBot()
          }, 3000)
          return
        }

        // ✅ NORMAL RECONNECTION
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        if (shouldReconnect) {
          reconnectAttempts++
          const delay = Math.min(5000 * reconnectAttempts, 30000)
          Logger.processing(`Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempts}/5)`)
          setTimeout(() => startBot(), delay)
        } else {
          Logger.error('Logged out manually - need new QR code')
          Logger.info('Deleting session...')
          
          try {
            if (fs.existsSync(CONFIG.AUTH_DIR)) {
              fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true })
            }
          } catch (err) {}
          
          Logger.info('Restarting...')
          setTimeout(() => {
            reconnectAttempts = 0
            startBot()
          }, 3000)
        }
      }
    })

    // Ignore all sync events
    ;['messaging-history.set', 'chats.set', 'chats.upsert', 'contacts.set', 'contacts.upsert', 'groups.upsert'].forEach(event => {
      sock.ev.on(event, () => {})
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !isConnected) return
      const msg = messages[0]
      if (!msg || msg.messageStubType || !msg.message) return
      await MessageHandler.process(sock, msg)
    })

  } catch (error) {
    Logger.error('Bot initialization failed', { error: error.message })
    setTimeout(() => startBot(), 5000)
  }
}

/* ═══════════════════════════════════════════════════════════
   PROCESS HANDLERS
   ═══════════════════════════════════════════════════════════ */

process.on('uncaughtException', () => {})
process.on('unhandledRejection', () => {})

process.on('SIGINT', async () => {
  Logger.divider()
  Logger.info('Graceful shutdown initiated')
  
  // Stop keep-alive
  stopKeepAlive()
  
  // Close socket properly
  if (sock) {
    try {
      await sock.end()
    } catch (err) {}
  }
  
  Logger.success('Shutdown complete')
  process.exit(0)
})

process.on('SIGTERM', () => {
  Logger.info('SIGTERM received')
  stopKeepAlive()
  process.exit(0)
})

/* ═══════════════════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════════════════ */

Logger.info(`Initializing Rindell AI Assistant v${CONFIG.VERSION}...`)
Logger.divider()
startBot()