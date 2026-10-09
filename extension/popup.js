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
  const btnExtractActive = document.getElementById('btn-extract-active');
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

  // Populate Chat Dropdown
  function populateChatDropdown() {
    const chatNames = Object.keys(savedChats);
    selectChat.innerHTML = '';

    if (chatNames.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin conversaciones guardadas';
      selectChat.appendChild(opt);
      statsBadge.textContent = '0 msgs';
      return;
    }

    chatNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      const count = (savedChats[name]?.messages || []).length;
      opt.textContent = `${name} (${count})`;
      if (name === currentSelectedChat) {
        opt.selected = true;
      }
      selectChat.appendChild(opt);
    });

    if (!currentSelectedChat || !savedChats[currentSelectedChat]) {
      currentSelectedChat = chatNames[0];
      selectChat.value = currentSelectedChat;
    }
  }

  selectChat.addEventListener('change', (e) => {
    currentSelectedChat = e.target.value;
    renderMessages();
  });

  // 3. Extract Actions
  btnExtractActive.addEventListener('click', () => {
    if (!isWhatsAppTab) {
      alert('Debes estar en la pestaña de WhatsApp Web para capturar.');
      return;
    }
    btnExtractActive.innerHTML = `<span>⏳</span> <span>Capturando...</span>`;
    chrome.tabs.sendMessage(activeTabId, { action: 'EXTRACT_CURRENT_CHAT' }, (res) => {
      btnExtractActive.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Listar Chat Actual</span>
      `;
      if (chrome.runtime.lastError) {
        alert('Error al comunicar con WhatsApp Web. Recarga la página de WhatsApp.');
      } else if (res && res.success) {
        currentSelectedChat = res.chatName;
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>Listar Nuevos</span>
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
    const chatData = savedChats[currentSelectedChat];
    const messages = chatData?.messages || [];
    statsBadge.textContent = `${messages.length} msgs`;

    if (!messages || messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-feed">
          <div class="empty-icon">💬</div>
          <p class="empty-title">Sin mensajes en "${escapeHTML(currentSelectedChat || 'este chat')}"</p>
          <p class="empty-subtitle">Usa el botón <strong>Listar Chat Actual</strong> o posa sobre el chat en WhatsApp Web.</p>
        </div>
      `;
      return;
    }

    const filtered = messages.filter(m => {
      if (activeFilter === 'new' && !m.isNew) return false;
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
      card.innerHTML = `
        <div class="card-top">
          <span class="card-sender">${escapeHTML(msg.sender)}</span>
          <div class="card-meta">
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
    const messages = savedChats[currentSelectedChat]?.messages || [];
    if (messages.length === 0) return;
    const formatted = messages.map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
    navigator.clipboard.writeText(formatted).then(() => {
      const orig = btnCopyAll.innerHTML;
      btnCopyAll.innerHTML = `<span>✅</span> Copiado`;
      setTimeout(() => { btnCopyAll.innerHTML = orig; }, 1500);
    });
  });

  btnExportJson.addEventListener('click', () => {
    const messages = savedChats[currentSelectedChat]?.messages || [];
    if (messages.length === 0) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `whatsapp_${(currentSelectedChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.json`);
    dl.click();
  });

  btnExportTxt.addEventListener('click', () => {
    const messages = savedChats[currentSelectedChat]?.messages || [];
    if (messages.length === 0) return;
    const formatted = `=== CHAT: ${currentSelectedChat} ===\nExportado: ${new Date().toLocaleString()}\nTotal: ${messages.length}\n\n` +
      messages.map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
    const dataStr = 'data:text/plain;charset=utf-8,' + encodeURIComponent(formatted);
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `whatsapp_${(currentSelectedChat || 'chat').replace(/\s+/g, '_')}_${Date.now()}.txt`);
    dl.click();
  });

  btnDeleteChat.addEventListener('click', () => {
    if (!currentSelectedChat || !savedChats[currentSelectedChat]) return;
    if (confirm(`¿Eliminar los mensajes guardados de "${currentSelectedChat}"?`)) {
      delete savedChats[currentSelectedChat];
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
