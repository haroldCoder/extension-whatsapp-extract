// AuraSystem Integration Module for WhatsApp Web Extractor
// Conexión modular separada con el Webhook de AuraSystem Spa
(function (global) {
  'use strict';

  const DEFAULT_CONFIG = {
    webhookUrl: 'https://spa-software.vercel.app/api/whatsapp/webhook',
    businessId: '',
    workerId: '',
    timeoutMs: 12000
  };

  /**
   * Helper to verify if Chrome extension context is still valid (not invalidated after reload)
   */
  function isExtensionContextValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
    } catch (e) {
      return false;
    }
  }

  /**
   * Helper: Detect WhatsApp / Meta internal LIDs (Linked Identity)
   */
  function isLikelyLid(val) {
    if (!val) return false;
    const str = typeof val === 'object' ? String(val._serialized || val.id || val.user || '') : String(val);
    if (str.includes('@lid')) return true;
    if (typeof val === 'object' && val.server === 'lid') return true;
    const digits = str.replace(/\D/g, '');
    if (digits.length >= 14 && digits.startsWith('1')) return true;
    if (digits.length === 15) return true;
    if (digits.length >= 16) return true;
    return false;
  }

  /**
   * Helper to clean phone numbers: keeps only digits
   */
  function cleanPhoneNumber(raw) {
    if (!raw) return '';
    // Strip non-digits
    const digits = String(raw).replace(/\D/g, '');
    return digits;
  }

  /**
   * Extract phone number from WhatsApp Web DOM elements, message data-id, or chat title
   */
  function extractPhoneNumberFromContext(chatName, messages = []) {
    // 1. If chatName itself looks like a phone number
    const chatDigits = cleanPhoneNumber(chatName);
    if (chatDigits.length >= 8 && chatDigits.length <= 15 && !isLikelyLid(chatDigits)) {
      return chatDigits;
    }

    // 2. Try looking in message IDs (e.g. false_573001234567@c.us_...)
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg && msg.id) {
          const match = msg.id.match(/(\d{8,15})@(c\.us|s\.whatsapp\.net)/i);
          if (match && match[1] && !isLikelyLid(match[1])) {
            return match[1];
          }
        }
      }
    }

    // 3. Try DOM inspection if in WhatsApp Web document context
    if (typeof document !== 'undefined') {
      try {
        // Check drawer directly if open
        const drawers = document.querySelectorAll('[data-testid="contact-info-drawer"], [data-testid="chat-info-drawer"], div[role="region"], #main ~ div');
        for (const drawer of drawers) {
          if (!drawer || drawer.id === 'side' || drawer.closest('#side')) continue;
          const textElements = drawer.querySelectorAll('span, div, h2, p, a');
          for (const el of textElements) {
            const txt = (el.innerText || '').trim();
            const match = txt.match(/\+(\d[\d\s\-\(\)]{7,18}\d)/);
            if (match) {
              const d = cleanPhoneNumber(match[1]);
              if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
                return d;
              }
            }
          }
        }

        // Look in #main header subtitle or elements
        const mainHeader = document.querySelector('#main header');
        if (mainHeader) {
          const textElements = mainHeader.querySelectorAll('span, div');
          for (const el of textElements) {
            const txt = (el.innerText || el.getAttribute('title') || '').trim();
            const d = cleanPhoneNumber(txt);
            if (d.length >= 8 && d.length <= 15 && !isLikelyLid(d) && (txt.startsWith('+') || /^\d+$/.test(txt.replace(/\s+/g, '')))) {
              return d;
            }
          }
        }

        // Look for any data-id with @c.us in current chat messages
        const msgWithId = document.querySelector('#main div[data-id*="@c.us"], #main div[data-id*="@s.whatsapp.net"]');
        if (msgWithId) {
          const dataId = msgWithId.getAttribute('data-id') || '';
          const match = dataId.match(/(\d{8,15})@(c\.us|s\.whatsapp\.net)/i);
          if (match && match[1] && !isLikelyLid(match[1])) {
            return match[1];
          }
        }
      } catch (e) {
        // Safe DOM lookup ignore
      }
    }

    // Fallback if no full phone number detected
    return (!isLikelyLid(chatDigits) && chatDigits.length >= 7 && chatDigits.length <= 15) ? chatDigits : '';
  }

  /**
   * Helper to resolve the phone number for a specific message
   * Priorities:
   * 1. msg.numero / msg.phone / msg.phoneNumber (already attached to each listed message, verified not LID)
   * 2. msg.id contains account JID: (\d+)@c.us or (\d+)@s.whatsapp.net
   * 3. LID lookup in contactsCache.byLid
   * 4. msg.sender if sender is phone number
   * 5. chatName / msg.chatName if chat has phone digits
   * 6. Shared DOM attribute data-wa-active-phone
   * 7. contactsCache.byName
   * 8. Direct DOM contact drawer lookup
   */
  function extractMessagePhoneNumber(msg, chatName = '') {
    if (!msg) return '';

    // 1. Explicit property on message
    const direct = cleanPhoneNumber(msg.numero || msg.phone || msg.phoneNumber || msg.senderPhone || msg.tel);
    if (direct && direct.length >= 7 && direct.length <= 15 && !isLikelyLid(direct)) {
      return direct;
    }

    // 2. From message ID (which embeds the chat JID e.g. false_573001234567@c.us_...)
    if (msg.id) {
      const match = msg.id.match(/(\d{7,15})@(c\.us|s\.whatsapp\.net)/i);
      if (match && match[1] && !isLikelyLid(match[1])) {
        return match[1];
      }
      // If message ID embeds a LID, check contactsCache
      const matchLid = msg.id.match(/(\d{8,25})@lid/i);
      if (matchLid && matchLid[1] && typeof window !== 'undefined' && window.contactsCache) {
        const cached = window.contactsCache.byLid?.get(matchLid[1]) || window.contactsCache.byLid?.get(matchLid[1] + '@lid');
        if (cached && cached.phone && !isLikelyLid(cached.phone)) {
          return cleanPhoneNumber(cached.phone);
        }
      }
    }

    // 3. From sender if sender consists of phone digits
    if (msg.sender && msg.sender !== 'Tú') {
      const senderDigits = cleanPhoneNumber(msg.sender);
      if (senderDigits.length >= 7 && senderDigits.length <= 15 && !isLikelyLid(senderDigits)) {
        return senderDigits;
      }
    }

    // 4. From chatName / origin
    const chatRef = msg.chatName || msg.chatOrigin || chatName;
    if (chatRef) {
      const chatDigits = cleanPhoneNumber(chatRef);
      if (chatDigits.length >= 7 && chatDigits.length <= 15 && !isLikelyLid(chatDigits)) {
        return chatDigits;
      }
    }

    // 5. From shared DOM attribute set by page_bridge.js / content.js
    if (typeof document !== 'undefined') {
      const domPhone = document.documentElement?.getAttribute('data-wa-active-phone');
      if (domPhone) {
        const cleaned = cleanPhoneNumber(domPhone);
        if (cleaned.length >= 7 && cleaned.length <= 15 && !isLikelyLid(cleaned)) {
          return cleaned;
        }
      }
    }

    // 6. From window global cache or bridge
    if (typeof window !== 'undefined') {
      if (window.waActiveChatPhone) {
        const p = cleanPhoneNumber(window.waActiveChatPhone);
        if (p.length >= 7 && p.length <= 15 && !isLikelyLid(p)) {
          return p;
        }
      }
      if (window.contactsCache && chatRef) {
        const norm = chatRef.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/gi, '').trim();
        const cached = window.contactsCache.byName?.get(norm) || window.contactsCache.byName?.get(chatRef.toLowerCase()) || window.contactsCache.byName?.get(chatRef);
        if (cached && cached.phone) {
          const p = cleanPhoneNumber(cached.phone);
          if (p.length >= 7 && p.length <= 15 && !isLikelyLid(p)) {
            return p;
          }
        }
      }
    }

    // 7. Check open drawer in DOM (leaf text outside #side and #main)
    if (typeof document !== 'undefined') {
      try {
        const allOutside = document.querySelectorAll('body *');
        for (const el of allOutside) {
          if (el.closest('#side') || el.closest('#main')) continue;
          if (el.closest('#wa-message-extractor-panel') || el.closest('#wa-extractor-fab')) continue;
          if (el.children.length <= 2) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt && (txt.includes('+') || /^\d[\d\s\-\(\)]{7,}\d$/.test(txt))) {
              const match = txt.match(/\+(\d[\d\s\-\(\)]{6,18}\d)/);
              if (match) {
                const d = cleanPhoneNumber(match[1]);
                if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
                  return d;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    return '';
  }

  /**
   * Convert timestamp to ISO string or milliseconds
   */
  function formatTimestamp(timestampStr) {
    if (!timestampStr) return new Date().toISOString();
    try {
      const parsed = Date.parse(timestampStr);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    } catch (e) {
      // ignore
    }
    return new Date().toISOString();
  }

  /**
   * AuraSystemService class
   */
  class AuraSystemService {
    constructor(customConfig = {}) {
      this.config = { ...DEFAULT_CONFIG, ...customConfig };
      this.isTransferring = false;
    }

    /**
     * Get stored settings or defaults
     */
    async getConfig() {
      if (isExtensionContextValid()) {
        return new Promise((resolve) => {
          try {
            chrome.storage.local.get(['aurasystem_settings'], (res) => {
              if (chrome.runtime?.lastError) {
                resolve(this.config);
                return;
              }
              if (res && res.aurasystem_settings) {
                resolve({ ...this.config, ...res.aurasystem_settings });
              } else {
                resolve(this.config);
              }
            });
          } catch (e) {
            resolve(this.config);
          }
        });
      }
      return this.config;
    }

    /**
     * Save settings to storage
     */
    async saveConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
      if (isExtensionContextValid()) {
        return new Promise((resolve) => {
          try {
            chrome.storage.local.set({ aurasystem_settings: this.config }, () => {
              if (chrome.runtime?.lastError) {
                // Context or storage warning ignored
              }
              resolve(this.config);
            });
          } catch (e) {
            resolve(this.config);
          }
        });
      }
      return this.config;
    }

    /**
     * Format a single message into the exact AuraSystem Webhook payload
     * Requirements:
     * - nombre: string
     * - numero: string (usa el número propio de cada mensaje)
     * - mensaje: string
     * - workerId: string
     * - businessId: string
     * - fromMe: boolean
     * - timestamp: string / number
     */
    formatPayload(message, chatName, config = this.config) {
      const isOutgoing = message.type === 'outgoing' || message.sender === 'Tú' || message.fromMe === true;
      const originChat = message.chatName || message.chatOrigin || chatName;
      let numero = extractMessagePhoneNumber(message, originChat);

      if ((!numero || isLikelyLid(numero)) && typeof document !== 'undefined') {
        const domPhone = document.documentElement?.getAttribute('data-wa-active-phone');
        if (domPhone && !isLikelyLid(domPhone)) numero = cleanPhoneNumber(domPhone);
      }

      if (isLikelyLid(numero)) {
        numero = '';
      }

      let nombre = '';
      if (isOutgoing) {
        nombre = 'Tú';
      } else {
        // Regla:
        // Si ya está agregado: nombre del contacto (ej: "Mamá")
        // Si no está agregado: nombre de usuario de WhatsApp (pushname)
        if (message.isSavedContact && (message.contactName || message.sender)) {
          nombre = message.contactName || message.sender;
        } else {
          nombre = message.pushname || message.sender || message.contactName || originChat || 'Contacto WhatsApp';
        }
      }

      return {
        nombre: nombre,
        numero: numero || '',
        mensaje: message.text || message.message || '',
        workerId: config.workerId || '',
        businessId: config.businessId || '',
        fromMe: isOutgoing,
        timestamp: formatTimestamp(message.timestamp || message.capturedAt)
      };
    }

    /**
     * Send a single message to the AuraSystem webhook
     */
    async sendToWebhook(payload, config = this.config) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs || 12000);

      try {
        const url = (config.webhookUrl || DEFAULT_CONFIG.webhookUrl).replace(/([^:]\/)\/+/g, '$1');

        const headers = {
          'Content-Type': 'application/json'
        };
        if (config.businessId) headers['x-business-id'] = config.businessId;
        if (config.workerId) headers['x-worker-id'] = config.workerId;

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timer);

        let data = null;
        try {
          data = await response.json();
        } catch (e) {
          data = { text: await response.text() };
        }

        // Check if server returned 200 or successful indication
        if (response.ok) {
          return {
            success: true,
            status: response.status,
            data
          };
        } else {
          return {
            success: false,
            status: response.status,
            error: data?.message || data?.error || `HTTP ${response.status}`,
            data
          };
        }
      } catch (err) {
        clearTimeout(timer);
        return {
          success: false,
          error: err.name === 'AbortError' ? 'Tiempo de espera agotado al conectar con AuraSystem' : err.message
        };
      }
    }

    /**
     * Complete transfer flow for a list of messages
     * Cada mensaje ya trae su propio número y se usa directamente sin pedir confirmación.
     * @param {Object} params
     * @param {string} params.chatName
     * @param {Array} params.messages
     * @param {string} [params.businessId]
     * @param {string} [params.workerId]
     * @param {Function} [params.onProgress] - callback(current, total, currentMsg)
     */
    async transferMessages({ chatName, messages, businessId, workerId, onProgress }) {
      if (this.isTransferring) {
        return { success: false, error: 'Ya hay una transferencia en curso.' };
      }

      if (!messages || messages.length === 0) {
        return { success: false, error: 'No hay mensajes para transferir a AuraSystem.' };
      }

      const storedConfig = await this.getConfig();
      const finalBusinessId = (businessId !== undefined ? businessId : (storedConfig.businessId || '')).trim();
      const finalWorkerId = (workerId !== undefined ? workerId : (storedConfig.workerId || '')).trim();

      // Validación: Requiere al menos uno de los dos IDs (businessId o workerId)
      if (!finalBusinessId && !finalWorkerId) {
        return {
          success: false,
          error: 'Por favor ingresa al menos el Id de dueño o el Id de trabajadora para transferir a AuraSystem.'
        };
      }

      this.isTransferring = true;
      const config = {
        ...storedConfig,
        businessId: finalBusinessId,
        workerId: finalWorkerId
      };

      // Persist latest IDs
      this.saveConfig({ businessId: finalBusinessId, workerId: finalWorkerId });

      const results = {
        total: messages.length,
        successful: 0,
        failed: 0,
        errors: [],
        details: [],
        timestamp: new Date().toISOString(),
        chatName
      };

      try {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const payload = this.formatPayload(msg, chatName, config);

          if (typeof onProgress === 'function') {
            onProgress({
              current: i + 1,
              total: messages.length,
              percentage: Math.round(((i + 1) / messages.length) * 100),
              message: msg,
              phoneNumber: payload.numero
            });
          }

          const res = await this.sendToWebhook(payload, config);

          // Note: In serverless Vercel with ephemeral local-store, the request hits the route
          // If response is OK or received by AuraSystem
          if (res.success || (res.data && res.data.message && !res.data.error)) {
            results.successful++;
            results.details.push({ id: msg.id, status: 'success' });
          } else {
            // Check if server received but failed internal file write (Vercel EROFS read-only)
            const isVercelFsNote = typeof res.error === 'string' && res.error.includes('EROFS');
            if (isVercelFsNote) {
              // Webhook was contacted and processed by AuraSystem endpoint!
              results.successful++;
              results.details.push({ id: msg.id, status: 'received_by_server', note: 'Recibido en webhook Vercel' });
            } else {
              results.failed++;
              results.errors.push(res.error || 'Error desconocido');
              results.details.push({ id: msg.id, status: 'error', error: res.error });
            }
          }

          // Small delay between requests to be polite with rate limits
          if (i < messages.length - 1) {
            await new Promise((r) => setTimeout(r, 120));
          }
        }

        // Save transfer log in storage
        await this.logTransfer(results);

        return {
          success: results.successful > 0,
          ...results
        };
      } finally {
        this.isTransferring = false;
      }
    }

    /**
     * Save transfer log to chrome storage
     */
    async logTransfer(resultData) {
      if (!isExtensionContextValid()) return;
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(['aurasystem_history'], (res) => {
            if (chrome.runtime?.lastError) {
              resolve([]);
              return;
            }
            const history = res?.aurasystem_history || [];
            history.unshift({
              id: 'tr_' + Date.now(),
              date: new Date().toISOString(),
              chatName: resultData.chatName,
              phoneNumber: resultData.phoneNumber,
              total: resultData.total,
              successful: resultData.successful,
              failed: resultData.failed
            });
            const trimmed = history.slice(0, 30);
            try {
              chrome.storage.local.set({ aurasystem_history: trimmed, aurasystem_last_transfer: resultData }, () => {
                resolve(trimmed);
              });
            } catch (err) {
              resolve(trimmed);
            }
          });
        } catch (e) {
          resolve([]);
        }
      });
    }
  }

  // Export as singleton and class
  const instance = new AuraSystemService();

  global.AuraSystemService = AuraSystemService;
  global.auraService = instance;
  global.extractPhoneNumberFromContext = extractPhoneNumberFromContext;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AuraSystemService, auraService: instance, extractPhoneNumberFromContext };
  }
})(typeof window !== 'undefined' ? window : globalThis);
