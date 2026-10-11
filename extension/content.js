// WhatsApp Web Message Extractor - Content Script
(function () {
  'use strict';

  console.log('[WA-Extractor] Content script cargado en WhatsApp Web');

  // State
  let currentActiveChat = null;
  let savedChats = {};
  let autoCaptureObserver = null;
  let isAutoCaptureEnabled = false;
  let activeFilter = 'all'; // all | new | today | in | out
  let activeSearch = '';
  let isScanningAll = false;

  // Helper: Strip Unicode bidirectional markers and invisible characters
  function cleanWhatsAppText(str) {
    if (!str) return '';
    return str
      .replace(/[\u200B-\u200D\u200E\u200F\uFEFF\u202A-\u202E]/g, '')
      .trim();
  }

  // Helper: Detect WhatsApp / Meta internal LIDs (Linked Identity)
  function isLikelyLid(val) {
    if (!val) return false;
    const str = typeof val === 'object' ? String(val._serialized || val.id || val.user || '') : String(val);
    if (str.includes('@lid')) return true;
    if (typeof val === 'object' && val.server === 'lid') return true;
    const digits = str.replace(/\D/g, '');
    // Meta / WhatsApp LIDs are typically 14 to 17 digits (commonly 15 digits e.g. 171983392252014)
    if (digits.length >= 14 && digits.startsWith('1')) return true;
    if (digits.length === 15) return true;
    if (digits.length >= 16) return true;
    return false;
  }

  // Helper: Clean phone number to digits only
  function cleanPhoneNumber(raw) {
    if (!raw) return '';
    return String(raw).replace(/\D/g, '');
  }

  // Helper to extract REAL phone digits from any WhatsApp Wid object, string, or property
  function extractDigitsFromAny(val) {
    if (!val) return '';
    if (isLikelyLid(val)) return '';

    if (typeof val === 'string') {
      if (val.includes('@') && !val.includes('@c.us') && !val.includes('@s.whatsapp.net')) return '';
      const match = val.match(/(\d{7,15})@(c\.us|s\.whatsapp\.net)/i) || val.match(/^(\d{7,15})$/);
      if (match) {
        if (isLikelyLid(match[1])) return '';
        return match[1];
      }
      const digits = val.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15 && !isLikelyLid(digits)) return digits;
      return '';
    }

    if (typeof val === 'object') {
      if (val.server && val.server !== 'c.us' && val.server !== 's.whatsapp.net') return '';
      if (val.pnJid) {
        const d = extractDigitsFromAny(val.pnJid);
        if (d) return d;
      }
      if (val.phoneNumber) {
        const d = extractDigitsFromAny(val.phoneNumber);
        if (d) return d;
      }
      if (val.phone) {
        const d = extractDigitsFromAny(val.phone);
        if (d) return d;
      }
      if (val.number) {
        const d = extractDigitsFromAny(val.number);
        if (d) return d;
      }
      if (val.user && (val.server === 'c.us' || val.server === 's.whatsapp.net' || !val.server)) {
        const u = String(val.user);
        if (!isLikelyLid(u) && /^\d{7,15}$/.test(u)) return u;
      }
      if (val._serialized && !isLikelyLid(val._serialized)) {
        return extractDigitsFromAny(val._serialized);
      }
      if (val.id && !isLikelyLid(val.id)) {
        return extractDigitsFromAny(val.id);
      }
    }
    return '';
  }

  // Helper to extract serialized JID string from any Wid object or string
  function extractJidString(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
      if (val._serialized) return String(val._serialized);
      if (val.id) return extractJidString(val.id);
      if (val.user && val.server) return `${val.user}@${val.server}`;
    }
    return '';
  }

  // Helper: Normalize contact names removing accents, emojis, and punctuation (Mamá -> mama)
  function normalizeContactName(str) {
    if (!str) return '';
    return cleanWhatsAppText(String(str))
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Quita tildes: Mamá -> mama
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  // In-memory cache for contacts and chats from WhatsApp Web
  const contactsCache = {
    byPhone: new Map(), // phone digits -> { phone, name, pushname, isSaved }
    byName: new Map(),  // normalized name -> { phone, name, pushname, isSaved }
    byJid: new Map(),   // jid -> { phone, name, pushname, isSaved }
    byLid: new Map()    // lid digits/jid -> { phone, name, pushname, isSaved }
  };
  window.contactsCache = contactsCache;

  // Active chat info captured from WhatsApp React Fiber via page_bridge.js
  let lastActiveBridgeInfo = null;
  window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'WA_EXTRACTOR_PAGE_BRIDGE' && e.data.type === 'ACTIVE_CHAT_INFO') {
      const payload = e.data.payload || {};
      if (payload.phone && !isLikelyLid(payload.phone)) {
        lastActiveBridgeInfo = payload;
        window.waActiveChatPhone = payload.phone;
        const info = {
          phone: payload.phone,
          name: payload.name || '',
          pushname: payload.pushname || '',
          isSaved: !!payload.isSaved
        };
        contactsCache.byPhone.set(payload.phone, info);
        if (payload.name) {
          contactsCache.byName.set(normalizeContactName(payload.name), info);
          contactsCache.byName.set(cleanWhatsAppText(payload.name).toLowerCase(), info);
        }
      }
    }
  });

  /**
   * Sync contacts and chats from WhatsApp Web's IndexedDB ('model-storage')
   */
  async function syncWhatsAppContacts() {
    try {
      // 1. Ask page_bridge.js for active chat info immediately
      window.postMessage({
        source: 'WA_EXTRACTOR_CONTENT_SCRIPT',
        type: 'REQUEST_ACTIVE_CHAT_INFO'
      }, '*');

      // Load persistent verified phone cache
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['wa_real_phone_cache'], (res) => {
          const cache = res?.wa_real_phone_cache || {};
          for (const [key, phone] of Object.entries(cache)) {
            if (phone && !isLikelyLid(phone)) {
              const info = { phone, name: key, pushname: '', isSaved: true };
              contactsCache.byName.set(key, info);
              contactsCache.byPhone.set(phone, info);
              contactsCache.byLid.set(key, info);
            }
          }
          sanitizeSavedChats();
        });
      }

      // Check active chat and auto-explore if phone unknown
      setTimeout(() => {
        const activeName = getActiveChatName();
        if (activeName && activeName !== 'Chat Activo') {
          const norm = normalizeContactName(activeName);
          if (!contactsCache.byName.get(norm)?.phone) {
            exploreContactForRealPhone(activeName, true);
          }
        }
      }, 1500);

      if (typeof indexedDB === 'undefined') return;

      const openDb = (dbName) => new Promise((resolve) => {
        try {
          const req = indexedDB.open(dbName);
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });

      const db = await openDb('model-storage') || await openDb('wawc');
      if (!db) return;

      const lidToPhoneMap = new Map();

      // 1. First pass on 'contact' store: find contacts and build LID <-> phone mappings
      if (db.objectStoreNames.contains('contact')) {
        await new Promise((resolve) => {
          try {
            const tx = db.transaction(['contact'], 'readonly');
            const store = tx.objectStore('contact');
            const req = store.getAll();
            req.onsuccess = () => {
              const contacts = req.result || [];
              
              // Phase A: build LID mappings
              contacts.forEach(c => {
                if (!c) return;
                const idStr = extractJidString(c.id);
                const lidStr = extractJidString(c.lid);
                const lidDigits = (lidStr || (isLikelyLid(idStr) ? idStr : '')).replace(/\D/g, '');
                
                const realPhone = extractDigitsFromAny(c.phoneNumber) ||
                                  extractDigitsFromAny(c.pnJid) ||
                                  (!isLikelyLid(idStr) ? extractDigitsFromAny(c.id) : '');
                
                if (lidDigits && realPhone && !isLikelyLid(realPhone)) {
                  lidToPhoneMap.set(lidDigits, realPhone);
                }
              });

              // Phase B: register contacts
              contacts.forEach(c => {
                if (!c) return;
                const idStr = extractJidString(c.id);
                const lidStr = extractJidString(c.lid);
                const lidDigits = (lidStr || (isLikelyLid(idStr) ? idStr : '')).replace(/\D/g, '');

                let phone = extractDigitsFromAny(c.phoneNumber) ||
                            extractDigitsFromAny(c.pnJid) ||
                            (!isLikelyLid(idStr) ? extractDigitsFromAny(c.id) : '');

                if (!phone && lidDigits) {
                  phone = lidToPhoneMap.get(lidDigits) || '';
                }

                if (isLikelyLid(phone)) phone = '';

                const name = cleanWhatsAppText(c.name || c.formattedName || c.displayName || '');
                const pushname = cleanWhatsAppText(c.pushname || c.notifyName || '');
                const isSaved = c.isMyContact === true || c.isAddressBookContact === true || (name.length > 0 && name !== pushname && name !== phone);

                const info = {
                  id: idStr,
                  phone,
                  name,
                  pushname,
                  isSaved: !!isSaved,
                  lid: lidStr || lidDigits
                };

                if (phone) contactsCache.byPhone.set(phone, info);
                if (name) {
                  const norm = normalizeContactName(name);
                  if (norm) contactsCache.byName.set(norm, info);
                  contactsCache.byName.set(name.toLowerCase(), info);
                  contactsCache.byName.set(name, info);
                }
                if (pushname) {
                  const normPush = normalizeContactName(pushname);
                  if (normPush && !contactsCache.byName.has(normPush)) contactsCache.byName.set(normPush, info);
                }
                if (idStr && !isLikelyLid(idStr)) contactsCache.byJid.set(idStr, info);
                if (lidDigits) contactsCache.byLid.set(lidDigits, info);
                if (lidStr) contactsCache.byLid.set(lidStr, info);
              });
              resolve();
            };
            req.onerror = () => resolve();
          } catch (e) {
            resolve();
          }
        });
      }

      // 2. Process 'chat' store
      if (db.objectStoreNames.contains('chat')) {
        await new Promise((resolve) => {
          try {
            const tx = db.transaction(['chat'], 'readonly');
            const store = tx.objectStore('chat');
            const req = store.getAll();
            req.onsuccess = () => {
              const chats = req.result || [];
              chats.forEach(ch => {
                if (!ch) return;
                const idStr = extractJidString(ch.id);
                const lidDigits = (extractJidString(ch.lid) || (isLikelyLid(idStr) ? idStr : '')).replace(/\D/g, '');

                let phone = extractDigitsFromAny(ch.phoneNumber) ||
                            extractDigitsFromAny(ch.pnJid) ||
                            extractDigitsFromAny(ch.contact);

                if (!phone && lidDigits) {
                  phone = lidToPhoneMap.get(lidDigits) || '';
                }

                if (!phone && !isLikelyLid(idStr)) {
                  phone = extractDigitsFromAny(ch.id);
                }

                if (isLikelyLid(phone)) phone = '';

                const name = cleanWhatsAppText(ch.name || ch.formattedTitle || ch.contact?.name || ch.contact?.formattedName || '');
                const pushname = cleanWhatsAppText(ch.contact?.pushname || '');
                if (phone) {
                  const norm = normalizeContactName(name);
                  const isSaved = !/^\+?\d[\d\s-]+\d$/.test(name) && name.length > 0;
                  const info = {
                    id: idStr,
                    phone,
                    name: name || phone,
                    pushname: pushname,
                    isSaved: isSaved
                  };
                  if (norm) {
                    if (!contactsCache.byName.has(norm) || !contactsCache.byName.get(norm)?.phone) {
                      contactsCache.byName.set(norm, info);
                    }
                  }
                  if (name && (!contactsCache.byName.has(name.toLowerCase()) || !contactsCache.byName.get(name.toLowerCase())?.phone)) {
                    contactsCache.byName.set(name.toLowerCase(), info);
                  }
                  if (!contactsCache.byPhone.has(phone)) {
                    contactsCache.byPhone.set(phone, info);
                  }
                  if (idStr && !isLikelyLid(idStr)) contactsCache.byJid.set(idStr, info);
                  if (lidDigits) contactsCache.byLid.set(lidDigits, info);
                }
              });
              resolve();
            };
            req.onerror = () => resolve();
          } catch (e) {
            resolve();
          }
        });
      }

      db.close();
      sanitizeSavedChats();
    } catch (err) {
      // Ignore background sync errors
    }
  }

  // Safe wrapper for chrome.storage.local.set to prevent "Extension context invalidated"
  function saveToStorage(data, callback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        chrome.storage.local.set(data, () => {
          if (chrome.runtime?.lastError) {
            console.warn('Storage warning:', chrome.runtime.lastError.message);
          }
          if (callback) callback();
        });
      } else {
        if (callback) callback();
      }
    } catch (e) {
      console.warn('Extension context invalidated:', e);
      if (callback) callback();
    }
  }

  // Safe wrapper for chrome.runtime.sendMessage
  function safeSendMessage(message, callback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime?.lastError) {
            // Silently handle invalidated context
          }
          if (callback) callback(res);
        });
      }
    } catch (e) {
      // Extension context invalidated
    }
  }

  // Initialize storage & sync WhatsApp contacts
  syncWhatsAppContacts();
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['wa_saved_chats', 'wa_settings'], (result) => {
        savedChats = result?.wa_saved_chats || {};
        if (result?.wa_settings?.autoCaptureNew) {
          enableAutoCapture(true);
        }
        updateBadge();
        initUI();
        syncWhatsAppContacts();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.wa_saved_chats) {
          savedChats = changes.wa_saved_chats.newValue || {};
          updatePanelUI();
          updateBadge();
        }
      });
    } else {
      initUI();
    }
  } catch (err) {
    initUI();
  }

  // Listen to messages from popup or background
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_CURRENT_CHAT') {
      syncWhatsAppContacts().finally(() => {
        const result = extractMessagesFromCurrentChat('all');
        sendResponse(result);
      });
      return true;
    }
    if (request.action === 'EXTRACT_NEW_MESSAGES') {
      syncWhatsAppContacts().finally(() => {
        const result = extractMessagesFromCurrentChat('new');
        sendResponse(result);
      });
      return true;
    }
    if (request.action === 'EXTRACT_TODAY_MESSAGES') {
      syncWhatsAppContacts().finally(() => {
        const result = extractMessagesFromCurrentChat('today');
        sendResponse(result);
      });
      return true;
    }
    if (request.action === 'SCAN_ALL_TODAY_CHATS') {
      scanAllTodayChats().then(res => sendResponse(res));
      return true;
    }
    if (request.action === 'GET_ACTIVE_CHAT_STATUS') {
      const chatName = getActiveChatName();
      const globalMsgs = getGlobalTodayMessages();
      sendResponse({
        activeChat: chatName,
        savedCount: chatName && savedChats[chatName] ? savedChats[chatName].messages.length : 0,
        todayCount: globalMsgs.length
      });
      return true;
    }
      });
    }
  } catch (err) {
    // Context invalidated
  }

  // Helper: Show toast notification in page
  function showToast(message, icon = '✅') {
    const existing = document.querySelector('.wa-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'wa-toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(15px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  // Helper: Get active chat name from header
  function getActiveChatName() {
    const main = document.querySelector('#main');
    if (!main) return null;

    const titleEl = main.querySelector('header span[dir="auto"], header span[title], header [role="button"] span');
    if (titleEl) {
      const text = cleanWhatsAppText(titleEl.getAttribute('title') || titleEl.innerText);
      if (text && text.length > 0) return text;
    }
    return 'Chat Activo';
  }

  // Helper to extract phone number from open contact info drawer in DOM (outside #side and #main)
  function getPhoneFromContactDrawer() {
    try {
      const candidateTexts = [];

      // 1. Search leaf text elements outside #side (left list) and outside #main (chat messages)
      const allOutside = document.querySelectorAll('body *');
      for (const el of allOutside) {
        if (el.closest('#side') || el.closest('#main')) continue;
        if (el.closest('#wa-message-extractor-panel') || el.closest('#wa-extractor-fab')) continue;

        if (el.children.length <= 2) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt && (txt.includes('+') || /^\d[\d\s\-\(\)]{7,}\d$/.test(txt))) {
            candidateTexts.push(txt);
          }
        }
      }

      // 2. Also check #main header
      const header = document.querySelector('#main header');
      if (header) {
        const headerTexts = header.querySelectorAll('span, div');
        for (const h of headerTexts) {
          const t = (h.innerText || '').trim();
          if (t && t.includes('+')) candidateTexts.push(t);
        }
      }

      for (const txt of candidateTexts) {
        // Matches +57 311 8396385 or +1 (719) 833-9225 etc.
        const match = txt.match(/\+(\d[\d\s\-\(\)]{6,18}\d)/);
        if (match) {
          const d = cleanPhoneNumber(match[1]);
          if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
            return d;
          }
        }
        // Matches formatted number without +: 57 311 8396385
        if (/^\d{1,4}[\s\-\.]\d{2,4}[\s\-\.]?\d{3,4}[\s\-\.]?\d{3,4}$/.test(txt)) {
          const d = cleanPhoneNumber(txt);
          if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
            return d;
          }
        }
      }
    } catch (e) {}
    return '';
  }

  function triggerCloseContactDrawer() {
    const closeSelectors = [
      'button[aria-label*="Cerrar"]',
      'button[aria-label*="Close"]',
      '[data-testid="btn-closer"]',
      '[data-testid="x"]',
      '[data-icon="x"]',
      'span[data-icon="x"]'
    ];
    for (const sel of closeSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (!el.closest('#side') && !el.closest('#main') && !el.closest('#wa-message-extractor-panel')) {
          const btn = el.closest('button') || el;
          btn.click();
          return true;
        }
      }
    }
    return false;
  }

  // Register a discovered real phone number across all caches and DOM
  function registerDiscoveredPhone(contactName, phone, lidDigits = '') {
    if (!phone || isLikelyLid(phone)) return;
    const clean = cleanPhoneNumber(phone);
    if (!clean || clean.length < 7 || clean.length > 15 || isLikelyLid(clean)) return;

    try {
      document.documentElement.setAttribute('data-wa-active-phone', clean);
      if (contactName) document.documentElement.setAttribute('data-wa-active-name', contactName);
    } catch (e) {}
    window.waActiveChatPhone = clean;

    const info = {
      phone: clean,
      name: contactName || '',
      pushname: '',
      isSaved: true
    };
    contactsCache.byPhone.set(clean, info);
    if (contactName) {
      const norm = normalizeContactName(contactName);
      contactsCache.byName.set(norm, info);
      contactsCache.byName.set(contactName.toLowerCase(), info);
      contactsCache.byName.set(contactName, info);
    }
    if (lidDigits) {
      contactsCache.byLid.set(lidDigits, info);
      contactsCache.byLid.set(lidDigits + '@lid', info);
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['wa_real_phone_cache'], (res) => {
        const cache = res?.wa_real_phone_cache || {};
        if (contactName) {
          cache[normalizeContactName(contactName)] = clean;
          cache[contactName] = clean;
        }
        if (lidDigits) {
          cache[lidDigits] = clean;
        }
        cache[clean] = clean;
        chrome.storage.local.set({ wa_real_phone_cache: cache });
      });
    }

    // Retroactively purge any LIDs in savedChats and update to real verified phone
    let updated = false;
    for (const chatKey of Object.keys(savedChats)) {
      const chat = savedChats[chatKey];
      if (!chat || !Array.isArray(chat.messages)) continue;
      chat.messages.forEach(m => {
        const isTarget = (contactName && (m.chatName === contactName || m.sender === contactName)) ||
                         (lidDigits && (cleanPhoneNumber(m.numero) === lidDigits || cleanPhoneNumber(m.phone) === lidDigits));
        if (isTarget) {
          if (!m.numero || isLikelyLid(m.numero) || m.numero !== clean) {
            m.numero = clean;
            m.phone = clean;
            updated = true;
          }
        }
      });
    }

    if (updated) {
      saveToStorage({ wa_saved_chats: savedChats }, () => {
        updatePanelUI();
      });
    }
  }

  // Programmatically explore the contact in WhatsApp Web to extract real phone number
  let isExploringContact = false;
  async function exploreContactForRealPhone(targetChatName, autoClose = false) {
    if (isExploringContact) return '';
    isExploringContact = true;
    try {
      if (!targetChatName || targetChatName === 'Chat Activo') {
        targetChatName = getActiveChatName();
      }
      const norm = normalizeContactName(targetChatName);
      if (contactsCache.byName.get(norm)?.phone) {
        return contactsCache.byName.get(norm).phone;
      }

      // 1. Check if drawer is already open in DOM
      let phone = getPhoneFromContactDrawer();
      if (phone && !isLikelyLid(phone)) {
        registerDiscoveredPhone(targetChatName, phone);
        return phone;
      }

      // 2. Click the conversation header to open drawer
      const header = document.querySelector('#main header');
      if (!header) return '';

      const clickable = header.querySelector('[data-testid="conversation-info-header"]') ||
                        header.querySelector('div[role="button"][tabindex="0"]') ||
                        header.querySelector('div[role="button"]:has(span[dir="auto"])') ||
                        header.querySelector('div[role="button"]') ||
                        header.children[1] ||
                        header;

      if (clickable) {
        clickable.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

        // Wait up to 600ms for drawer to render
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 100));
          phone = getPhoneFromContactDrawer();
          if (phone && !isLikelyLid(phone)) break;
        }

        if (phone && !isLikelyLid(phone)) {
          registerDiscoveredPhone(targetChatName, phone);
        }

        // 3. Auto-close if requested and drawer was opened by us
        if (autoClose) {
          triggerCloseContactDrawer();
        }
      }

      return phone || '';
    } catch (err) {
      return '';
    } finally {
      isExploringContact = false;
    }
  }

  // Observer for contact drawer: whenever the drawer is open or opens, grab real phone!
  try {
    const drawerObserver = new MutationObserver(() => {
      const phone = getPhoneFromContactDrawer();
      if (phone && !isLikelyLid(phone)) {
        const activeName = getActiveChatName();
        if (activeName && activeName !== 'Chat Activo') {
          registerDiscoveredPhone(activeName, phone);
        }
      }
    });
    drawerObserver.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

  // Retroactively clean up any LIDs in savedChats
  function sanitizeSavedChats() {
    let changed = false;
    for (const chatKey of Object.keys(savedChats)) {
      const chat = savedChats[chatKey];
      if (!chat || !Array.isArray(chat.messages)) continue;
      chat.messages.forEach(m => {
        if (isLikelyLid(m.numero) || isLikelyLid(m.phone)) {
          const norm = normalizeContactName(m.chatName || m.sender || '');
          const real = contactsCache.byName.get(norm)?.phone ||
                       contactsCache.byLid.get(cleanPhoneNumber(m.numero))?.phone ||
                       '';
          m.numero = (!isLikelyLid(real) && real) ? real : '';
          m.phone = m.numero;
          changed = true;
        }
      });
    }
    if (changed) {
      saveToStorage({ wa_saved_chats: savedChats });
    }
  }

  /**
   * Helper: Resolve contact details for a chat:
   * Rule:
   * 1. Contactos ya agregados: se le pone el nombre del contacto, con su número de teléfono real.
   * 2. Números no agregados: se le pone el nombre de usuario de WhatsApp, con su número de teléfono.
   * Los números de teléfono NUNCA pueden ser identificadores internos LID de Meta/WhatsApp.
   */
  function resolveChatContactInfo(chatName) {
    const rawClean = cleanWhatsAppText(chatName);
    const digitsInTitle = cleanPhoneNumber(rawClean);
    const isTitlePhone = digitsInTitle.length >= 7 && digitsInTitle.length <= 15 && !isLikelyLid(digitsInTitle) && (/^\+/.test(rawClean) || /^\d[\d\s\-\(\)]+\d$/.test(rawClean));

    let phoneNumber = '';
    let contactName = '';
    let pushname = '';
    let isSavedContact = false;

    // 1. Verificación instantánea vía atributos DOM compartidos con page_bridge.js (Main World)
    const domActivePhone = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-wa-active-phone') : '';
    const domActiveName = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-wa-active-name') : '';
    const domActivePushname = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-wa-active-pushname') : '';

    if (isTitlePhone) {
      // Número no agregado en agenda
      phoneNumber = digitsInTitle;
      isSavedContact = false;

      // Buscar nombre de usuario (~Usuario) en el encabezado
      const mainHeader = document.querySelector('#main header');
      if (mainHeader) {
        const headerText = mainHeader.innerText || '';
        const tildeMatch = headerText.match(/~([^\n\r]+)/);
        if (tildeMatch && tildeMatch[1]) {
          pushname = cleanWhatsAppText(tildeMatch[1].replace(/~/g, ''));
        }
      }
      if (!pushname && domActivePushname) pushname = domActivePushname;

      // Buscar en caché por número
      const cached = contactsCache.byPhone.get(phoneNumber);
      if (cached) {
        if (!pushname && cached.pushname) pushname = cached.pushname;
        if (cached.isSaved && cached.name && cached.name !== phoneNumber && cached.name !== rawClean) {
          contactName = cached.name;
          isSavedContact = true;
        }
      }
    } else {
      // Contacto ya agregado (nombre de contacto como "Dr. Juan" o "Mamá")
      contactName = rawClean;
      isSavedContact = true;

      const activeChatName = getActiveChatName();
      const isCurrentActive = !chatName || chatName === 'Chat Activo' || chatName === activeChatName ||
        (domActiveName && (domActiveName === rawClean || normalizeContactName(domActiveName) === normalizeContactName(rawClean)));

      const norm = normalizeContactName(rawClean);

      // A. Buscar en caché verificado por nombre (exacto y normalizado sin acentos)
      let cached = contactsCache.byName.get(norm) ||
                   contactsCache.byName.get(rawClean.toLowerCase()) ||
                   contactsCache.byName.get(rawClean);

      if (!cached && norm) {
        for (const [key, val] of contactsCache.byName.entries()) {
          if (key === norm || key.includes(norm) || norm.includes(key)) {
            if (val && val.phone && !isLikelyLid(val.phone)) {
              cached = val;
              break;
            }
          }
        }
      }

      if (cached && cached.phone && !isLikelyLid(cached.phone)) {
        phoneNumber = cached.phone;
        if (cached.pushname) pushname = cached.pushname;
        if (cached.name) contactName = cached.name;
      }

      // B. Buscar directamente en el panel lateral / drawer de información de contacto abierto en WhatsApp Web
      if (!phoneNumber) {
        const drawerPhone = getPhoneFromContactDrawer();
        if (drawerPhone && !isLikelyLid(drawerPhone)) {
          phoneNumber = drawerPhone;
          registerDiscoveredPhone(rawClean, drawerPhone);
        }
      }

      // C. Comprobar si el bridge del DOM tiene el teléfono verificado del chat activo
      if (!phoneNumber && isCurrentActive && domActivePhone && !isLikelyLid(domActivePhone)) {
        phoneNumber = cleanPhoneNumber(domActivePhone);
        if (domActivePushname) pushname = domActivePushname;
      }

      // D. Comprobar lastActiveBridgeInfo o window.waActiveChatPhone
      if (!phoneNumber && isCurrentActive) {
        if (lastActiveBridgeInfo && lastActiveBridgeInfo.phone && !isLikelyLid(lastActiveBridgeInfo.phone)) {
          phoneNumber = cleanPhoneNumber(lastActiveBridgeInfo.phone);
          if (lastActiveBridgeInfo.pushname) pushname = lastActiveBridgeInfo.pushname;
        } else if (window.waActiveChatPhone && !isLikelyLid(window.waActiveChatPhone)) {
          phoneNumber = cleanPhoneNumber(window.waActiveChatPhone);
        }
      }

      // E. Buscar en los mensajes de #main por atributo data-id (@c.us JID o @lid mapeado)
      if (!phoneNumber) {
        const main = document.querySelector('#main');
        if (main) {
          const msgWithJid = main.querySelector('div[data-id*="@c.us"], div[data-id*="@s.whatsapp.net"]');
          if (msgWithJid) {
            const dataId = msgWithJid.getAttribute('data-id') || '';
            const match = dataId.match(/(\d{7,15})@(c\.us|s\.whatsapp\.net)/i);
            if (match && match[1] && !isLikelyLid(match[1])) {
              phoneNumber = match[1];
            }
          }

          if (!phoneNumber) {
            const msgWithLid = main.querySelector('div[data-id*="@lid"]');
            if (msgWithLid) {
              const dataId = msgWithLid.getAttribute('data-id') || '';
              const matchLid = dataId.match(/(\d{8,25})@lid/i);
              if (matchLid && matchLid[1]) {
                const cachedLid = contactsCache.byLid.get(matchLid[1]) || contactsCache.byLid.get(matchLid[1] + '@lid');
                if (cachedLid && cachedLid.phone && !isLikelyLid(cachedLid.phone)) {
                  phoneNumber = cachedLid.phone;
                }
              }
            }
          }
        }
      }

      // F. Buscar en el texto o subtítulo del encabezado si tiene formato de número
      if (!phoneNumber) {
        const headerText = document.querySelector('#main header')?.innerText || '';
        const matchHeader = headerText.match(/(\+?\d[\d\s-]{7,15}\d)/);
        if (matchHeader) {
          const d = cleanPhoneNumber(matchHeader[1]);
          if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
            phoneNumber = d;
          }
        }
      }

      // G. Explorar el contacto si está abierto en #main y aún no tenemos el número real
      if ((!phoneNumber || isLikelyLid(phoneNumber)) && isCurrentActive && typeof document !== 'undefined') {
        exploreContactForRealPhone(rawClean, true).then(found => {
          if (found && !isLikelyLid(found)) {
            registerDiscoveredPhone(rawClean, found);
          }
        });
      }
    }

    if (isLikelyLid(phoneNumber)) {
      phoneNumber = '';
    }

    let displayName = '';
    if (isSavedContact) {
      displayName = contactName || rawClean;
    } else {
      displayName = pushname || (phoneNumber ? `+${phoneNumber}` : rawClean);
    }

    return {
      phoneNumber,
      contactName,
      pushname,
      isSavedContact,
      displayName
    };
  }

  /**
   * Helper: Parse date from data-pre-plain-text (ej: "[10:35, 10/10/2026] Juan: ")
   * Devuelve true si la fecha es hoy, false si es de otro día, o null si no hay fecha válida.
   */
  function isPrePlainTextToday(rawMeta) {
    if (!rawMeta) return null;
    const cleanMeta = cleanWhatsAppText(rawMeta);
    const bracketMatch = cleanMeta.match(/\[(.*?)\]/);
    if (!bracketMatch) return null;
    const content = bracketMatch[1].trim();

    // Patrón fecha DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
    const dateMatch = content.match(/(\d{1,4})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/);
    if (dateMatch) {
      const now = new Date();
      const todayYear = now.getFullYear();
      const todayMonth = now.getMonth() + 1;
      const todayDay = now.getDate();

      let p1 = parseInt(dateMatch[1], 10);
      let p2 = parseInt(dateMatch[2], 10);
      let p3 = parseInt(dateMatch[3], 10);

      if (p3 < 100) p3 += 2000;
      if (p1 < 100 && p3 > 1000) {
        const isYear = p3 === todayYear;
        const isDayMonth = (p1 === todayDay && p2 === todayMonth) || (p2 === todayDay && p1 === todayMonth);
        if (isYear && isDayMonth) return true;
        return false;
      } else if (p1 > 1000) {
        if (p1 === todayYear && p2 === todayMonth && p3 === todayDay) return true;
        return false;
      }
    }

    const lower = content.toLowerCase();
    if (lower.includes('hoy') || lower.includes('today') || lower.includes('hoje')) return true;
    if (lower.includes('ayer') || lower.includes('yesterday') || lower.includes('ontem')) return false;

    return null;
  }

  /**
   * Helper: Determinar si un separador de fecha de WhatsApp corresponde a hoy
   */
  function isDateDividerToday(dividerText) {
    if (!dividerText) return null;
    const lower = cleanWhatsAppText(dividerText).toLowerCase();

    if (/\b(hoy|today|hoje)\b/i.test(lower)) return true;
    if (/\b(ayer|yesterday|ontem)\b/i.test(lower)) return false;

    // Días de la semana pasados (lunes, martes, etc.)
    if (/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda|ter[cç]a|quarta|quinta|sexta)\b/i.test(lower)) {
      return false;
    }

    // Fechas explícitas pasadas (ej: "8 de octubre", "08/10/2026")
    if (/\d{1,2}\s+de\s+[a-z]+/i.test(lower) || /\d{1,2}[\/\.-]\d{1,2}/.test(lower)) {
      const now = new Date();
      const todayDay = now.getDate();
      const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const currentMonthName = monthNames[now.getMonth()];
      if (lower.includes(String(todayDay)) && lower.includes(currentMonthName)) {
        return true;
      }
      return false;
    }

    return null;
  }

  /**
   * Helper: Verificar estrictamente si el mensaje corresponde a hoy
   */
  function isDateToday(rawMeta, timestamp, sectionIsToday) {
    // 1. Si data-pre-plain-text tiene fecha explícita, es la fuente más precisa
    const preDate = isPrePlainTextToday(rawMeta);
    if (preDate === true) return true;
    if (preDate === false) return false;

    // 2. Si el separador de sección previo es conocido
    if (sectionIsToday === true) return true;
    if (sectionIsToday === false) return false;

    // 3. Verificaciones de palabras clave en timestamp
    const cleanTs = cleanWhatsAppText(timestamp).toLowerCase();
    if (
      cleanTs.includes('ayer') ||
      cleanTs.includes('yesterday') ||
      cleanTs.includes('ontem') ||
      /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(cleanTs) ||
      /\d{1,2}[\/\.-]\d{1,2}/.test(cleanTs) ||
      /\d{1,2}\s+de\s+[a-z]+/i.test(cleanTs)
    ) {
      return false;
    }

    // Si es ambiguo sin ninguna confirmación de ser de hoy, no asumir hoy
    return false;
  }

  // Helper: Retrieve all today messages across all saved chats and the global collection
  function getGlobalTodayMessages() {
    const all = [];
    const seen = new Set();

    if (savedChats['__TODAY_ALL__']?.messages?.length > 0) {
      savedChats['__TODAY_ALL__'].messages.forEach(m => {
        if (m.isToday && !seen.has(m.id)) {
          seen.add(m.id);
          all.push(m);
        }
      });
    }

    Object.keys(savedChats).forEach(chatName => {
      if (chatName === '__TODAY_ALL__') return;
      const chatMsgs = savedChats[chatName]?.messages || [];
      chatMsgs.forEach(m => {
        if (m.isToday && !seen.has(m.id)) {
          seen.add(m.id);
          all.push({ ...m, chatName: m.chatName || chatName });
        }
      });
    });

    return all;
  }

  // Trigger click safely across WhatsApp React event listeners
  function triggerChatClick(element) {
    if (!element) return;
    const candidates = [
      element.querySelector('span[title]'),
      element.querySelector('div[role="gridcell"]'),
      element.querySelector('div[tabindex="-1"]'),
      element.querySelector('div[role="button"]'),
      element.querySelector('div._ak8l, div._ak8o, div._ak72'),
      element
    ].filter(Boolean);

    candidates.forEach(target => {
      try {
        if (typeof target.focus === 'function') target.focus();
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, pointerType: 'mouse', isPrimary: true }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, buttons: 1, detail: 1 }));
        target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, pointerType: 'mouse', isPrimary: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, buttons: 0, detail: 1 }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: 1 }));
        if (typeof target.click === 'function') target.click();
      } catch (err) {
        // Continue
      }
    });
  }

  // Internal extractor for currently open chat in #main
  function extractMessagesInternal(mode = 'all', forcedChatName = null) {
    const isNewOnly = mode === 'new';
    const isTodayOnly = mode === 'today';

    const main = document.querySelector('#main');
    if (!main) return [];

    const chatName = forcedChatName || getActiveChatName() || 'Chat Sin Nombre';
    const chatContactInfo = resolveChatContactInfo(chatName);

    const allRows = main.querySelectorAll('div[data-id], div[role="row"], div.message-in, div.message-out, div[data-testid="msg-container"]');
    if (!allRows || allRows.length === 0) return [];

    const previousMessages = savedChats[chatName]?.messages || [];
    const prevIds = new Set(previousMessages.map(m => m.id));

    // Pre-escaneo de separadores de fecha en el chat
    let hasTodayDivider = false;
    let hasPastDivider = false;
    allRows.forEach((el) => {
      const isBubble = el.classList.contains('message-in') || el.classList.contains('message-out') ||
        !!el.querySelector('span.selectable-text, div.copyable-text, [data-icon="msg-check"], [data-icon="msg-dblcheck"]');
      if (!isBubble) {
        const text = el.innerText || '';
        const divCheck = isDateDividerToday(text);
        if (divCheck === true) hasTodayDivider = true;
        if (divCheck === false) hasPastDivider = true;
      }
    });

    const extracted = [];
    const seenMsgIds = new Set();
    let foundUnreadSeparator = false;
    // Si hay separador "HOY", los mensajes previos a él no son de hoy
    // Si solo hay separadores pasados ("AYER", días de semana), los mensajes no son de hoy
    let currentSectionIsToday = hasTodayDivider ? false : (hasPastDivider ? false : null);

    allRows.forEach((el) => {
      const rawText = el.innerText || '';
      const textContent = cleanWhatsAppText(rawText);
      const lowerText = textContent.toLowerCase();

      const isMessageBubble = el.classList.contains('message-in') || el.classList.contains('message-out') ||
        !!el.querySelector('span.selectable-text, div.copyable-text, [data-icon="msg-check"], [data-icon="msg-dblcheck"]');

      // Comprobar separadores de fecha SOLO en filas que no sean burbujas de mensaje
      if (!isMessageBubble) {
        const dividerCheck = isDateDividerToday(textContent);
        if (dividerCheck !== null) {
          currentSectionIsToday = dividerCheck;
          return;
        }
      }

      if (
        lowerText.includes('mensaje no leído') ||
        lowerText.includes('mensajes no leídos') ||
        lowerText.includes('unread message')
      ) {
        foundUnreadSeparator = true;
        return;
      }

      const isOutgoing = el.classList.contains('message-out') ||
        !!el.querySelector('[data-icon="msg-dblcheck"], [data-icon="msg-check"]') ||
        el.getAttribute('data-id')?.includes('true_');

      const isIncoming = el.classList.contains('message-in') || !isOutgoing;

      let timestamp = '';
      let rawMeta = '';
      const prePlainTextEl = el.hasAttribute('data-pre-plain-text') ? el : el.querySelector('[data-pre-plain-text]');
      if (prePlainTextEl) {
        rawMeta = prePlainTextEl.getAttribute('data-pre-plain-text') || '';
        const timeMatch = rawMeta.match(/\[(.*?)\]/);
        if (timeMatch) timestamp = cleanWhatsAppText(timeMatch[1]);
      }

      if (!timestamp) {
        const timeEl = el.querySelector('span[dir="auto"].copyable-text, span.selectable-text + span, div[data-testid="msg-meta"] span');
        if (timeEl && timeEl.innerText && /\d{1,2}:\d{2}/.test(timeEl.innerText)) {
          timestamp = cleanWhatsAppText(timeEl.innerText);
        } else {
          timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }

      let text = '';
      const textSpan = el.querySelector('span.selectable-text, div.copyable-text, span[dir="ltr"], span[dir="rtl"]');
      if (textSpan) {
        text = cleanWhatsAppText(textSpan.innerText);
      }

      if (!text) {
        if (el.querySelector('audio, [data-icon="audio-play"], [data-icon="audio-pause"]')) {
          text = '🎵 [Mensaje de voz / Audio]';
        } else if (el.querySelector('img[src*="blob:"], [data-icon="image"]')) {
          text = '📷 [Imagen / Foto]';
        } else if (el.querySelector('video, [data-icon="video"]')) {
          text = '🎥 [Video]';
        } else if (el.querySelector('[data-icon="document"]')) {
          text = '📄 [Documento / Archivo]';
        } else if (el.querySelector('[data-icon="sticker"]')) {
          text = '👾 [Sticker]';
        } else {
          const lines = textContent.split('\n').filter(l => l.trim().length > 0 && !/\d{1,2}:\d{2}/.test(l));
          if (lines.length > 0) text = lines.join(' ');
        }
      }

      if (!text || text.trim().length === 0) return;

      const isToday = isDateToday(rawMeta, timestamp, currentSectionIsToday);

      // RESOLUCIÓN DE NÚMERO Y NOMBRE DE REMITENTE SEGÚN REGLA:
      // 1. Número de usuario siempre presente
      // 2. Si no hay número agregado: nombre de usuario de WhatsApp
      // 3. Contactos ya agregados: nombre del contacto
      let sender = '';
      let msgNumero = (!isLikelyLid(chatContactInfo.phoneNumber)) ? chatContactInfo.phoneNumber : '';

      const rowDataId = el.getAttribute('data-id') || el.closest('[data-id]')?.getAttribute('data-id') || '';
      const matchJid = rowDataId.match(/(\d{7,15})@(c\.us|s\.whatsapp\.net)/i);
      if (matchJid && matchJid[1] && !isLikelyLid(matchJid[1])) {
        msgNumero = matchJid[1];
      }

      if (!msgNumero || isLikelyLid(msgNumero)) {
        const matchLid = rowDataId.match(/(\d{8,25})@lid/i);
        if (matchLid && matchLid[1]) {
          const cachedLid = contactsCache.byLid.get(matchLid[1]) || contactsCache.byLid.get(matchLid[1] + '@lid');
          if (cachedLid && cachedLid.phone && !isLikelyLid(cachedLid.phone)) {
            msgNumero = cachedLid.phone;
          }
        }
      }

      if (!msgNumero || isLikelyLid(msgNumero)) {
        const norm = normalizeContactName(chatName);
        const cached = contactsCache.byName.get(norm) || contactsCache.byName.get(chatName);
        if (cached && cached.phone && !isLikelyLid(cached.phone)) {
          msgNumero = cached.phone;
        }
      }

      if (!msgNumero || isLikelyLid(msgNumero)) {
        const domPhone = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-wa-active-phone') : '';
        if (domPhone && !isLikelyLid(domPhone)) {
          msgNumero = cleanPhoneNumber(domPhone);
        } else if (lastActiveBridgeInfo && lastActiveBridgeInfo.phone && !isLikelyLid(lastActiveBridgeInfo.phone)) {
          msgNumero = cleanPhoneNumber(lastActiveBridgeInfo.phone);
        } else if (window.waActiveChatPhone && !isLikelyLid(window.waActiveChatPhone)) {
          msgNumero = cleanPhoneNumber(window.waActiveChatPhone);
        }
      }

      if (!msgNumero || isLikelyLid(msgNumero)) {
        const drawerPhone = getPhoneFromContactDrawer();
        if (drawerPhone && !isLikelyLid(drawerPhone)) {
          msgNumero = drawerPhone;
          registerDiscoveredPhone(chatName, drawerPhone);
        }
      }

      if (isLikelyLid(msgNumero)) {
        msgNumero = '';
      }

      if (isOutgoing) {
        sender = 'Tú';
      } else {
        if (chatContactInfo.isSavedContact) {
          // Contacto ya agregado: se usa el nombre del contacto
          sender = chatContactInfo.contactName || chatName;
        } else {
          // No agregado: se le pone el nombre de usuario
          let rowPushname = chatContactInfo.pushname;
          const senderSpan = el.querySelector('span[dir="auto"][role="button"], span[aria-label]');
          if (senderSpan && senderSpan.innerText) {
            const spanText = cleanWhatsAppText(senderSpan.innerText);
            if (spanText && spanText !== chatName && !/^\+?\d[\d\s-]+\d$/.test(spanText)) {
              rowPushname = spanText.replace(/^~/, '').trim();
            }
          }
          sender = rowPushname || chatContactInfo.displayName || (msgNumero ? `+${msgNumero}` : chatName);
        }
      }

      const id = `${chatName}_${timestamp}_${sender}_${text.substring(0, 30)}`.replace(/\s+/g, '_');

      // Evitar duplicados
      if (seenMsgIds.has(id)) return;
      seenMsgIds.add(id);

      const isNew = foundUnreadSeparator || !prevIds.has(id);

      if (isNewOnly && !isNew) return;
      if (isTodayOnly && !isToday) return; // FILTRO ESTRICTO DE HOY: descarta ayer o días pasados

      extracted.push({
        id,
        chatName,
        sender,
        senderName: sender,
        contactName: chatContactInfo.contactName || (chatContactInfo.isSavedContact ? chatName : ''),
        pushname: chatContactInfo.pushname || '',
        isSavedContact: chatContactInfo.isSavedContact,
        numero: msgNumero,
        phone: msgNumero,
        text,
        timestamp,
        type: isOutgoing ? 'outgoing' : 'incoming',
        isNew,
        isToday,
        capturedAt: new Date().toISOString()
      });
    });

    if (extracted.length > 0) {
      if (!savedChats[chatName]) {
        savedChats[chatName] = {
          name: chatName,
          lastUpdated: new Date().toISOString(),
          messages: []
        };
      }
      const currentMap = new Map(savedChats[chatName].messages.map(m => [m.id, m]));
      extracted.forEach(m => currentMap.set(m.id, m));
      savedChats[chatName].messages = Array.from(currentMap.values());
      savedChats[chatName].lastUpdated = new Date().toISOString();
    }

    return extracted;
  }

  // Single chat extraction
  function extractMessagesFromCurrentChat(mode = 'all') {
    const main = document.querySelector('#main');
    if (!main) {
      showToast('Por favor abre una conversación en WhatsApp Web', '⚠️');
      return { success: false, error: 'No active chat open' };
    }

    const chatName = getActiveChatName() || 'Chat Sin Nombre';
    currentActiveChat = chatName;

    const extracted = extractMessagesInternal(mode);

    if (extracted.length === 0) {
      const modeLabel = mode === 'today' ? 'del día actual' : (mode === 'new' ? 'nuevos' : '');
      showToast(`No se encontraron mensajes ${modeLabel} en este chat`, 'ℹ️');
      return { success: true, count: 0, messages: [], chatName };
    }

    saveToStorage({ wa_saved_chats: savedChats }, () => {
      updateBadge();
      updatePanelUI();
      const modeText = mode === 'today' ? 'de hoy ' : (mode === 'new' ? 'nuevos ' : '');
      showToast(`¡${extracted.length} mensajes ${modeText}capturados!`, '📥');
      openPanel();
    });

    return {
      success: true,
      chatName,
      count: extracted.length,
      messages: extracted
    };
  }

  // SCAN ALL TODAY CHATS AUTOMATICALLY!
  async function scanAllTodayChats() {
    if (isScanningAll) {
      showToast('Ya hay un escaneo en curso...', '⏳');
      return { success: false, inProgress: true };
    }

    // Sincronizar libreta de contactos desde IndexedDB primero
    await syncWhatsAppContacts();

    const paneSide = document.querySelector('#pane-side, div[aria-label="Chat list"], div[role="grid"]');
    if (!paneSide) {
      showToast('No se encontró la lista de chats en WhatsApp Web', '⚠️');
      return { success: false, error: 'Chat list not found' };
    }

    // Solo seleccionar contenedores de chat directos
    const chatItems = Array.from(paneSide.querySelectorAll('div[role="listitem"], div[role="row"]'));
    if (chatItems.length === 0) {
      showToast('No hay chats visibles en la lista de WhatsApp Web', 'ℹ️');
      return { success: false, error: 'No chats visible' };
    }

    const todayChats = [];
    const seenTitles = new Set();

    chatItems.forEach((item) => {
      const titleEl = item.querySelector('span[title], span[dir="auto"]');
      const title = titleEl ? cleanWhatsAppText(titleEl.getAttribute('title') || titleEl.innerText) : '';
      if (!title || title.length === 0 || seenTitles.has(title)) return;

      let isTodayChat = false;
      let timeText = '';
      const textEls = item.querySelectorAll('span, div');
      for (const el of textEls) {
        const txt = cleanWhatsAppText(el.innerText);
        // Exclusivamente horas del día actual (HH:MM o HH:MM a.m./p.m.)
        // NO debe contener palabras de ayer, días de la semana, ni fechas numéricas
        if (
          /^(\d{1,2}:\d{2})(\s*[ap]\.?\s*m\.?)?$/i.test(txt) &&
          !/ayer|yesterday|ontem|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[\/\.-]\d{1,2}/i.test(txt)
        ) {
          isTodayChat = true;
          timeText = txt;
          break;
        }
      }

      if (isTodayChat) {
        seenTitles.add(title);
        todayChats.push({ element: item, title, timeText });
      }
    });

    if (todayChats.length === 0) {
      showToast('No se detectaron chats con mensajes de hoy en la lista visible', 'ℹ️');
      return { success: true, count: 0, messages: [] };
    }

    isScanningAll = true;
    showToast(`Escaneando automáticamente ${todayChats.length} chats de hoy...`, '🚀');
    openPanel();

    const allAggregatedMessages = [];
    const scannedNames = new Set();

    try {
      for (let i = 0; i < todayChats.length; i++) {
        const chat = todayChats[i];
        if (scannedNames.has(chat.title)) continue;
        scannedNames.add(chat.title);

        showToast(`Escaneando (${i + 1}/${todayChats.length}): ${chat.title}...`, '⏳');

        triggerChatClick(chat.element);

        // Esperar a que rendericen los mensajes de este chat en #main
        for (let wait = 0; wait < 8; wait++) {
          await new Promise(r => setTimeout(r, 200));
          const main = document.querySelector('#main');
          if (main && main.querySelectorAll('div[data-id], div[role="row"], div.message-in, div.message-out').length > 0) {
            break;
          }
        }

        // Extraer ÚNICAMENTE mensajes de hoy
        const msgs = extractMessagesInternal('today', chat.title);

        if (msgs && msgs.length > 0) {
          allAggregatedMessages.push(...msgs);

          if (!savedChats[chat.title]) {
            savedChats[chat.title] = {
              name: chat.title,
              lastUpdated: new Date().toISOString(),
              messages: []
            };
          }
          const chatMap = new Map(savedChats[chat.title].messages.map(m => [m.id, m]));
          msgs.forEach(m => chatMap.set(m.id, m));
          savedChats[chat.title].messages = Array.from(chatMap.values());
          savedChats[chat.title].lastUpdated = new Date().toISOString();
        }
      }

      const uniqueMap = new Map();
      allAggregatedMessages.forEach(m => uniqueMap.set(m.id, m));
      const finalTodayList = Array.from(uniqueMap.values());

      savedChats['__TODAY_ALL__'] = {
        name: '🌟 Todos los chats de hoy (Global)',
        lastUpdated: new Date().toISOString(),
        messages: finalTodayList
      };

      currentActiveChat = '__TODAY_ALL__';
      activeFilter = 'all';

      // Reset filter tags UI active state
      const filterTags = document.querySelectorAll('.wa-filter-tags .wa-tag');
      if (filterTags) {
        filterTags.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      }

      saveToStorage({ wa_saved_chats: savedChats }, () => {
        updateBadge();
        updatePanelUI();
        showToast(`¡Listo! ${finalTodayList.length} mensajes de hoy extraídos en ${scannedNames.size} chats`, '✅');
      });

      return {
        success: true,
        totalMessages: finalTodayList.length,
        chatsCount: scannedNames.size,
        messages: finalTodayList
      };
    } finally {
      isScanningAll = false;
    }
  }

  // Update extension badge count
  function updateBadge() {
    let total = 0;
    Object.values(savedChats).forEach(c => {
      if (c.name !== '🌟 Todos los chats de hoy (Global)') {
        total += (c.messages || []).length;
      }
    });
    if (total === 0 && savedChats['__TODAY_ALL__']) {
      total = savedChats['__TODAY_ALL__'].messages.length;
    }
    safeSendMessage({ action: 'UPDATE_BADGE', count: total });
    const badgeEl = document.querySelector('#wa-extractor-fab .badge-count');
    if (badgeEl) badgeEl.textContent = total;
  }

  // Inject Hover Action Buttons in Chat List items
  function injectHoverListeners() {
    const paneSide = document.querySelector('#pane-side, div[aria-label="Chat list"], div[role="grid"]');
    if (!paneSide) return;

    const chatItems = paneSide.querySelectorAll('div[role="listitem"], div[role="row"], div[tabindex="-1"]');
    chatItems.forEach(item => {
      if (item.dataset.waExtractHoverInjected) return;
      item.dataset.waExtractHoverInjected = 'true';

      if (window.getComputedStyle(item).position === 'static') {
        item.style.position = 'relative';
      }

      const unreadBadge = item.querySelector('span[aria-label*="unread"], span[aria-label*="no leído"], span[data-icon="unread-count"], span.rounded-full');
      const unreadCount = unreadBadge ? (parseInt(cleanWhatsAppText(unreadBadge.innerText), 10) || '!') : null;

      const trigger = document.createElement('div');
      trigger.className = 'wa-extract-hover-trigger';

      const btnAll = document.createElement('button');
      btnAll.className = 'wa-hover-btn';
      btnAll.innerHTML = `<span>📥</span><span>Todo</span>`;
      btnAll.title = 'Capturar todos los mensajes de este chat';

      const btnToday = document.createElement('button');
      btnToday.className = 'wa-hover-btn wa-hover-btn-today';
      btnToday.innerHTML = `<span>📅</span><span>De hoy</span>`;
      btnToday.title = 'Capturar mensajes de hoy de este chat';

      const btnNew = document.createElement('button');
      btnNew.className = 'wa-hover-btn wa-hover-btn-new';
      btnNew.innerHTML = `<span>⚡</span><span>${unreadCount ? `Nuevos (${unreadCount})` : 'Nuevos'}</span>`;
      btnNew.title = 'Capturar mensajes nuevos de este chat';

      const handleExtractChat = (e, mode) => {
        e.stopPropagation();
        e.preventDefault();

        triggerChatClick(item);
        showToast('Abriendo conversación y extrayendo...', '⏳');

        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          const main = document.querySelector('#main');
          if (main || attempts > 15) {
            clearInterval(checkInterval);
            setTimeout(() => {
              extractMessagesFromCurrentChat(mode);
            }, 350);
          }
        }, 200);
      };

      btnNew.addEventListener('click', (e) => handleExtractChat(e, 'new'));
      btnToday.addEventListener('click', (e) => handleExtractChat(e, 'today'));
      btnAll.addEventListener('click', (e) => handleExtractChat(e, 'all'));

      trigger.appendChild(btnNew);
      trigger.appendChild(btnToday);
      trigger.appendChild(btnAll);
      item.appendChild(trigger);
    });
  }

  // Live Auto-capture observer
  function enableAutoCapture(enable) {
    isAutoCaptureEnabled = enable;
    if (enable) {
      if (autoCaptureObserver) autoCaptureObserver.disconnect();
      autoCaptureObserver = new MutationObserver(() => {
        const main = document.querySelector('#main');
        if (main) {
          if (window._waCaptureTimeout) clearTimeout(window._waCaptureTimeout);
          window._waCaptureTimeout = setTimeout(() => {
            extractMessagesFromCurrentChat('new');
          }, 800);
        }
      });
      autoCaptureObserver.observe(document.body, { childList: true, subtree: true });
      showToast('Modo auto-captura en vivo activado', '🔄');
    } else {
      if (autoCaptureObserver) {
        autoCaptureObserver.disconnect();
        autoCaptureObserver = null;
      }
      showToast('Modo auto-captura pausado', '⏸️');
    }
  }

  // UI Setup: Floating FAB and Drawer Panel
  function initUI() {
    if (document.querySelector('#wa-extractor-fab')) return;

    const fab = document.createElement('div');
    fab.id = 'wa-extractor-fab';
    fab.title = 'Abrir Extractor de WhatsApp';
    fab.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        <path d="M8 10h8"></path>
        <path d="M8 14h4"></path>
      </svg>
      <span>Mensajes</span>
      <span class="badge-count">0</span>
    `;
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'wa-extractor-panel';
    panel.innerHTML = `
      <div class="wa-panel-header">
        <div class="wa-panel-header-title">
          <svg class="wa-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>WhatsApp Message Extractor</span>
        </div>
        <div class="wa-panel-header-actions">
          <button class="wa-icon-btn" id="wa-btn-close" title="Cerrar panel">✕</button>
        </div>
      </div>

      <!-- Global Auto-Scan Banner -->
      <div class="wa-global-scan-box">
        <button class="wa-btn wa-btn-global" id="wa-btn-scan-all-today" title="Escanear todos los chats de hoy automáticamente">
          <span>🌐</span>
          <span>Escanear Todos los Chats de Hoy</span>
        </button>
      </div>

      <div class="wa-chat-banner">
        <div class="wa-chat-info">
          <div class="wa-chat-name" id="wa-display-chat">Selecciona un chat o escanea todos</div>
          <div class="wa-chat-stats" id="wa-display-stats">0 mensajes guardados</div>
        </div>
        <div style="display:flex; gap:4px;">
          <button class="wa-btn wa-btn-secondary" id="wa-btn-toggle-global" title="Ver todos los chats de hoy">🌟 Global</button>
          <button class="wa-btn wa-btn-secondary" id="wa-btn-refresh-chat" title="Actualizar">🔄</button>
        </div>
      </div>

      <div class="wa-action-bar">
        <button class="wa-btn wa-btn-primary" id="wa-btn-extract-all" title="Capturar todos los mensajes de este chat">
          <span>📥</span> Este Chat
        </button>
        <button class="wa-btn wa-btn-today" id="wa-btn-extract-today" title="Capturar mensajes de hoy de este chat">
          <span>📅</span> De Hoy
        </button>
        <button class="wa-btn wa-btn-accent" id="wa-btn-extract-new" title="Capturar mensajes nuevos de este chat">
          <span>⚡</span> Nuevos
        </button>
      </div>

      <div class="wa-live-bar">
        <span>Auto-captura en vivo</span>
        <label class="wa-toggle-label">
          <div class="wa-switch">
            <input type="checkbox" id="wa-toggle-live">
            <span class="wa-slider"></span>
          </div>
        </label>
      </div>

      <div class="wa-search-bar">
        <input type="text" class="wa-search-input" id="wa-search-input" placeholder="🔍 Buscar palabras clave o contactos...">
        <div class="wa-filter-tags">
          <div class="wa-tag active" data-filter="all">Todos</div>
          <div class="wa-tag" data-filter="today">De Hoy</div>
          <div class="wa-tag" data-filter="new">Nuevos</div>
          <div class="wa-tag" data-filter="in">Recibidos</div>
          <div class="wa-tag" data-filter="out">Enviados</div>
        </div>
      </div>

      <div class="wa-message-feed" id="wa-message-feed">
        <div class="wa-empty-state">
          <div class="wa-empty-icon">💬</div>
          <div>No hay mensajes capturados aún.</div>
          <div style="font-size:11px;">Haz clic en <strong>🌐 Escanear Todos los Chats de Hoy</strong> arriba para capturarlos sin seleccionar ningún chat.</div>
        </div>
      </div>

      <!-- AuraSystem Spa Webhook Integration -->
      <div class="wa-aurasystem-panel-bar" style="padding: 10px 12px; background: #0b0c10; border-top: 1px solid #1f212a; display: flex; flex-direction: column; gap: 6px;">
        <div class="aura-config-grid">
          <div class="aura-input-wrapper">
            <label for="wa-input-aura-business-id" class="aura-mini-label">Id de dueño</label>
            <input type="text" id="wa-input-aura-business-id" class="aura-mini-input" placeholder="Ej: spa_aura_01" title="ID de dueño / negocio">
          </div>
          <div class="aura-input-wrapper">
            <label for="wa-input-aura-worker-id" class="aura-mini-label">Id de trabajadora</label>
            <input type="text" id="wa-input-aura-worker-id" class="aura-mini-input" placeholder="Ej: worker_123" title="ID de la trabajadora">
          </div>
        </div>
        <button class="btn btn-aurasystem" id="wa-btn-transfer-aurasystem" title="Transferir mensajes al webhook de AuraSystem Spa">
          <svg class="aura-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff2d75" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            <circle cx="12" cy="12" r="3.5" stroke="#ff2d75" fill="#ff2d75" fill-opacity="0.25"/>
          </svg>
          <span id="wa-txt-transfer-aurasystem">Transferir a AuraSystem</span>
        </button>
        <div id="wa-aurasystem-status-hint" style="display:none; font-size:11px; color:#ff2d75; text-align:center; font-weight:500;"></div>
      </div>

      <div class="wa-panel-footer">
        <div style="display:flex; gap:6px;">
          <button class="wa-btn wa-btn-secondary" id="wa-btn-copy-all" title="Copiar todo al portapapeles">📋 Copiar</button>
          <button class="wa-btn wa-btn-secondary" id="wa-btn-export-json" title="Exportar JSON">💾 JSON</button>
          <button class="wa-btn wa-btn-secondary" id="wa-btn-export-txt" title="Exportar TXT">📄 TXT</button>
        </div>
        <button class="wa-btn wa-btn-secondary" id="wa-btn-clear-chat" title="Borrar datos de este chat" style="color:#ea4335;">🗑️</button>
      </div>
    `;

    document.body.appendChild(panel);

    // Event listeners
    document.querySelector('#wa-btn-close').addEventListener('click', closePanel);
    document.querySelector('#wa-btn-scan-all-today').addEventListener('click', scanAllTodayChats);

    // AuraSystem Webhook Transfer Listener & Inputs
    const btnAura = document.querySelector('#wa-btn-transfer-aurasystem');
    const txtAura = document.querySelector('#wa-txt-transfer-aurasystem');
    const hintAura = document.querySelector('#wa-aurasystem-status-hint');
    const inputBusinessAura = document.querySelector('#wa-input-aura-business-id');
    const inputWorkerAura = document.querySelector('#wa-input-aura-worker-id');

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        chrome.storage.local.get(['aurasystem_settings'], (cfg) => {
          if (chrome.runtime?.lastError) return;
          if (inputBusinessAura) inputBusinessAura.value = cfg?.aurasystem_settings?.businessId || '';
          if (inputWorkerAura) inputWorkerAura.value = cfg?.aurasystem_settings?.workerId || '';
        });
      }
    } catch (e) {
      // Ignore invalidated extension context
    }

    const saveWaAuraInputs = () => {
      try {
        const bId = inputBusinessAura ? inputBusinessAura.value.trim() : '';
        const wId = inputWorkerAura ? inputWorkerAura.value.trim() : '';
        if (typeof auraService !== 'undefined') {
          auraService.saveConfig({ businessId: bId, workerId: wId }).catch(() => {});
        }
      } catch (err) {
        // Ignore invalidated extension context
      }
    };
    if (inputBusinessAura) inputBusinessAura.addEventListener('input', saveWaAuraInputs);
    if (inputWorkerAura) inputWorkerAura.addEventListener('input', saveWaAuraInputs);

    if (btnAura) {
      btnAura.addEventListener('click', async () => {
        // Send ONLY the messages that are currently listed in the panel UI
        let messages = getCurrentlyListedMessages();
        let chatTitle = (currentActiveChat === '__TODAY_ALL__')
          ? 'Todos los chats de hoy (Global)'
          : (currentActiveChat || getActiveChatName() || 'Chat Activo');

        if (!messages || messages.length === 0) {
          const currentChatExtracted = extractMessagesInternal(activeFilter === 'all' ? 'all' : activeFilter);
          if (currentChatExtracted && currentChatExtracted.length > 0) {
            updatePanelUI();
            messages = getCurrentlyListedMessages();
          }
        }

        if (!messages || messages.length === 0) {
          showToast('No hay mensajes enlistados para transferir.', '⚠️');
          return;
        }

        const businessId = inputBusinessAura ? inputBusinessAura.value.trim() : '';
        const workerId = inputWorkerAura ? inputWorkerAura.value.trim() : '';

        // Validación: Requiere al menos uno de los dos IDs (businessId o workerId)
        if (!businessId && !workerId) {
          showToast('Ingresa al menos el Id de dueño o el Id de trabajadora', '⚠️');
          if (hintAura) {
            hintAura.style.display = 'block';
            hintAura.style.color = '#ff758c';
            hintAura.textContent = '⚠️ Ingresa al menos el Id de dueño o el Id de trabajadora.';
          }
          if (inputBusinessAura) {
            inputBusinessAura.focus();
          }
          return;
        }

        btnAura.disabled = true;
        btnAura.classList.add('is-loading');
        if (hintAura) {
          hintAura.style.display = 'block';
          hintAura.style.color = '#ff2d75';
          hintAura.textContent = 'Iniciando transferencia a AuraSystem...';
        }

        try {
          if (typeof auraService !== 'undefined') {
            const res = await auraService.transferMessages({
              chatName: chatTitle,
              messages,
              businessId,
              workerId,
              onProgress: ({ current, total, percentage, phoneNumber }) => {
                if (txtAura) txtAura.textContent = `Transfiriendo (${current}/${total})...`;
                if (hintAura) hintAura.textContent = `${percentage}% completado (${current}/${total})${phoneNumber ? ` • ${phoneNumber}` : ''}`;
              }
            });

            if (res && res.success) {
              if (txtAura) txtAura.textContent = '¡Transferido con Éxito!';
              showToast(`¡${res.successful} mensajes sincronizados con AuraSystem!`, '🌸');
              if (hintAura) {
                hintAura.style.color = '#25D366';
                hintAura.textContent = `✅ ${res.successful} mensajes transferidos a AuraSystem`;
              }
              setTimeout(() => {
                if (txtAura) txtAura.textContent = 'Transferir a AuraSystem';
                if (hintAura) hintAura.style.display = 'none';
              }, 4000);
            } else {
              showToast(res?.error || 'Error al transferir a AuraSystem', '❌');
              if (txtAura) txtAura.textContent = 'Reintentar Transferencia';
            }
          } else {
            showToast('Módulo AuraSystem no disponible', '❌');
          }
        } catch (e) {
          showToast(`Error: ${e.message}`, '❌');
        } finally {
          btnAura.disabled = false;
          btnAura.classList.remove('is-loading');
        }
      });
    }
    document.querySelector('#wa-btn-extract-all').addEventListener('click', () => extractMessagesFromCurrentChat('all'));
    document.querySelector('#wa-btn-extract-today').addEventListener('click', () => extractMessagesFromCurrentChat('today'));
    document.querySelector('#wa-btn-extract-new').addEventListener('click', () => extractMessagesFromCurrentChat('new'));

    // Toggle Global Button: displays all today messages across all chats
    document.querySelector('#wa-btn-toggle-global').addEventListener('click', () => {
      const globalMsgs = getGlobalTodayMessages();
      if (globalMsgs.length > 0) {
        savedChats['__TODAY_ALL__'] = {
          name: '🌟 Todos los chats de hoy (Global)',
          lastUpdated: new Date().toISOString(),
          messages: globalMsgs
        };
        currentActiveChat = '__TODAY_ALL__';
        activeFilter = 'all';

        // Reset filter tags UI active state
        document.querySelectorAll('.wa-filter-tags .wa-tag').forEach(t => {
          t.classList.toggle('active', t.dataset.filter === 'all');
        });

        saveToStorage({ wa_saved_chats: savedChats }, () => {
          updateBadge();
          updatePanelUI();
          showToast(`Mostrando ${globalMsgs.length} mensajes de hoy (Todos los chats)`, '🌟');
        });
      } else {
        showToast('Iniciando escaneo de chats de hoy...', '🔍');
        scanAllTodayChats().then(() => {
          updatePanelUI();
        });
      }
    });

    document.querySelector('#wa-btn-refresh-chat').addEventListener('click', () => {
      updatePanelUI();
      showToast('Vista actualizada', '🔄');
    });

    const liveToggle = document.querySelector('#wa-toggle-live');
    liveToggle.addEventListener('change', (e) => {
      enableAutoCapture(e.target.checked);
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get(['wa_settings'], (res) => {
            const settings = res?.wa_settings || {};
            settings.autoCaptureNew = e.target.checked;
            saveToStorage({ wa_settings: settings });
          });
        }
      } catch (err) {
        // Ignore
      }
    });

    // Search and filter
    document.querySelector('#wa-search-input').addEventListener('input', (e) => {
      activeSearch = e.target.value.toLowerCase().trim();
      renderFeed();
    });

    document.querySelectorAll('.wa-filter-tags .wa-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        document.querySelectorAll('.wa-filter-tags .wa-tag').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        activeFilter = tag.dataset.filter;
        renderFeed();
      });
    });

    // Exports
    document.querySelector('#wa-btn-copy-all').addEventListener('click', exportCopy);
    document.querySelector('#wa-btn-export-json').addEventListener('click', exportJSON);
    document.querySelector('#wa-btn-export-txt').addEventListener('click', exportTXT);
    document.querySelector('#wa-btn-clear-chat').addEventListener('click', clearCurrentChat);

    setInterval(injectHoverListeners, 1500);
  }

  function togglePanel() {
    const panel = document.querySelector('#wa-extractor-panel');
    if (!panel) return;
    if (panel.classList.contains('active')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    const panel = document.querySelector('#wa-extractor-panel');
    if (panel) {
      panel.classList.add('active');
      updatePanelUI();
    }
  }

  function closePanel() {
    const panel = document.querySelector('#wa-extractor-panel');
    if (panel) panel.classList.remove('active');
  }

  function updatePanelUI() {
    const displayChat = document.querySelector('#wa-display-chat');
    const displayStats = document.querySelector('#wa-display-stats');

    if (currentActiveChat === '__TODAY_ALL__') {
      const globalMsgs = getGlobalTodayMessages();
      if (displayChat) displayChat.textContent = '🌟 Todos los chats de hoy (Global)';
      if (displayStats) displayStats.textContent = `${globalMsgs.length} mensajes recopilados hoy`;
    } else {
      const activeChat = getActiveChatName() || currentActiveChat || 'Ningún chat seleccionado';
      currentActiveChat = activeChat;
      if (displayChat) displayChat.textContent = activeChat;
      const chatData = savedChats[activeChat];
      const count = chatData?.messages?.length || 0;
      if (displayStats) {
        displayStats.textContent = `${count} mensajes guardados ${chatData ? `(Última: ${new Date(chatData.lastUpdated).toLocaleTimeString()})` : ''}`;
      }
    }

    renderFeed();
  }

  // Helper: Get only the messages currently listed in the UI based on active chat and filters
  function getCurrentlyListedMessages() {
    let rawMessages = [];
    if (currentActiveChat === '__TODAY_ALL__') {
      rawMessages = getGlobalTodayMessages();
    } else {
      const activeChat = currentActiveChat || getActiveChatName();
      rawMessages = savedChats[activeChat]?.messages || [];
    }

    return rawMessages.filter(m => {
      if (activeFilter === 'new' && !m.isNew) return false;
      if (activeFilter === 'today' && !m.isToday) return false;
      if (activeFilter === 'in' && m.type !== 'incoming') return false;
      if (activeFilter === 'out' && m.type !== 'outgoing') return false;
      if (activeSearch) {
        const query = activeSearch.toLowerCase();
        const matchesText = m.text.toLowerCase().includes(query);
        const matchesSender = m.sender.toLowerCase().includes(query);
        const matchesChat = m.chatName && m.chatName.toLowerCase().includes(query);
        if (!matchesText && !matchesSender && !matchesChat) return false;
      }
      return true;
    });
  }

  function renderFeed() {
    const feed = document.querySelector('#wa-message-feed');
    if (!feed) return;

    let totalRawMessages = 0;
    if (currentActiveChat === '__TODAY_ALL__') {
      totalRawMessages = getGlobalTodayMessages().length;
    } else {
      const activeChat = currentActiveChat || getActiveChatName();
      totalRawMessages = savedChats[activeChat]?.messages?.length || 0;
    }

    const filtered = getCurrentlyListedMessages();

    if (filtered.length === 0) {
      feed.innerHTML = `
        <div class="wa-empty-state">
          <div class="wa-empty-icon">${totalRawMessages === 0 ? '💬' : '🔍'}</div>
          <div>${totalRawMessages === 0 ? 'No hay mensajes capturados aquí.' : 'No hay mensajes que coincidan con el filtro.'}</div>
          <div style="font-size:11px;">Haz clic en <strong>🌐 Escanear Todos los Chats de Hoy</strong> arriba para capturarlos automáticamente.</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = '';
    filtered.forEach(msg => {
      const card = document.createElement('div');
      card.className = `wa-card ${msg.type === 'outgoing' ? 'outgoing' : 'incoming'} ${msg.isNew ? 'is-new' : ''}`;
      
      const showChatPill = currentActiveChat === '__TODAY_ALL__' && msg.chatName;
      const rawNum = msg.numero || msg.phone || '';
      let numDisplay = (!isLikelyLid(rawNum) && cleanPhoneNumber(rawNum).length >= 7) ? cleanPhoneNumber(rawNum) : '';
      if (!numDisplay) {
        const norm = normalizeContactName(msg.chatName || msg.sender || '');
        const cached = contactsCache.byName.get(norm)?.phone ||
                       contactsCache.byName.get(msg.chatName)?.phone ||
                       contactsCache.byName.get(msg.sender)?.phone;
        if (cached && !isLikelyLid(cached)) {
          numDisplay = cleanPhoneNumber(cached);
        }
      }

      card.innerHTML = `
        <div class="wa-card-header">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="wa-sender">${escapeHTML(msg.sender)}</span>
            ${numDisplay ? `<span class="wa-phone-pill" title="Número de teléfono">📱 +${escapeHTML(numDisplay)}</span>` : ''}
            ${msg.isSavedContact === true ? '<span class="wa-badge-contact" title="Contacto guardado">👤 Contacto</span>' : (msg.isSavedContact === false ? '<span class="wa-badge-unsaved" title="Número no agregado">🆕 No guardado</span>' : '')}
            ${showChatPill ? `<span class="wa-chat-pill">${escapeHTML(msg.chatName)}</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:5px;">
            ${msg.isToday ? '<span class="wa-badge-today">HOY</span>' : ''}
            ${msg.isNew ? '<span class="wa-badge-new">NUEVO</span>' : ''}
            <span class="wa-time">${escapeHTML(msg.timestamp)}</span>
          </div>
        </div>
        <div class="wa-card-body">${escapeHTML(msg.text)}</div>
        <div class="wa-card-footer">
          <button class="wa-card-action btn-copy-card">Copiar</button>
        </div>
      `;

      card.querySelector('.btn-copy-card').addEventListener('click', () => {
        const phoneTxt = numDisplay ? ` (+${numDisplay})` : '';
        navigator.clipboard.writeText(`[${msg.timestamp}] ${msg.sender}${phoneTxt}${msg.chatName ? ` (${msg.chatName})` : ''}: ${msg.text}`);
        showToast('Mensaje copiado', '📋');
      });

      feed.appendChild(card);
    });

    feed.scrollTop = feed.scrollHeight;
  }

  function exportCopy() {
    const isGlobal = currentActiveChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentActiveChat || getActiveChatName()]?.messages || []);
    if (messages.length === 0) {
      showToast('No hay mensajes para copiar', '⚠️');
      return;
    }
    const formatted = messages.map(m => {
      const rawNum = m.numero || m.phone;
      let validNum = (!isLikelyLid(rawNum) && cleanPhoneNumber(rawNum).length >= 7) ? cleanPhoneNumber(rawNum) : '';
      if (!validNum) {
        const norm = normalizeContactName(m.chatName || m.sender || '');
        const cached = contactsCache.byName.get(norm)?.phone;
        if (cached && !isLikelyLid(cached)) validNum = cleanPhoneNumber(cached);
      }
      const phoneTxt = validNum ? ` (+${validNum})` : '';
      return `[${m.timestamp}] ${m.sender}${phoneTxt}${m.chatName ? ` (${m.chatName})` : ''}: ${m.text}`;
    }).join('\n');
    navigator.clipboard.writeText(formatted).then(() => {
      showToast(`${messages.length} mensajes copiados al portapapeles`, '📋');
    });
  }

  function exportJSON() {
    const isGlobal = currentActiveChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentActiveChat || getActiveChatName()]?.messages || []);
    if (messages.length === 0) {
      showToast('No hay datos para exportar', '⚠️');
      return;
    }
    // Clean any LIDs and resolve real phone numbers before JSON export
    const cleanMessages = messages.map(m => {
      const copy = { ...m };
      let validNum = (!isLikelyLid(copy.numero) && cleanPhoneNumber(copy.numero).length >= 7) ? cleanPhoneNumber(copy.numero) : '';
      if (!validNum) {
        const norm = normalizeContactName(copy.chatName || copy.sender || '');
        const cached = contactsCache.byName.get(norm)?.phone;
        if (cached && !isLikelyLid(cached)) validNum = cleanPhoneNumber(cached);
      }
      copy.numero = validNum;
      copy.phone = validNum;
      return copy;
    });
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cleanMessages, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `whatsapp_${isGlobal ? 'todos_los_de_hoy' : (currentActiveChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.json`);
    dlAnchor.click();
    showToast('Archivo JSON descargado', '💾');
  }

  function exportTXT() {
    const isGlobal = currentActiveChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentActiveChat || getActiveChatName()]?.messages || []);
    if (messages.length === 0) {
      showToast('No hay datos para exportar', '⚠️');
      return;
    }
    const title = isGlobal ? 'TODOS LOS CHATS DE HOY (GLOBAL)' : (currentActiveChat || getActiveChatName());
    const formatted = `=== CHATS DE WHATSAPP: ${title} ===\nExportado: ${new Date().toLocaleString()}\nTotal Mensajes: ${messages.length}\n\n` +
      messages.map(m => {
        const rawNum = m.numero || m.phone;
        let validNum = (!isLikelyLid(rawNum) && cleanPhoneNumber(rawNum).length >= 7) ? cleanPhoneNumber(rawNum) : '';
        if (!validNum) {
          const norm = normalizeContactName(m.chatName || m.sender || '');
          const cached = contactsCache.byName.get(norm)?.phone;
          if (cached && !isLikelyLid(cached)) validNum = cleanPhoneNumber(cached);
        }
        const phoneTxt = validNum ? ` [Tel: +${validNum}]` : '';
        return `[${m.timestamp}] ${m.sender}${phoneTxt}${m.chatName ? ` [Chat: ${m.chatName}]` : ''}: ${m.text}`;
      }).join('\n');

    const dataStr = 'data:text/plain;charset=utf-8,' + encodeURIComponent(formatted);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `whatsapp_${isGlobal ? 'todos_los_de_hoy' : (currentActiveChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.txt`);
    dlAnchor.click();
    showToast('Archivo TXT descargado', '📄');
  }

  function clearCurrentChat() {
    const isGlobal = currentActiveChat === '__TODAY_ALL__';
    const activeChat = isGlobal ? '__TODAY_ALL__' : (currentActiveChat || getActiveChatName());
    if (!savedChats[activeChat]) {
      showToast('No hay mensajes guardados para eliminar', 'ℹ️');
      return;
    }
    if (confirm(`¿Deseas eliminar los mensajes guardados de "${isGlobal ? 'Todos los de hoy (Global)' : activeChat}"?`)) {
      delete savedChats[activeChat];
      saveToStorage({ wa_saved_chats: savedChats }, () => {
        updateBadge();
        updatePanelUI();
        showToast('Mensajes eliminados', '🗑️');
      });
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
