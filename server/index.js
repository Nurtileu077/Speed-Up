require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const webhooksRouter = require('./webhooks')
const scheduler = require('./scheduler')

const app = express()
const PORT = process.env.SERVER_PORT || 3001

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', '*'],
  credentials: true
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Nobilis Power Dialer Server',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Bitrix24 widget static files
app.use('/widget', express.static(path.join(__dirname, '../widget')))

// Webhooks and API routes
app.use('/', webhooksRouter)

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`[Server] Nobilis Dialer running on port ${PORT}`)
  console.log(`[Server] Widget: http://localhost:${PORT}/widget/`)
  scheduler.start()
})

module.exports = app
