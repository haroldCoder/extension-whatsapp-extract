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

  // Initialize storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['wa_saved_chats', 'wa_settings'], (result) => {
        savedChats = result?.wa_saved_chats || {};
        if (result?.wa_settings?.autoCaptureNew) {
          enableAutoCapture(true);
        }
        updateBadge();
        initUI();
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
      const result = extractMessagesFromCurrentChat('all');
      sendResponse(result);
      return true;
    }
    if (request.action === 'EXTRACT_NEW_MESSAGES') {
      const result = extractMessagesFromCurrentChat('new');
      sendResponse(result);
      return true;
    }
    if (request.action === 'EXTRACT_TODAY_MESSAGES') {
      const result = extractMessagesFromCurrentChat('today');
      sendResponse(result);
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

  // Helper: Check if string or metadata corresponds to today's date
  function isDateToday(rawMeta, timestamp, sectionIsToday) {
    if (sectionIsToday === true) return true;
    if (sectionIsToday === false) return false;

    const cleanMeta = cleanWhatsAppText(rawMeta);
    if (cleanMeta) {
      const lower = cleanMeta.toLowerCase();
      if (lower.includes('hoy') || lower.includes('today') || lower.includes('hoje')) return true;
      if (lower.includes('ayer') || lower.includes('yesterday') || lower.includes('ontem')) return false;

      // Pure time inside [ ] indicates today in WhatsApp Web
      const inside = (cleanMeta.match(/\[(.*?)\]/) || [])[1] || cleanMeta;
      if (/^\s*\d{1,2}:\d{2}(\s*[ap]\.?\s*m\.?)?\s*$/i.test(inside)) {
        return true;
      }
    }

    const cleanTs = cleanWhatsAppText(timestamp).toLowerCase();
    if (cleanTs.includes('ayer') || cleanTs.includes('yesterday') || cleanTs.includes('ontem') || /\d{1,2}[\/\.-]\d{1,2}/.test(cleanTs)) {
      return false;
    }

    return true;
  }

  // Helper: Retrieve all today messages across all saved chats and the global collection
  function getGlobalTodayMessages() {
    const all = [];
    const seen = new Set();

    if (savedChats['__TODAY_ALL__']?.messages?.length > 0) {
      savedChats['__TODAY_ALL__'].messages.forEach(m => {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          all.push({ ...m, isToday: true });
        }
      });
    }

    Object.keys(savedChats).forEach(chatName => {
      if (chatName === '__TODAY_ALL__') return;
      const chatMsgs = savedChats[chatName]?.messages || [];
      chatMsgs.forEach(m => {
        const ts = (m.timestamp || '').toLowerCase();
        const isNotYesterday = !ts.includes('ayer') && !ts.includes('yesterday') && !ts.includes('ontem');
        if ((m.isToday || isNotYesterday) && !seen.has(m.id)) {
          seen.add(m.id);
          all.push({ ...m, chatName: m.chatName || chatName, isToday: true });
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
    const allRows = main.querySelectorAll('div[data-id], div[role="row"], div.message-in, div.message-out, div[data-testid="msg-container"]');
    if (!allRows || allRows.length === 0) return [];

    const previousMessages = savedChats[chatName]?.messages || [];
    const prevIds = new Set(previousMessages.map(m => m.id));

    const extracted = [];
    const seenMsgIds = new Set();
    let foundUnreadSeparator = false;
    let currentSectionIsToday = null;

    allRows.forEach((el) => {
      const rawText = el.innerText || '';
      const textContent = cleanWhatsAppText(rawText);
      const lowerText = textContent.toLowerCase();

      const isMessageBubble = el.classList.contains('message-in') || el.classList.contains('message-out') ||
        !!el.querySelector('span.selectable-text, div.copyable-text, [data-icon="msg-check"], [data-icon="msg-dblcheck"]');

      // Check date dividers ONLY on non-message rows
      if (!isMessageBubble) {
        if (/\b(hoy|today|hoje)\b/i.test(lowerText)) {
          currentSectionIsToday = true;
          return;
        }
        if (
          /\b(ayer|yesterday|ontem)\b/i.test(lowerText) ||
          /\d{1,2}\s+de\s+[a-z]+/i.test(lowerText) ||
          /\d{1,2}[\/\.-]\d{1,2}/.test(lowerText)
        ) {
          currentSectionIsToday = false;
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

      let sender = isOutgoing ? 'Tú' : chatName;
      const senderSpan = el.querySelector('span[dir="auto"][role="button"], span[aria-label]');
      if (isIncoming && senderSpan && senderSpan.innerText && senderSpan.innerText !== chatName) {
        sender = cleanWhatsAppText(senderSpan.innerText);
      }

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
      const id = `${chatName}_${timestamp}_${sender}_${text.substring(0, 30)}`.replace(/\s+/g, '_');

      // Avoid duplicate row/child hits
      if (seenMsgIds.has(id)) return;
      seenMsgIds.add(id);

      const isNew = foundUnreadSeparator || !prevIds.has(id);

      if (isNewOnly && !isNew) return;
      if (isTodayOnly && !isToday) return;

      extracted.push({
        id,
        chatName,
        sender,
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

    const paneSide = document.querySelector('#pane-side, div[aria-label="Chat list"], div[role="grid"]');
    if (!paneSide) {
      showToast('No se encontró la lista de chats en WhatsApp Web', '⚠️');
      return { success: false, error: 'Chat list not found' };
    }

    // Only select direct chat item containers to prevent duplicate inner rows
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
        if (
          /^(\d{1,2}:\d{2})(\s*[ap]\.?\s*m\.?)?$/i.test(txt) &&
          !/ayer|yesterday|ontem|\d{1,2}[\/\.-]\d{1,2}/i.test(txt)
        ) {
          isTodayChat = true;
          timeText = txt;
          break;
        }
      }

      const hasUnread = !!item.querySelector('span[aria-label*="unread"], span[aria-label*="no leído"], span[data-icon="unread-count"]');

      if (isTodayChat || hasUnread) {
        seenTitles.add(title);
        todayChats.push({ element: item, title, timeText });
      }
    });

    if (todayChats.length === 0) {
      chatItems.slice(0, 6).forEach(item => {
        const titleEl = item.querySelector('span[title], span[dir="auto"]');
        const title = titleEl ? cleanWhatsAppText(titleEl.getAttribute('title') || titleEl.innerText) : '';
        if (title && !seenTitles.has(title)) {
          seenTitles.add(title);
          todayChats.push({ element: item, title, timeText: '' });
        }
      });

      if (todayChats.length === 0) {
        showToast('No se detectaron chats de hoy en la lista visible', 'ℹ️');
        return { success: false, count: 0 };
      }
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

        // Poll up to 1.6s for chat messages to be rendered in #main
        for (let wait = 0; wait < 8; wait++) {
          await new Promise(r => setTimeout(r, 200));
          const main = document.querySelector('#main');
          if (main && main.querySelectorAll('div[data-id], div[role="row"], div.message-in, div.message-out').length > 0) {
            break;
          }
        }

        let msgs = extractMessagesInternal('today', chat.title);

        // Robust fallback 1: if 'today' filter yielded 0, extract all and filter out yesterday/past dates
        if (!msgs || msgs.length === 0) {
          const allMsgs = extractMessagesInternal('all', chat.title);
          msgs = allMsgs.filter(m => {
            const ts = (m.timestamp || '').toLowerCase();
            return !ts.includes('ayer') && !ts.includes('yesterday') && !ts.includes('ontem') && !/\d{1,2}[\/\.-]\d{1,2}/.test(ts);
          });

          // Robust fallback 2: if all timestamps were strictly rejected, take all visible messages from this active chat
          if (msgs.length === 0 && allMsgs.length > 0) {
            msgs = allMsgs;
          }
        }

        if (msgs && msgs.length > 0) {
          msgs.forEach(m => {
            m.chatName = chat.title;
            m.isToday = true;
          });
          allAggregatedMessages.push(...msgs);

          // Always ensure savedChats[chat.title] is also populated
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

  function renderFeed() {
    const feed = document.querySelector('#wa-message-feed');
    if (!feed) return;

    let messages = [];
    if (currentActiveChat === '__TODAY_ALL__') {
      messages = getGlobalTodayMessages();
    } else {
      const activeChat = currentActiveChat || getActiveChatName();
      messages = savedChats[activeChat]?.messages || [];
    }

    let filtered = messages.filter(m => {
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

    if (filtered.length === 0) {
      feed.innerHTML = `
        <div class="wa-empty-state">
          <div class="wa-empty-icon">${messages.length === 0 ? '💬' : '🔍'}</div>
          <div>${messages.length === 0 ? 'No hay mensajes capturados aquí.' : 'No hay mensajes que coincidan con el filtro.'}</div>
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

      card.innerHTML = `
        <div class="wa-card-header">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="wa-sender">${escapeHTML(msg.sender)}</span>
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
        navigator.clipboard.writeText(`[${msg.timestamp}] ${msg.sender}${msg.chatName ? ` (${msg.chatName})` : ''}: ${msg.text}`);
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
    const formatted = messages.map(m => `[${m.timestamp}] ${m.sender}${m.chatName ? ` (${m.chatName})` : ''}: ${m.text}`).join('\n');
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
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
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
      messages.map(m => `[${m.timestamp}] ${m.sender}${m.chatName ? ` [Chat: ${m.chatName}]` : ''}: ${m.text}`).join('\n');

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
