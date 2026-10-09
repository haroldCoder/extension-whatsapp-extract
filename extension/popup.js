// WhatsApp Message Extractor - Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  let activeTabId = null;
  let isWhatsAppTab = false;
  let savedChats = {};
  let currentSelectedChat = '';
  let activeFilter = 'all';
  let activeSearch = '';

  // Elements
  const statusIndicator = document.getElementById('wa-connection-status');
  const statusText = document.getElementById('wa-status-text');
  const alertNotActive = document.getElementById('wa-not-active-alert');
  const btnGoWa = document.getElementById('btn-go-wa');
  const btnOpenWa = document.getElementById('btn-open-wa');
  const btnScanAllToday = document.getElementById('btn-scan-all-today');
  const btnExtractActive = document.getElementById('btn-extract-active');
  const btnExtractToday = document.getElementById('btn-extract-today');
  const btnExtractNew = document.getElementById('btn-extract-new');
  const selectChat = document.getElementById('select-chat');
  const statsBadge = document.getElementById('stats-badge');
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const filterChips = document.querySelectorAll('.chip');
  const messagesContainer = document.getElementById('messages-container');
  const btnCopyAll = document.getElementById('btn-copy-all');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnExportTxt = document.getElementById('btn-export-txt');
  const btnDeleteChat = document.getElementById('btn-delete-chat');

  // 1. Check current tab status
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('web.whatsapp.com')) {
      activeTabId = tab.id;
      isWhatsAppTab = true;
      statusIndicator.className = 'status-indicator connected';
      statusText.textContent = 'Conectado a WA Web';
      alertNotActive.style.display = 'none';

      // Request active chat info from content script
      chrome.tabs.sendMessage(activeTabId, { action: 'GET_ACTIVE_CHAT_STATUS' }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('Content script not reachable yet:', chrome.runtime.lastError.message);
        } else if (res && res.activeChat) {
          if (!currentSelectedChat) {
            currentSelectedChat = res.activeChat;
          }
        }
        loadStorageData();
      });
    } else {
      isWhatsAppTab = false;
      statusIndicator.className = 'status-indicator disconnected';
      statusText.textContent = 'Fuera de WhatsApp Web';
      alertNotActive.style.display = 'block';
      loadStorageData();
    }
  });

  // Open WhatsApp Web in tab
  const openWhatsApp = () => {
    chrome.tabs.create({ url: 'https://web.whatsapp.com' });
  };
  btnGoWa.addEventListener('click', openWhatsApp);
  btnOpenWa.addEventListener('click', openWhatsApp);

  // 2. Load data from chrome.storage.local
  function loadStorageData() {
    chrome.storage.local.get(['wa_saved_chats'], (res) => {
      savedChats = res.wa_saved_chats || {};
      populateChatDropdown();
      renderMessages();
    });
  }

  // Listen to storage changes from content script
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wa_saved_chats) {
      savedChats = changes.wa_saved_chats.newValue || {};
      populateChatDropdown();
      renderMessages();
    }
  });

  // Helper: Aggregate all today messages across all saved chats and the global collection
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

  // Populate Chat Dropdown
  function populateChatDropdown() {
    selectChat.innerHTML = '';
    const chatNames = Object.keys(savedChats);
    const globalMsgs = getGlobalTodayMessages();

    // If global today messages exist or __TODAY_ALL__ is in storage, make it first option
    if (globalMsgs.length > 0 || savedChats['__TODAY_ALL__']) {
      const opt = document.createElement('option');
      opt.value = '__TODAY_ALL__';
      opt.textContent = `🌟 Todos los chats de hoy (${globalMsgs.length})`;
      if (currentSelectedChat === '__TODAY_ALL__') {
        opt.selected = true;
      }
      selectChat.appendChild(opt);
    }

    const regularChatNames = chatNames.filter(n => n !== '__TODAY_ALL__');

    if (regularChatNames.length === 0 && globalMsgs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin conversaciones guardadas';
      selectChat.appendChild(opt);
      statsBadge.textContent = '0 msgs';
      return;
    }

    regularChatNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      const count = (savedChats[name]?.messages || []).length;
      opt.textContent = `${name} (${count})`;
      if (name === currentSelectedChat) {
        opt.selected = true;
      }
      selectChat.appendChild(opt);
    });

    if (!currentSelectedChat || (!savedChats[currentSelectedChat] && currentSelectedChat !== '__TODAY_ALL__')) {
      currentSelectedChat = globalMsgs.length > 0 ? '__TODAY_ALL__' : (regularChatNames[0] || '');
      selectChat.value = currentSelectedChat;
    }
  }

  selectChat.addEventListener('change', (e) => {
    currentSelectedChat = e.target.value;
    renderMessages();
  });

  // Global Auto-Scan (All Chats of Today)
  btnScanAllToday.addEventListener('click', () => {
    if (!isWhatsAppTab) {
      alert('Debes estar en la pestaña de WhatsApp Web para escanear.');
      return;
    }
    const origHTML = btnScanAllToday.innerHTML;
    btnScanAllToday.innerHTML = `<span>⏳</span> <span>Escaneando todos los chats de hoy...</span>`;
    btnScanAllToday.disabled = true;

    chrome.tabs.sendMessage(activeTabId, { action: 'SCAN_ALL_TODAY_CHATS' }, (res) => {
      btnScanAllToday.innerHTML = origHTML;
      btnScanAllToday.disabled = false;

      if (chrome.runtime.lastError) {
        alert('Error al comunicar con WhatsApp Web. Recarga la página de WhatsApp.');
      } else if (res && res.success) {
        currentSelectedChat = '__TODAY_ALL__';
        activeFilter = 'all';
        filterChips.forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
        loadStorageData();
      }
    });
  });

  // 3. Extract Actions
  btnExtractActive.addEventListener('click', () => {
    if (!isWhatsAppTab) {
      alert('Debes estar en la pestaña de WhatsApp Web para capturar.');
      return;
    }
    btnExtractActive.innerHTML = `<span>⏳</span> <span>Cargando...</span>`;
    chrome.tabs.sendMessage(activeTabId, { action: 'EXTRACT_CURRENT_CHAT' }, (res) => {
      btnExtractActive.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Todos</span>
      `;
      if (chrome.runtime.lastError) {
        alert('Error al comunicar con WhatsApp Web. Recarga la página de WhatsApp.');
      } else if (res && res.success) {
        currentSelectedChat = res.chatName;
        loadStorageData();
      }
    });
  });

  btnExtractToday.addEventListener('click', () => {
    if (!isWhatsAppTab) {
      alert('Debes estar en la pestaña de WhatsApp Web para capturar.');
      return;
    }
    btnExtractToday.innerHTML = `<span>⏳</span> <span>Buscando...</span>`;
    chrome.tabs.sendMessage(activeTabId, { action: 'EXTRACT_TODAY_MESSAGES' }, (res) => {
      btnExtractToday.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        <span>De Hoy</span>
      `;
      if (chrome.runtime.lastError) {
        alert('Error al comunicar con WhatsApp Web. Recarga la página de WhatsApp.');
      } else if (res && res.success) {
        currentSelectedChat = res.chatName;
        activeFilter = 'today';
        filterChips.forEach(c => {
          c.classList.toggle('active', c.dataset.filter === 'today');
        });
        loadStorageData();
      }
    });
  });

  btnExtractNew.addEventListener('click', () => {
    if (!isWhatsAppTab) {
      alert('Debes estar en la pestaña de WhatsApp Web para capturar.');
      return;
    }
    btnExtractNew.innerHTML = `<span>⏳</span> <span>Buscando...</span>`;
    chrome.tabs.sendMessage(activeTabId, { action: 'EXTRACT_NEW_MESSAGES' }, (res) => {
      btnExtractNew.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>Nuevos</span>
      `;
      if (chrome.runtime.lastError) {
        alert('Error al comunicar con WhatsApp Web. Recarga la página de WhatsApp.');
      } else if (res && res.success) {
        currentSelectedChat = res.chatName;
        loadStorageData();
      }
    });
  });

  // 4. Filter Chips & Search
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderMessages();
    });
  });

  searchInput.addEventListener('input', (e) => {
    activeSearch = e.target.value.toLowerCase().trim();
    btnClearSearch.style.display = activeSearch ? 'block' : 'none';
    renderMessages();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    activeSearch = '';
    btnClearSearch.style.display = 'none';
    renderMessages();
  });

  // 5. Render Messages Feed
  function renderMessages() {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);
    statsBadge.textContent = `${messages.length} msgs`;

    if (!messages || messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-feed">
          <div class="empty-icon">💬</div>
          <p class="empty-title">${isGlobal ? 'Sin mensajes de hoy capturados aún' : `Sin mensajes en "${escapeHTML(currentSelectedChat || 'este chat')}"`}</p>
          <p class="empty-subtitle">${isGlobal ? 'Haz clic en <strong>🌐 Escanear Todos los Chats de Hoy</strong> arriba para capturarlos automáticamente.' : 'Usa el botón <strong>Este Chat</strong> o posa sobre el chat en WhatsApp Web.'}</p>
        </div>
      `;
      return;
    }

    const filtered = messages.filter(m => {
      if (activeFilter === 'new' && !m.isNew) return false;
      if (activeFilter === 'today' && !m.isToday) return false;
      if (activeFilter === 'in' && m.type !== 'incoming') return false;
      if (activeFilter === 'out' && m.type !== 'outgoing') return false;
      if (activeSearch && !m.text.toLowerCase().includes(activeSearch) && !m.sender.toLowerCase().includes(activeSearch)) return false;
      return true;
    });

    if (filtered.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-feed">
          <div class="empty-icon">🔍</div>
          <p class="empty-title">Sin resultados</p>
          <p class="empty-subtitle">No hay mensajes que coincidan con los filtros aplicados.</p>
        </div>
      `;
      return;
    }

    messagesContainer.innerHTML = '';
    filtered.forEach(msg => {
      const card = document.createElement('div');
      card.className = `msg-card ${msg.type === 'outgoing' ? 'out' : 'in'} ${msg.isNew ? 'is-new' : ''}`;
      const showChatPill = (currentSelectedChat === '__TODAY_ALL__' || !currentSelectedChat) && msg.chatName;
      card.innerHTML = `
        <div class="card-top">
          <div style="display:flex; align-items:center; gap:5px;">
            <span class="card-sender">${escapeHTML(msg.sender)}</span>
            ${showChatPill ? `<span class="card-chat-pill">${escapeHTML(msg.chatName)}</span>` : ''}
          </div>
          <div class="card-meta">
            ${msg.isToday ? '<span class="badge-today">HOY</span>' : ''}
            ${msg.isNew ? '<span class="badge-new">NUEVO</span>' : ''}
            <span class="card-time">${escapeHTML(msg.timestamp)}</span>
          </div>
        </div>
        <div class="card-body">${escapeHTML(msg.text)}</div>
        <div class="card-actions">
          <button class="btn-card-copy">Copiar</button>
        </div>
      `;

      card.querySelector('.btn-card-copy').addEventListener('click', (e) => {
        const btn = e.target;
        navigator.clipboard.writeText(`[${msg.timestamp}] ${msg.sender}: ${msg.text}`);
        btn.textContent = '¡Copiado!';
        setTimeout(() => { btn.textContent = 'Copiar'; }, 1200);
      });

      messagesContainer.appendChild(card);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 6. Export Functions
  btnCopyAll.addEventListener('click', () => {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);
    if (messages.length === 0) return;
    const formatted = messages.map(m => `[${m.timestamp}] ${m.sender}${m.chatName ? ` (${m.chatName})` : ''}: ${m.text}`).join('\n');
    navigator.clipboard.writeText(formatted).then(() => {
      const orig = btnCopyAll.innerHTML;
      btnCopyAll.innerHTML = `<span>✅</span> Copiado`;
      setTimeout(() => { btnCopyAll.innerHTML = orig; }, 1500);
    });
  });

  btnExportJson.addEventListener('click', () => {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);
    if (messages.length === 0) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `whatsapp_${isGlobal ? 'todos_los_de_hoy' : (currentSelectedChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.json`);
    dl.click();
  });

  btnExportTxt.addEventListener('click', () => {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);
    if (messages.length === 0) return;
    const title = isGlobal ? 'TODOS LOS CHATS DE HOY (GLOBAL)' : currentSelectedChat;
    const formatted = `=== CHAT: ${title} ===\nExportado: ${new Date().toLocaleString()}\nTotal: ${messages.length}\n\n` +
      messages.map(m => `[${m.timestamp}] ${m.sender}${m.chatName ? ` (${m.chatName})` : ''}: ${m.text}`).join('\n');
    const dataStr = 'data:text/plain;charset=utf-8,' + encodeURIComponent(formatted);
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `whatsapp_${isGlobal ? 'todos_los_de_hoy' : (currentSelectedChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.txt`);
    dl.click();
  });

  btnDeleteChat.addEventListener('click', () => {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const targetChat = isGlobal ? '__TODAY_ALL__' : currentSelectedChat;
    if (!targetChat || (!savedChats[targetChat] && !isGlobal)) return;
    const chatTitle = isGlobal ? 'Todos los chats de hoy' : targetChat;
    if (confirm(`¿Eliminar los mensajes guardados de "${chatTitle}"?`)) {
      if (isGlobal) {
        delete savedChats['__TODAY_ALL__'];
      } else {
        delete savedChats[currentSelectedChat];
      }
      chrome.storage.local.set({ wa_saved_chats: savedChats }, () => {
        currentSelectedChat = '';
        loadStorageData();
      });
    }
  });

  function escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
