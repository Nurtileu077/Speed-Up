/**
 * Built-in SIP softphone using JsSIP + WebRTC
 * Runs in Electron renderer process (has full WebRTC support)
 */

let JsSIP = null
let ua = null
let currentSession = null
let remoteAudioEl = null
let onStatusChange = null

export function setStatusHandler(cb) {
  onStatusChange = cb
}

function emit(status, data) {
  onStatusChange?.(status, data)
}

function getOrCreateAudio() {
  if (remoteAudioEl) return remoteAudioEl
  remoteAudioEl = document.createElement('audio')
  remoteAudioEl.id = '__sip_remote_audio__'
  remoteAudioEl.autoplay = true
  document.body.appendChild(remoteAudioEl)
  return remoteAudioEl
}

export async function sipInit(config) {
  if (!config?.SIP_WS_URL || !config?.SIP_USERNAME || !config?.SIP_PASSWORD) {
    emit('unconfigured')
    return
  }

  // Lazy load JsSIP (large bundle)
  if (!JsSIP) {
    JsSIP = (await import('jssip')).default
    JsSIP.debug.disable('JsSIP:*')
  }

  sipStop()

  try {
    const socket = new JsSIP.WebSocketInterface(config.SIP_WS_URL)
    const server = config.SIP_SERVER || new URL(config.SIP_WS_URL).hostname

    ua = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${config.SIP_USERNAME}@${server}`,
      password: config.SIP_PASSWORD,
      display_name: config.SIP_DISPLAY_NAME || config.SIP_USERNAME,
      register: true,
      register_expires: 300,
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30
    })

    ua.on('connected',    () => { console.log('[SIP] WebSocket connected'); emit('connected') })
    ua.on('disconnected', (e) => { console.error('[SIP] WebSocket disconnected', e?.data); emit('disconnected', e?.data?.message || '') })
    ua.on('registered',   () => { console.log('[SIP] Registered OK'); emit('registered') })
    ua.on('unregistered', () => { console.warn('[SIP] Unregistered'); emit('unregistered') })
    ua.on('registrationFailed', (e) => { console.error('[SIP] Registration failed', e.cause); emit('error', `Ошибка регистрации: ${e.cause}`) })

    // Handle incoming calls (auto-reject for now)
    ua.on('newRTCSession', (data) => {
      if (data.originator === 'remote') {
        data.session.terminate()
      }
    })

    ua.start()
    emit('connecting')
  } catch (err) {
    emit('error', err.message)
  }
}

export function sipCall(phoneNumber) {
  if (!ua || !ua.isRegistered()) {
    emit('error', 'SIP не зарегистрирован. Проверьте настройки.')
    return false
  }

  try {
    const server = ua.configuration.uri.host
    // If raw number — build SIP URI
    const target = phoneNumber.includes('@')
      ? phoneNumber
      : `sip:${phoneNumber.replace(/\D/g, '')}@${server}`

    const session = ua.call(target, {
      mediaConstraints: { audio: true, video: false },
      rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false },
      pcConfig: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    })

    currentSession = session

    // Attach remote audio stream
    session.on('confirmed', () => {
      const conn = session.connection
      if (conn) {
        conn.addEventListener('track', (e) => {
          if (e.streams && e.streams[0]) {
            getOrCreateAudio().srcObject = e.streams[0]
          }
        })
      }
      emit('active')
    })

    session.on('connecting', () => emit('calling'))
    session.on('progress',   () => emit('ringing'))
    session.on('ended',      (e) => { currentSession = null; emit('ended', e.cause) })
    session.on('failed',     (e) => { currentSession = null; emit('failed', e.cause) })

    return true
  } catch (err) {
    emit('error', err.message)
    return false
  }
}

export function sipHangup() {
  try { currentSession?.terminate() } catch {}
  currentSession = null
  if (remoteAudioEl) remoteAudioEl.srcObject = null
}

export function sipStop() {
  sipHangup()
  try { ua?.stop() } catch {}
  ua = null
}

export function sipIsRegistered() {
  return ua?.isRegistered() || false
}

export function sipStatus() {
  if (!ua) return 'unconfigured'
  if (!ua.isConnected()) return 'disconnected'
  if (!ua.isRegistered()) return 'connecting'
  return 'registered'
}
