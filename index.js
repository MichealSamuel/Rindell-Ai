/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║              🤖 RINDELL AI ASSISTANT v5.0                 ║
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

  static header(text) {
    const line = '═'.repeat(60)
    console.log(`\n${this.colors.cyan}${this.colors.bright}╔${line}╗${this.colors.reset}`)
    console.log(`${this.colors.cyan}${this.colors.bright}║${text.padStart(31 + text.length / 2).padEnd(60)}║${this.colors.reset}`)
    console.log(`${this.colors.cyan}${this.colors.bright}╚${line}╝${this.colors.reset}\n`)
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
      if (!msg.message) return
      if (msg.key.fromMe) return
      if (msg.key.remoteJid === 'status@broadcast') return
      if (msg.key.remoteJid?.includes('broadcast')) return
      if (msg.messageStubType) return
      if (msg.messageStubParameters) return
      if (!msg.message.documentMessage) return

      const doc = msg.message.documentMessage
      const fileName = doc.fileName || `document_${Date.now()}`
      const mimeType = doc.mimetype || 'application/octet-stream'
      const from = msg.key.remoteJid

      Logger.divider()
      Logger.document('NEW DOCUMENT RECEIVED', {
        fileName,
        from,
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
      form.append('file', buffer, {
        filename: fileName,
        contentType: mimeType
      })
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

        // ✅ FLEXIBLE RESPONSE HANDLING - Works with ANY Make.com format
        let summary = null
        
        Logger.info('Extracting summary from response...')
        
        if (typeof response.data === 'string') {
          // Response is plain text
          summary = response.data
          Logger.info('Format: Plain text')
        } else if (response.data && typeof response.data === 'object') {
          // Response is JSON - try common field names
          summary = response.data.summary || 
                    response.data.Body || 
                    response.data.text || 
                    response.data.content ||
                    response.data.message ||
                    response.data.result
          
          if (summary) {
            Logger.info('Format: JSON object')
          } else {
            // If none of the common fields exist, stringify entire response
            summary = JSON.stringify(response.data, null, 2)
            Logger.warn('Using entire response (no standard field found)')
          }
        }

        if (summary && summary.length > 10) {
          Logger.ai('AI analysis received')
          Logger.success(`Summary length: ${summary.length} characters`)
          
          // Send summary to YOUR WhatsApp
          Logger.processing('Sending summary to your WhatsApp')
          await sock.sendMessage(CONFIG.ASSISTANT_NUMBER, {
            text: this.formatSummary({ summary }, fileName, from, fileSize)
          })
          Logger.success('Summary sent to you')

          // Send confirmation to user
          Logger.processing('Sending completion message to user')
          await sock.sendMessage(from, {
            text: `✅ *Analysis Complete!*\n\n` +
                  `📄 ${fileName}\n\n` +
                  `Your document has been analyzed by Rindell AI.\n` +
                  `The summary has been delivered! 🎉`
          })
          Logger.success('Completion message sent')

        } else {
          Logger.warn('No valid summary found in response')
          Logger.info('Response type:', typeof response.data)
          Logger.info('Response preview:', JSON.stringify(response.data).substring(0, 200))
          
          await sock.sendMessage(from, {
            text: '⚠️ Analysis completed but summary extraction failed.\n' +
                  'Please try again or contact support.'
          })
          
          // Send debug info to you
          await sock.sendMessage(CONFIG.ASSISTANT_NUMBER, {
            text: `⚠️ *Summary Extraction Failed*\n\n` +
                  `📄 ${fileName}\n` +
                  `👤 From: ${from}\n\n` +
                  `Response type: ${typeof response.data}\n` +
                  `Response: ${JSON.stringify(response.data, null, 2).substring(0, 500)}`
          })
        }

      } catch (webhookError) {
        Logger.error('Make.com webhook failed', {
          error: webhookError.message,
          timeout: webhookError.code === 'ECONNABORTED'
        })

        await sock.sendMessage(from, {
          text: '❌ *Processing Error*\n\n' +
                'Sorry, there was an error analyzing your document.\n' +
                'Please try again in a moment.'
        })

        await sock.sendMessage(CONFIG.ASSISTANT_NUMBER, {
          text: `❌ *Processing Error*\n\n` +
                `📄 ${fileName}\n` +
                `👤 From: ${from}\n` +
                `⚠️ Error: ${webhookError.message}`
        })
      }

      Logger.divider()

    } catch (error) {
      Logger.error('Message processing failed', {
        error: error.message
      })
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
- From: ${from}
- Status: ${data.status || 'Analyzed'}
- Time: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${data.summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Powered by Rindell AI*
🤖 Analysis by Claude via Make.com`
  }
}

/* ═══════════════════════════════════════════════════════════
   CONNECTION HANDLER
   ═══════════════════════════════════════════════════════════ */

class ConnectionHandler {
  static async handleUpdate(sock, update) {
    const { connection, lastDisconnect, qr, isNewLogin } = update

    if (qr) {
      Logger.header('SCAN QR CODE WITH WHATSAPP')
      qrcode.generate(qr, { small: true })
      Logger.info('QR code expires in 30 seconds')
    }

    if (connection === 'connecting') {
      Logger.processing('Connecting to WhatsApp...')
    }

    if (connection === 'open') {
      isConnected = true
      reconnectAttempts = 0
      
      Logger.header('RINDELL AI ASSISTANT READY')
      Logger.success('WhatsApp connected successfully')
      
      if (isNewLogin) {
        Logger.info('New device linked to WhatsApp')
      } else {
        Logger.info('Reconnected using saved session')
      }
      
      Logger.divider()
      Logger.info('Supported file types:', Object.values(CONFIG.SUPPORTED_TYPES))
      Logger.info(`Summaries will be sent to: ${CONFIG.ASSISTANT_NUMBER}`)
      Logger.divider()
      Logger.success('Bot is now listening for documents...')
      Logger.divider()

      await sock.sendMessage(CONFIG.ASSISTANT_NUMBER, {
        text: `🤖 *Rindell AI Assistant Started*\n\n` +
              `✅ Connected to WhatsApp\n` +
              `🕐 ${new Date().toLocaleString()}\n\n` +
              `Ready to process documents! 📄`
      }).catch(() => {})
    }

    if (connection === 'close') {
      isConnected = false
      
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode
        : 500

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      Logger.warn('Connection closed', {
        code: statusCode,
        willReconnect: shouldReconnect
      })

      if (shouldReconnect) {
        reconnectAttempts++
        const delay = Math.min(5000 * reconnectAttempts, 30000)
        
        Logger.processing(`Reconnecting in ${delay / 1000}s... (Attempt ${reconnectAttempts})`)
        setTimeout(() => startBot(), delay)
      } else {
        Logger.error('Logged out - Manual restart required')
        Logger.info('Delete auth/ folder and restart to reconnect')
      }
    }
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
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async () => undefined,
      browser: ['Rindell AI', 'Chrome', '120.0'],
      shouldIgnoreJid: (jid) => jid === 'status@broadcast' || jid?.includes('broadcast'),
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      fireInitQueries: false
    })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update) => ConnectionHandler.handleUpdate(sock, update))

    // Ignore sync events
    sock.ev.on('messaging-history.set', () => {})
    sock.ev.on('chats.set', () => {})
    sock.ev.on('chats.upsert', () => {})
    sock.ev.on('contacts.set', () => {})
    sock.ev.on('contacts.upsert', () => {})
    sock.ev.on('groups.upsert', () => {})

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      if (!isConnected) return

      const msg = messages[0]
      if (!msg) return
      if (msg.messageStubType) return
      if (!msg.message) return

      await MessageHandler.process(sock, msg)
    })

  } catch (error) {
    Logger.error('Bot initialization failed', { error: error.message })
    setTimeout(() => {
      Logger.processing('Retrying in 5 seconds...')
      startBot()
    }, 5000)
  }
}

/* ═══════════════════════════════════════════════════════════
   PROCESS HANDLERS
   ═══════════════════════════════════════════════════════════ */

process.on('uncaughtException', (error) => {
  if (error.message.includes('Decrypted message')) return
  Logger.error('Uncaught Exception', { error: error.message })
})

process.on('unhandledRejection', (reason) => {
  if (reason?.toString().includes('Decrypted message')) return
  Logger.error('Unhandled Rejection', { reason })
})

process.on('SIGINT', async () => {
  Logger.header('SHUTTING DOWN')
  Logger.info('Graceful shutdown initiated')
  
  if (sock && isConnected) {
    try {
      await sock.sendMessage(CONFIG.ASSISTANT_NUMBER, {
        text: '🛑 *Rindell AI Assistant Stopped*\n\n' +
              `Session ended at ${new Date().toLocaleString()}`
      })
    } catch (err) {}
  }
  
  Logger.success('Shutdown complete')
  process.exit(0)
})

process.on('SIGTERM', () => {
  Logger.info('SIGTERM received')
  process.exit(0)
})

/* ═══════════════════════════════════════════════════════════
   START THE BOT
   ═══════════════════════════════════════════════════════════ */

Logger.header('🤖 RINDELL AI ASSISTANT v1.0')
Logger.info('Initializing WhatsApp Document Analysis Bot...')
Logger.divider()

startBot()