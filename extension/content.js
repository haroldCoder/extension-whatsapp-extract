// WhatsApp Web Message Extractor - Content Script
(function () {
  'use strict';

  console.log('[WA-Extractor] Content script cargado en WhatsApp Web');

  // State
  let currentActiveChat = null;
  let savedChats = {};
  let autoCaptureObserver = null;
  let isAutoCaptureEnabled = false;
  let activeFilter = 'all'; // all | new | in | out
  let activeSearch = '';

  // Initialize storage
  chrome.storage.local.get(['wa_saved_chats', 'wa_settings'], (result) => {
    savedChats = result.wa_saved_chats || {};
    if (result.wa_settings?.autoCaptureNew) {
      enableAutoCapture(true);
    }
    updateBadge();
    initUI();
  });

  // Listen to messages from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_CURRENT_CHAT') {
      const result = extractMessagesFromCurrentChat(false);
      sendResponse(result);
      return true;
    }
    if (request.action === 'EXTRACT_NEW_MESSAGES') {
      const result = extractMessagesFromCurrentChat(true);
      sendResponse(result);
      return true;
    }
    if (request.action === 'GET_ACTIVE_CHAT_STATUS') {
      const chatName = getActiveChatName();
      sendResponse({
        activeChat: chatName,
        savedCount: chatName && savedChats[chatName] ? savedChats[chatName].messages.length : 0
      });
      return true;
    }
  });

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
      const text = titleEl.getAttribute('title') || titleEl.innerText;
      if (text && text.trim().length > 0) return text.trim();
    }
    return 'Chat Activo';
  }

  // Main extraction function
  function extractMessagesFromCurrentChat(onlyNew = false) {
    const main = document.querySelector('#main');
    if (!main) {
      showToast('Por favor abre una conversación en WhatsApp Web', '⚠️');
      return { success: false, error: 'No active chat open' };
    }

    const chatName = getActiveChatName() || 'Chat Sin Nombre';
    currentActiveChat = chatName;

    // Detect messages containers
    // Multiple selectors to handle WhatsApp Web updates
    const messageContainers = main.querySelectorAll(
      'div[role="row"], div.message-in, div.message-out, div[data-testid="msg-container"]'
    );

    if (!messageContainers || messageContainers.length === 0) {
      showToast('No se encontraron mensajes visibles en este chat', 'ℹ️');
      return { success: false, error: 'No messages found', chatName };
    }

    const previousMessages = savedChats[chatName]?.messages || [];
    const prevIds = new Set(previousMessages.map(m => m.id));

    const extracted = [];
    let foundUnreadSeparator = false;

    messageContainers.forEach((el, index) => {
      // Check for unread messages divider ("MENSAJES NO LEÍDOS" / "UNREAD MESSAGES")
      const textContent = el.innerText || '';
      if (
        textContent.toLowerCase().includes('mensaje no leído') ||
        textContent.toLowerCase().includes('mensajes no leídos') ||
        textContent.toLowerCase().includes('unread message')
      ) {
        foundUnreadSeparator = true;
      }

      // Check incoming vs outgoing
      const isOutgoing = el.classList.contains('message-out') ||
        !!el.querySelector('[data-icon="msg-dblcheck"], [data-icon="msg-check"]') ||
        el.getAttribute('data-id')?.includes('true_'); // true_ usually denotes from me in WA

      const isIncoming = el.classList.contains('message-in') || !isOutgoing;

      // Extract sender
      let sender = isOutgoing ? 'Tú' : chatName;
      const senderSpan = el.querySelector('span[dir="auto"][role="button"], span[aria-label]');
      if (isIncoming && senderSpan && senderSpan.innerText && senderSpan.innerText !== chatName) {
        sender = senderSpan.innerText.trim();
      }

      // Extract timestamp & pre-plain-text if available
      let timestamp = '';
      const prePlainTextEl = el.querySelector('div[data-pre-plain-text]');
      if (prePlainTextEl) {
        const rawMeta = prePlainTextEl.getAttribute('data-pre-plain-text') || '';
        // Format: "[14:23, 9/10/2026] Contacto: "
        const timeMatch = rawMeta.match(/\[(.*?)\]/);
        if (timeMatch) timestamp = timeMatch[1];
      }

      if (!timestamp) {
        const timeEl = el.querySelector('span[dir="auto"].copyable-text, span.selectable-text + span, div[data-testid="msg-meta"] span');
        if (timeEl && timeEl.innerText && /\d{1,2}:\d{2}/.test(timeEl.innerText)) {
          timestamp = timeEl.innerText.trim();
        } else {
          timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }

      // Extract message text content
      let text = '';
      const textSpan = el.querySelector('span.selectable-text, div.copyable-text, span[dir="ltr"], span[dir="rtl"]');
      if (textSpan) {
        text = textSpan.innerText.trim();
      }

      // Check media types if no text
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
          // If container has raw text, grab clean snippet
          const lines = (el.innerText || '').split('\n').filter(l => l.trim().length > 0 && !/\d{1,2}:\d{2}/.test(l));
          if (lines.length > 0) {
            text = lines.join(' ');
          }
        }
      }

      if (!text || text.trim().length === 0) return;

      // Unique ID calculation
      const id = `${chatName}_${timestamp}_${sender}_${text.substring(0, 30)}`.replace(/\s+/g, '_');
      const isNew = foundUnreadSeparator || !prevIds.has(id);

      if (onlyNew && !isNew) {
        return; // Skip already captured
      }

      extracted.push({
        id,
        chatName,
        sender,
        text,
        timestamp,
        type: isOutgoing ? 'outgoing' : 'incoming',
        isNew,
        capturedAt: new Date().toISOString()
      });
    });

    if (extracted.length === 0) {
      showToast(onlyNew ? 'No hay mensajes nuevos en este chat' : 'No se extrajeron mensajes', 'ℹ️');
      return { success: true, count: 0, messages: [], chatName };
    }

    // Merge into savedChats
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

    // Persist to storage
    chrome.storage.local.set({ wa_saved_chats: savedChats }, () => {
      updateBadge();
      updatePanelUI();
      showToast(`¡${extracted.length} mensajes ${onlyNew ? 'nuevos ' : ''}capturados!`, '📥');
      openPanel();
    });

    return {
      success: true,
      chatName,
      count: extracted.length,
      messages: extracted
    };
  }

  // Update extension badge count
  function updateBadge() {
    let total = 0;
    Object.values(savedChats).forEach(c => {
      total += (c.messages || []).length;
    });
    chrome.runtime.sendMessage({ action: 'UPDATE_BADGE', count: total });
    const badgeEl = document.querySelector('#wa-extractor-fab .badge-count');
    if (badgeEl) badgeEl.textContent = total;
  }

  // Inject Hover Action Buttons in Chat List items
  function injectHoverListeners() {
    const paneSide = document.querySelector('#pane-side, div[aria-label="Chat list"], div[role="grid"]');
    if (!paneSide) return;

    // Observe or scan chat rows
    const chatItems = paneSide.querySelectorAll('div[role="listitem"], div[role="row"], div[tabindex="-1"]');
    chatItems.forEach(item => {
      if (item.dataset.waExtractHoverInjected) return;
      item.dataset.waExtractHoverInjected = 'true';

      // Ensure item has relative positioning for the hover trigger
      if (window.getComputedStyle(item).position === 'static') {
        item.style.position = 'relative';
      }

      // Check if item contains an unread indicator
      const unreadBadge = item.querySelector('span[aria-label*="unread"], span[aria-label*="no leído"], span[data-icon="unread-count"], span.rounded-full');
      const unreadCount = unreadBadge ? (parseInt(unreadBadge.innerText, 10) || '!') : null;

      // Create hover trigger container
      const trigger = document.createElement('div');
      trigger.className = 'wa-extract-hover-trigger';

      // Button: List all of this chat
      const btnAll = document.createElement('button');
      btnAll.className = 'wa-hover-btn';
      btnAll.innerHTML = `<span>📥</span><span>Listar este chat</span>`;
      btnAll.title = 'Abrir y capturar todos los mensajes de este chat';

      // Button: List new only
      const btnNew = document.createElement('button');
      btnNew.className = 'wa-hover-btn wa-hover-btn-new';
      btnNew.innerHTML = `<span>⚡</span><span>${unreadCount ? `Nuevos (${unreadCount})` : 'Solo nuevos'}</span>`;
      btnNew.title = 'Capturar mensajes nuevos de este chat';

      // Action when clicked
      const handleExtractChat = (e, onlyNew) => {
        e.stopPropagation();
        e.preventDefault();

        // 1. Click on the chat row to activate it
        const clickable = item.querySelector('div[role="button"], div[tabindex="-1"], div') || item;
        clickable.click();

        showToast('Abriendo conversación y extrayendo...', '⏳');

        // 2. Wait for messages panel to render, then extract
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          const main = document.querySelector('#main');
          if (main || attempts > 15) {
            clearInterval(checkInterval);
            setTimeout(() => {
              extractMessagesFromCurrentChat(onlyNew);
            }, 300);
          }
        }, 200);
      };

      btnAll.addEventListener('click', (e) => handleExtractChat(e, false));
      btnNew.addEventListener('click', (e) => handleExtractChat(e, true));

      trigger.appendChild(btnNew);
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
          // Debounced capture
          if (window._waCaptureTimeout) clearTimeout(window._waCaptureTimeout);
          window._waCaptureTimeout = setTimeout(() => {
            extractMessagesFromCurrentChat(true);
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

    // 1. Create Floating Action Button (FAB)
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

    // 2. Create Drawer Panel
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

      <div class="wa-chat-banner">
        <div class="wa-chat-info">
          <div class="wa-chat-name" id="wa-display-chat">Selecciona un chat en WhatsApp</div>
          <div class="wa-chat-stats" id="wa-display-stats">0 mensajes guardados</div>
        </div>
        <button class="wa-btn wa-btn-secondary" id="wa-btn-refresh-chat" title="Actualizar">🔄 Actualizar</button>
      </div>

      <div class="wa-action-bar">
        <button class="wa-btn wa-btn-primary" id="wa-btn-extract-all">
          <span>📥</span> Listar Todos
        </button>
        <button class="wa-btn wa-btn-accent" id="wa-btn-extract-new">
          <span>⚡</span> Listar Nuevos
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
        <input type="text" class="wa-search-input" id="wa-search-input" placeholder="🔍 Buscar palabras en los mensajes...">
        <div class="wa-filter-tags">
          <div class="wa-tag active" data-filter="all">Todos</div>
          <div class="wa-tag" data-filter="new">Nuevos</div>
          <div class="wa-tag" data-filter="in">Recibidos</div>
          <div class="wa-tag" data-filter="out">Enviados</div>
        </div>
      </div>

      <div class="wa-message-feed" id="wa-message-feed">
        <div class="wa-empty-state">
          <div class="wa-empty-icon">💬</div>
          <div>No hay mensajes capturados aún.</div>
          <div style="font-size:11px;">Haz clic en <strong>Listar Todos</strong> o pasa el cursor sobre cualquier chat en la lista izquierda.</div>
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
    document.querySelector('#wa-btn-extract-all').addEventListener('click', () => extractMessagesFromCurrentChat(false));
    document.querySelector('#wa-btn-extract-new').addEventListener('click', () => extractMessagesFromCurrentChat(true));
    document.querySelector('#wa-btn-refresh-chat').addEventListener('click', () => {
      updatePanelUI();
      showToast('Vista actualizada', '🔄');
    });

    const liveToggle = document.querySelector('#wa-toggle-live');
    liveToggle.addEventListener('change', (e) => {
      enableAutoCapture(e.target.checked);
      chrome.storage.local.get(['wa_settings'], (res) => {
        const settings = res.wa_settings || {};
        settings.autoCaptureNew = e.target.checked;
        chrome.storage.local.set({ wa_settings: settings });
      });
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

    // Regularly scan for chat list hover elements (every 2 seconds)
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
    const activeChat = getActiveChatName() || currentActiveChat || 'Ningún chat seleccionado';
    currentActiveChat = activeChat;

    const displayChat = document.querySelector('#wa-display-chat');
    const displayStats = document.querySelector('#wa-display-stats');

    if (displayChat) displayChat.textContent = activeChat;

    const chatData = savedChats[activeChat];
    const count = chatData?.messages?.length || 0;
    if (displayStats) {
      displayStats.textContent = `${count} mensajes capturados ${chatData ? `(Última: ${new Date(chatData.lastUpdated).toLocaleTimeString()})` : ''}`;
    }

    renderFeed();
  }

  function renderFeed() {
    const feed = document.querySelector('#wa-message-feed');
    if (!feed) return;

    const activeChat = getActiveChatName() || currentActiveChat;
    const messages = savedChats[activeChat]?.messages || [];

    // Filter
    let filtered = messages.filter(m => {
      if (activeFilter === 'new' && !m.isNew) return false;
      if (activeFilter === 'in' && m.type !== 'incoming') return false;
      if (activeFilter === 'out' && m.type !== 'outgoing') return false;
      if (activeSearch && !m.text.toLowerCase().includes(activeSearch) && !m.sender.toLowerCase().includes(activeSearch)) return false;
      return true;
    });

    if (filtered.length === 0) {
      feed.innerHTML = `
        <div class="wa-empty-state">
          <div class="wa-empty-icon">${messages.length === 0 ? '💬' : '🔍'}</div>
          <div>${messages.length === 0 ? 'No hay mensajes capturados para este chat.' : 'No hay mensajes que coincidan con la búsqueda.'}</div>
          <div style="font-size:11px;">${messages.length === 0 ? 'Haz clic en "Listar Todos" arriba.' : 'Prueba otro término o filtro.'}</div>
        </div>
      `;
      return;
    }

    feed.innerHTML = '';
    filtered.forEach(msg => {
      const card = document.createElement('div');
      card.className = `wa-card ${msg.type === 'outgoing' ? 'outgoing' : 'incoming'} ${msg.isNew ? 'is-new' : ''}`;
      card.innerHTML = `
        <div class="wa-card-header">
          <span class="wa-sender">${escapeHTML(msg.sender)}</span>
          <div style="display:flex; align-items:center; gap:6px;">
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
        navigator.clipboard.writeText(`[${msg.timestamp}] ${msg.sender}: ${msg.text}`);
        showToast('Mensaje copiado', '📋');
      });

      feed.appendChild(card);
    });

    // Auto-scroll to bottom
    feed.scrollTop = feed.scrollHeight;
  }

  function exportCopy() {
    const activeChat = getActiveChatName() || currentActiveChat;
    const messages = savedChats[activeChat]?.messages || [];
    if (messages.length === 0) {
      showToast('No hay mensajes para copiar', '⚠️');
      return;
    }
    const formatted = messages.map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
    navigator.clipboard.writeText(formatted).then(() => {
      showToast(`${messages.length} mensajes copiados al portapapeles`, '📋');
    });
  }

  function exportJSON() {
    const activeChat = getActiveChatName() || currentActiveChat;
    const messages = savedChats[activeChat]?.messages || [];
    if (messages.length === 0) {
      showToast('No hay datos para exportar', '⚠️');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `whatsapp_${(activeChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.json`);
    dlAnchor.click();
    showToast('Archivo JSON descargado', '💾');
  }

  function exportTXT() {
    const activeChat = getActiveChatName() || currentActiveChat;
    const messages = savedChats[activeChat]?.messages || [];
    if (messages.length === 0) {
      showToast('No hay datos para exportar', '⚠️');
      return;
    }
    const formatted = `=== CHAT DE WHATSAPP: ${activeChat} ===\nExportado: ${new Date().toLocaleString()}\nTotal Mensajes: ${messages.length}\n\n` +
      messages.map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');

    const dataStr = 'data:text/plain;charset=utf-8,' + encodeURIComponent(formatted);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `whatsapp_${(activeChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.txt`);
    dlAnchor.click();
    showToast('Archivo TXT descargado', '📄');
  }

  function clearCurrentChat() {
    const activeChat = getActiveChatName() || currentActiveChat;
    if (!activeChat || !savedChats[activeChat]) {
      showToast('No hay mensajes guardados en este chat', 'ℹ️');
      return;
    }
    if (confirm(`¿Deseas eliminar los mensajes guardados de "${activeChat}"?`)) {
      delete savedChats[activeChat];
      chrome.storage.local.set({ wa_saved_chats: savedChats }, () => {
        updateBadge();
        updatePanelUI();
        showToast('Mensajes de este chat eliminados', '🗑️');
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
