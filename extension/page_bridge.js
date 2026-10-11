// WhatsApp Web Extractor - Main World Bridge
// Runs in world: "MAIN" with direct access to WhatsApp's internal React fiber tree & webpack store
(function () {
  'use strict';

  function isLikelyLid(val) {
    if (!val) return false;
    const str = typeof val === 'object' ? String(val._serialized || val.id || val.user || '') : String(val);
    if (str.includes('@lid')) return true;
    if (typeof val === 'object' && val.server === 'lid') return true;
    const digits = str.replace(/\D/g, '');
    // WhatsApp/Meta LIDs are typically 14 to 17 digits (commonly 15 digits e.g. 171983392252014)
    if (digits.length >= 14 && digits.startsWith('1')) return true;
    if (digits.length === 15) return true;
    if (digits.length >= 16) return true;
    return false;
  }

  function extractDigits(val) {
    if (!val) return '';
    if (isLikelyLid(val)) return '';

    if (typeof val === 'string') {
      if (val.includes('@') && !val.includes('@c.us') && !val.includes('@s.whatsapp.net')) return '';
      const match = val.match(/(\d{7,15})@(c\.us|s\.whatsapp\.net)/i) || val.match(/^(\d{7,15})$/);
      if (match) {
        if (isLikelyLid(match[1])) return '';
        return match[1];
      }
      const d = val.replace(/\D/g, '');
      if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) return d;
      return '';
    }

    if (typeof val === 'object') {
      if (val.server === 'lid' || val.server === 'hosted.lid' || (val._serialized && String(val._serialized).includes('@lid'))) {
        return '';
      }
      if (val.server && val.server !== 'c.us' && val.server !== 's.whatsapp.net') return '';

      if (val.pnJid) {
        const d = extractDigits(val.pnJid);
        if (d) return d;
      }
      if (val.phoneNumber) {
        const d = extractDigits(val.phoneNumber);
        if (d) return d;
      }
      if (val.phone) {
        const d = extractDigits(val.phone);
        if (d) return d;
      }
      if (val.attributes) {
        const d = extractDigits(val.attributes.phoneNumber) ||
                  extractDigits(val.attributes.pnJid) ||
                  extractDigits(val.attributes.phone);
        if (d) return d;
      }
      if (val.__x_phoneNumber || val.__x_pnJid || val.__x_phone) {
        const d = extractDigits(val.__x_phoneNumber) ||
                  extractDigits(val.__x_pnJid) ||
                  extractDigits(val.__x_phone);
        if (d) return d;
      }
      if (val.user && (val.server === 'c.us' || val.server === 's.whatsapp.net' || !val.server)) {
        const u = String(val.user);
        if (!isLikelyLid(u) && /^\d{7,15}$/.test(u)) return u;
      }
      if (val._serialized && !isLikelyLid(val._serialized)) {
        return extractDigits(val._serialized);
      }
    }
    return '';
  }

  // Find phone number in WhatsApp Web DOM Contact Info Drawer (Image 2)
  function getPhoneFromDomDrawer() {
    try {
      // 1. Search leaf text nodes outside #side (left list) and outside #main (chat messages)
      const allOutside = document.querySelectorAll('body *');
      for (const el of allOutside) {
        if (el.closest('#side') || el.closest('#main')) continue;
        if (el.closest('#wa-message-extractor-panel') || el.closest('#wa-extractor-fab')) continue;
        if (el.children.length <= 2) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt && (txt.includes('+') || /^\d[\d\s\-\(\)]{7,}\d$/.test(txt))) {
            const match = txt.match(/\+(\d[\d\s\-\(\)]{6,18}\d)/);
            if (match) {
              const d = match[1].replace(/\D/g, '');
              if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
                return d;
              }
            }
            if (/^\d{1,4}[\s\-\.]\d{2,4}[\s\-\.]?\d{3,4}[\s\-\.]?\d{3,4}$/.test(txt)) {
              const d = txt.replace(/\D/g, '');
              if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
                return d;
              }
            }
          }
        }
      }

      // 2. Check header
      const header = document.querySelector('#main header');
      if (header) {
        const headerTexts = header.querySelectorAll('span, div');
        for (const h of headerTexts) {
          const match = (h.innerText || '').match(/\+(\d[\d\s\-\(\)]{7,18}\d)/);
          if (match) {
            const d = match[1].replace(/\D/g, '');
            if (d.length >= 7 && d.length <= 15 && !isLikelyLid(d)) {
              return d;
            }
          }
        }
      }
    } catch (e) {}
    return '';
  }

  // Webpack module hook
  let waWebpackRequire = null;
  function ensureWebpack() {
    if (waWebpackRequire) return waWebpackRequire;
    try {
      if (window.webpackChunkwhatsapp_web_client) {
        window.webpackChunkwhatsapp_web_client.push([
          [Symbol('wa_bridge_' + Math.random().toString(36).substring(2))],
          {},
          (req) => { waWebpackRequire = req; }
        ]);
      }
    } catch (e) {}
    return waWebpackRequire;
  }

  function resolveFromStore(lid, name) {
    try {
      // 1. Webpack modules inspection
      const req = ensureWebpack();
      if (req && req.c) {
        for (const id in req.c) {
          const mod = req.c[id]?.exports;
          if (!mod) continue;

          // Check LidUtils
          if (lid) {
            if (typeof mod.getPhoneNumber === 'function') {
              try {
                const p = extractDigits(mod.getPhoneNumber(lid) || mod.getPhoneNumber(lid + '@lid'));
                if (p && !isLikelyLid(p)) return p;
              } catch (e) {}
            }
            if (typeof mod.getJid === 'function') {
              try {
                const p = extractDigits(mod.getJid(lid) || mod.getJid(lid + '@lid'));
                if (p && !isLikelyLid(p)) return p;
              } catch (e) {}
            }
          }

          // Check ContactCollection / Contact models
          const collection = mod.ContactCollection || mod.Contact;
          if (collection) {
            if (lid && typeof collection.get === 'function') {
              const c = collection.get(lid) || collection.get(lid + '@lid');
              if (c) {
                const p = extractDigits(c.phoneNumber) ||
                          extractDigits(c.pnJid) ||
                          extractDigits(c.phone) ||
                          extractDigits(c.attributes?.phoneNumber) ||
                          extractDigits(c.attributes?.pnJid);
                if (p && !isLikelyLid(p)) return p;
              }
            }
            const models = collection.models || collection._models || [];
            for (const m of models) {
              if (!m) continue;
              const mLid = String(m.lid?._serialized || m.lid || m.attributes?.lid || '');
              const mName = String(m.name || m.formattedTitle || m.displayName || m.attributes?.name || '');
              if ((lid && mLid.includes(lid)) || (name && mName === name)) {
                const p = extractDigits(m.phoneNumber) ||
                          extractDigits(m.pnJid) ||
                          extractDigits(m.phone) ||
                          extractDigits(m.attributes?.phoneNumber) ||
                          extractDigits(m.attributes?.pnJid);
                if (p && !isLikelyLid(p)) return p;
              }
            }
          }
        }
      }

      // 2. Fallback to window.Store if present
      if (window.Store && window.Store.Contact) {
        if (lid) {
          const c = window.Store.Contact.get ? (window.Store.Contact.get(lid) || window.Store.Contact.get(lid + '@lid')) : null;
          if (c) {
            const p = extractDigits(c.phoneNumber) || extractDigits(c.pnJid) || extractDigits(c.phone);
            if (p && !isLikelyLid(p)) return p;
          }
        }
        const models = window.Store.Contact.models || window.Store.Contact._models || [];
        for (const m of models) {
          if (!m) continue;
          const mLid = String(m.lid?._serialized || m.lid || '');
          const mName = String(m.name || m.formattedTitle || m.displayName || '');
          if ((lid && mLid.includes(lid)) || (name && mName === name)) {
            const p = extractDigits(m.phoneNumber) || extractDigits(m.pnJid) || extractDigits(m.phone);
            if (p && !isLikelyLid(p)) return p;
          }
        }
      }
      if (window.Store && window.Store.LidUtils) {
        if (window.Store.LidUtils.getPhoneNumber) {
          const p = extractDigits(window.Store.LidUtils.getPhoneNumber(lid));
          if (p && !isLikelyLid(p)) return p;
        }
        if (window.Store.LidUtils.getJid) {
          const p = extractDigits(window.Store.LidUtils.getJid(lid));
          if (p && !isLikelyLid(p)) return p;
        }
      }
    } catch (e) {}
    return '';
  }

  function extractInfoFromTarget(target) {
    if (!target || typeof target !== 'object') return null;

    const candidates = [
      target.chat,
      target.contact,
      target.user,
      target.activeChat,
      target.currentChat,
      target.props?.chat,
      target.props?.contact,
      target.memoizedProps?.chat,
      target.memoizedProps?.contact,
      target.data,
      target
    ];

    let foundName = '';
    let foundPushname = '';
    let foundId = '';
    let foundLid = '';
    let isSaved = false;

    // First pass: Look for real phone numbers in candidates
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;

      const name = String(item.name || item.formattedTitle || item.displayName || item.formattedName || item.attributes?.name || '');
      const pushname = String(item.pushname || item.notifyName || item.attributes?.pushname || '');
      if (name && !foundName) foundName = name;
      if (pushname && !foundPushname) foundPushname = pushname;
      if (item.isMyContact === true || item.isAddressBookContact === true || item.attributes?.isMyContact === true) isSaved = true;

      const idVal = typeof item.id === 'object' ? item.id._serialized : String(item.id || item.attributes?.id || '');
      if (idVal && !foundId) foundId = idVal;
      if (isLikelyLid(idVal) && !foundLid) foundLid = idVal.replace(/\D/g, '');
      if (item.lid && !foundLid) foundLid = String(item.lid._serialized || item.lid).replace(/\D/g, '');

      // Check explicit phone properties (including Backbone attributes & methods)
      const phone = extractDigits(item.pnJid) ||
                    extractDigits(item.phoneNumber) ||
                    extractDigits(item.phone) ||
                    extractDigits(item.attributes?.pnJid) ||
                    extractDigits(item.attributes?.phoneNumber) ||
                    extractDigits(item.attributes?.phone) ||
                    extractDigits(item.__x_pnJid) ||
                    extractDigits(item.__x_phoneNumber) ||
                    extractDigits(item.__x_phone) ||
                    extractDigits(item.contact?.pnJid) ||
                    extractDigits(item.contact?.phoneNumber) ||
                    extractDigits(item.contact?.phone) ||
                    extractDigits(item.contact?.attributes?.pnJid) ||
                    extractDigits(item.contact?.attributes?.phoneNumber) ||
                    (item.get ? (extractDigits(item.get('pnJid')) || extractDigits(item.get('phoneNumber')) || extractDigits(item.get('phone'))) : '') ||
                    (item.contact?.get ? (extractDigits(item.contact.get('pnJid')) || extractDigits(item.contact.get('phoneNumber')) || extractDigits(item.contact.get('phone'))) : '');

      if (phone && !isLikelyLid(phone)) {
        const contactIsSaved = isSaved || (foundName.length > 0 && foundName !== phone);
        return {
          phone,
          name: foundName,
          pushname: foundPushname,
          isSaved: !!contactIsSaved,
          id: foundId || phone
        };
      }
    }

    // Second pass: If active chat has a LID or name, resolve via Store or DOM
    const storePhone = resolveFromStore(foundLid, foundName);
    const domPhone = storePhone || getPhoneFromDomDrawer();

    if (domPhone && !isLikelyLid(domPhone)) {
      const contactIsSaved = isSaved || (foundName.length > 0 && foundName !== domPhone);
      return {
        phone: domPhone,
        name: foundName,
        pushname: foundPushname,
        isSaved: !!contactIsSaved,
        id: foundId || domPhone
      };
    }

    return null;
  }

  function getActiveChatFromReact() {
    try {
      const mainHeader = document.querySelector('#main header');
      if (!mainHeader) return null;

      const elementsToTry = [
        mainHeader,
        mainHeader.querySelector('[role="button"]'),
        mainHeader.querySelector('div[dir="auto"]'),
        mainHeader.querySelector('span[title]'),
        document.querySelector('[data-testid="contact-info-drawer"]'),
        document.querySelector('[data-testid="chat-info-drawer"]'),
        document.querySelector('div[role="region"]'),
        document.querySelector('#main ~ div'),
        document.querySelector('#main')
      ].filter(Boolean);

      for (const el of elementsToTry) {
        const propKeys = Object.keys(el).filter(k =>
          k.startsWith('__reactProps$') ||
          k.startsWith('__reactFiber$') ||
          k.startsWith('__reactInternalInstance$')
        );

        for (const k of propKeys) {
          const val = el[k];
          if (!val) continue;

          // 1. Direct props
          if (k.startsWith('__reactProps$')) {
            const info = extractInfoFromTarget(val);
            if (info) return info;
          }

          // 2. Fiber tree traversal
          let fiber = val;
          let depth = 0;
          while (fiber && depth < 25) {
            if (fiber.memoizedProps) {
              const info = extractInfoFromTarget(fiber.memoizedProps);
              if (info) return info;
            }
            if (fiber.stateNode && typeof fiber.stateNode === 'object') {
              const info = extractInfoFromTarget(fiber.stateNode.props);
              if (info) return info;
            }
            fiber = fiber.return;
            depth++;
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }

  function getActiveChatFromStore() {
    try {
      if (window.Store && window.Store.Chat) {
        const active = window.Store.Chat.getActive ? window.Store.Chat.getActive() : null;
        if (active) {
          const info = extractInfoFromTarget(active);
          if (info) return info;
        }
      }
      if (window.require) {
        try {
          const ChatCollection = window.require('WAWebChatCollection')?.ChatCollection;
          if (ChatCollection?.getActive) {
            const active = ChatCollection.getActive();
            if (active) {
              const info = extractInfoFromTarget(active);
              if (info) return info;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  function broadcastChatInfo() {
    const info = getActiveChatFromReact() || getActiveChatFromStore();
    if (info && info.phone && !isLikelyLid(info.phone)) {
      try {
        // DOM attributes provide instant, synchronous sharing across Isolated World and Main World
        document.documentElement.setAttribute('data-wa-active-phone', info.phone);
        document.documentElement.setAttribute('data-wa-active-name', info.name || '');
        document.documentElement.setAttribute('data-wa-active-pushname', info.pushname || '');
        document.documentElement.setAttribute('data-wa-active-issaved', info.isSaved ? 'true' : 'false');
      } catch (err) {}

      window.postMessage({
        source: 'WA_EXTRACTOR_PAGE_BRIDGE',
        type: 'ACTIVE_CHAT_INFO',
        payload: info
      }, '*');
    }
  }

  window.addEventListener('message', (e) => {
    if (e.data && e.data.source === 'WA_EXTRACTOR_CONTENT_SCRIPT' && e.data.type === 'REQUEST_ACTIVE_CHAT_INFO') {
      broadcastChatInfo();
    }
  });

  // Keep active chat phone updated
  setInterval(broadcastChatInfo, 1000);
  broadcastChatInfo();
})();
