/**
 * Server-side scheduler stub.
 * The real scheduler runs inside Electron main process (scheduler-main.js).
 * This module is used when the Express server runs standalone.
 */

let started = false

function start() {
  if (started) return
  started = true
  console.log('[Server Scheduler] Started (lightweight mode)')

  // In standalone server mode, we just log. Full scheduler runs in Electron.
  setInterval(() => {
    // Heartbeat
  }, 60_000)
}

function stop() {
  started = false
}

module.exports = { start, stop }
