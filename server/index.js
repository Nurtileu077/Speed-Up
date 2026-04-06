require('dotenv').config()
const express = require('express')
const cors = require('cors')
const webhooksRouter = require('./webhooks')
const scheduler = require('./scheduler')

const app = express()
const PORT = process.env.SERVER_PORT || 3001

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
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

// Webhooks routes
app.use('/', webhooksRouter)

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`[Server] Nobilis Dialer server running on port ${PORT}`)
  scheduler.start()
})

module.exports = app
