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
  const btnTransferAuraSystem = document.getElementById('btn-transfer-aurasystem');
  const txtTransferAuraSystem = document.getElementById('txt-transfer-aurasystem');
  const auraStatusHint = document.getElementById('aurasystem-status-hint');
  const inputAuraBusinessId = document.getElementById('input-aura-business-id');
  const inputAuraWorkerId = document.getElementById('input-aura-worker-id');

  // Load saved AuraSystem IDs safely
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
      chrome.storage.local.get(['aurasystem_settings'], (cfg) => {
        if (chrome.runtime?.lastError) return;
        if (inputAuraBusinessId) {
          inputAuraBusinessId.value = cfg?.aurasystem_settings?.businessId || '';
        }
        if (inputAuraWorkerId) {
          inputAuraWorkerId.value = cfg?.aurasystem_settings?.workerId || '';
        }
      });
    }
  } catch (e) {
    // Ignore context invalidation
  }

  const saveAuraInputs = () => {
    try {
      const bId = inputAuraBusinessId ? inputAuraBusinessId.value.trim() : '';
      const wId = inputAuraWorkerId ? inputAuraWorkerId.value.trim() : '';
      if (typeof auraService !== 'undefined') {
        auraService.saveConfig({ businessId: bId, workerId: wId }).catch(() => {});
      } else if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
        chrome.storage.local.set({ aurasystem_settings: { businessId: bId, workerId: wId } });
      }
    } catch (e) {
      // Ignore context invalidation
    }
  };
  if (inputAuraBusinessId) inputAuraBusinessId.addEventListener('input', saveAuraInputs);
  if (inputAuraWorkerId) inputAuraWorkerId.addEventListener('input', saveAuraInputs);

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

  let realPhoneCache = {};

  // 2. Load data from chrome.storage.local
  function loadStorageData() {
    chrome.storage.local.get(['wa_saved_chats', 'wa_real_phone_cache'], (res) => {
      savedChats = res.wa_saved_chats || {};
      realPhoneCache = res.wa_real_phone_cache || {};
      populateChatDropdown();
      renderMessages();
    });
  }

  // Listen to storage changes from content script
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.wa_saved_chats) {
        savedChats = changes.wa_saved_chats.newValue || {};
      }
      if (changes.wa_real_phone_cache) {
        realPhoneCache = changes.wa_real_phone_cache.newValue || {};
      }
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

  // Helper: Retrieve only the messages currently listed in the UI feed based on chat and active filters
  function getCurrentlyListedMessages() {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const messages = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);

    return messages.filter(m => {
      if (activeFilter === 'new' && !m.isNew) return false;
      if (activeFilter === 'today' && !m.isToday) return false;
      if (activeFilter === 'in' && m.type !== 'incoming') return false;
      if (activeFilter === 'out' && m.type !== 'outgoing') return false;
      if (activeSearch && !m.text.toLowerCase().includes(activeSearch) && !m.sender.toLowerCase().includes(activeSearch)) return false;
      return true;
    });
  }

  // 5. Render Messages Feed
  function renderMessages() {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const allMessagesInChat = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);
    const filtered = getCurrentlyListedMessages();
    statsBadge.textContent = `${filtered.length} / ${allMessagesInChat.length} msgs`;

    if (!allMessagesInChat || allMessagesInChat.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-feed">
          <div class="empty-icon">💬</div>
          <p class="empty-title">${isGlobal ? 'Sin mensajes de hoy capturados aún' : `Sin mensajes en "${escapeHTML(currentSelectedChat || 'este chat')}"`}</p>
          <p class="empty-subtitle">${isGlobal ? 'Haz clic en <strong>🌐 Escanear Todos los Chats de Hoy</strong> arriba para capturarlos automáticamente.' : 'Usa el botón <strong>Este Chat</strong> o posa sobre el chat en WhatsApp Web.'}</p>
        </div>
      `;
      return;
    }

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

  function normalizeContactName(name) {
    if (!name) return '';
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  function getResolvedPhone(msg) {
    const rawNum = msg.numero || msg.phone || '';
    let validNum = (!isLikelyLid(rawNum) && String(rawNum).replace(/\D/g, '').length >= 7) ? String(rawNum).replace(/\D/g, '') : '';
    if (!validNum && realPhoneCache) {
      const norm = normalizeContactName(msg.chatName || msg.sender || '');
      const cached = realPhoneCache[norm] || realPhoneCache[msg.chatName] || realPhoneCache[msg.sender];
      if (cached && !isLikelyLid(cached)) {
        validNum = String(cached).replace(/\D/g, '');
      }
    }
    return validNum;
  }

  function renderMessages() {
    const isGlobal = currentSelectedChat === '__TODAY_ALL__';
    const allMessagesInChat = isGlobal ? getGlobalTodayMessages() : (savedChats[currentSelectedChat]?.messages || []);

    // Filter
    let filtered = allMessagesInChat.filter(msg => {
      if (activeFilter === 'new') return msg.isNew;
      if (activeFilter === 'today') return msg.isToday;
      if (activeFilter === 'in') return msg.type === 'incoming';
      if (activeFilter === 'out') return msg.type === 'outgoing';
      return true;
    });

    // Search query
    if (activeSearch) {
      filtered = filtered.filter(msg =>
        (msg.text && msg.text.toLowerCase().includes(activeSearch)) ||
        (msg.sender && msg.sender.toLowerCase().includes(activeSearch)) ||
        (msg.chatName && msg.chatName.toLowerCase().includes(activeSearch)) ||
        (msg.numero && msg.numero.includes(activeSearch))
      );
    }

    if (filtered.length === 0) {
      messagesContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <div class="empty-state-text">No hay mensajes que coincidan</div>
        </div>
      `;
      return;
    }

    messagesContainer.innerHTML = '';
    filtered.forEach(msg => {
      const card = document.createElement('div');
      card.className = `msg-card ${msg.type === 'outgoing' ? 'out' : 'in'} ${msg.isNew ? 'is-new' : ''}`;
      const showChatPill = (currentSelectedChat === '__TODAY_ALL__' || !currentSelectedChat) && msg.chatName;
      const numDisplay = getResolvedPhone(msg);

      card.innerHTML = `
        <div class="card-top">
          <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
            <span class="card-sender">${escapeHTML(msg.sender)}</span>
            ${numDisplay ? `<span class="card-phone-pill" title="Número de teléfono">📱 +${escapeHTML(numDisplay)}</span>` : ''}
            ${msg.isSavedContact === true ? '<span class="badge-contact" title="Contacto guardado">👤 Contacto</span>' : (msg.isSavedContact === false ? '<span class="badge-unsaved" title="Número no agregado">🆕 No guardado</span>' : '')}
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
        const phoneTxt = numDisplay ? ` (+${numDisplay})` : '';
        navigator.clipboard.writeText(`[${msg.timestamp}] ${msg.sender}${phoneTxt}: ${msg.text}`);
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
    const formatted = messages.map(m => {
      const validNum = getResolvedPhone(m);
      const phoneTxt = validNum ? ` (+${validNum})` : '';
      return `[${m.timestamp}] ${m.sender}${phoneTxt}${m.chatName ? ` (${m.chatName})` : ''}: ${m.text}`;
    }).join('\n');
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
    const cleanMessages = messages.map(m => {
      const copy = { ...m };
      const validNum = getResolvedPhone(copy);
      copy.numero = validNum;
      copy.phone = validNum;
      return copy;
    });
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cleanMessages, null, 2));
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
      messages.map(m => {
        const validNum = getResolvedPhone(m);
        const phoneTxt = validNum ? ` [Tel: +${validNum}]` : '';
        return `[${m.timestamp}] ${m.sender}${phoneTxt}${m.chatName ? ` (${m.chatName})` : ''}: ${m.text}`;
      }).join('\n');
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

  // 7. AuraSystem Transfer Flow
  if (btnTransferAuraSystem) {
    btnTransferAuraSystem.addEventListener('click', async () => {
      // Get ONLY the messages that are currently listed in the UI feed
      let messages = getCurrentlyListedMessages();
      let chatTitle = (currentSelectedChat === '__TODAY_ALL__') ? 'Todos los chats de hoy (Global)' : (currentSelectedChat || 'Chat Activo');

      // If no messages stored yet, try quick extract from active WhatsApp tab
      if (messages.length === 0 && isWhatsAppTab && activeTabId) {
        setAuraStatus('Extrayendo mensajes del chat actual...', '#a1a1aa');
        btnTransferAuraSystem.classList.add('is-loading');
        try {
          const res = await new Promise((resolve) => {
            chrome.tabs.sendMessage(activeTabId, { action: 'EXTRACT_CURRENT_CHAT' }, (r) => {
              if (chrome.runtime.lastError) resolve(null);
              else resolve(r);
            });
          });
          if (res && res.messages && res.messages.length > 0) {
            chatTitle = res.chatName || chatTitle;
            loadStorageData();
            messages = getCurrentlyListedMessages();
          }
        } catch (e) {
          // ignore
        }
        btnTransferAuraSystem.classList.remove('is-loading');
      }

      if (messages.length === 0) {
        setAuraStatus('⚠️ No hay mensajes enlistados para transferir.', '#ff758c');
        setTimeout(() => setAuraStatus('', ''), 3500);
        return;
      }

      const businessId = inputAuraBusinessId ? inputAuraBusinessId.value.trim() : '';
      const workerId = inputAuraWorkerId ? inputAuraWorkerId.value.trim() : '';

      // Validación: Requiere al menos uno de los dos IDs (businessId o workerId)
      if (!businessId && !workerId) {
        setAuraStatus('⚠️ Ingresa al menos el Id de dueño o el Id de trabajadora.', '#ff758c');
        if (inputAuraBusinessId) {
          inputAuraBusinessId.focus();
        }
        return;
      }

      // Start transfer directly using each message's own number
      btnTransferAuraSystem.disabled = true;
      btnTransferAuraSystem.classList.add('is-loading');
      setAuraStatus('Iniciando transferencia...', '#ff2d75');

      try {
        if (typeof auraService !== 'undefined') {
          const result = await auraService.transferMessages({
            chatName: chatTitle,
            messages,
            businessId,
            workerId,
            onProgress: ({ current, total, percentage, phoneNumber }) => {
              if (txtTransferAuraSystem) {
                txtTransferAuraSystem.textContent = `Transfiriendo (${current}/${total})...`;
              }
              setAuraStatus(`${percentage}% completado (${current}/${total})${phoneNumber ? ` • ${phoneNumber}` : ''}`, '#ff2d75');
            }
          });

          if (result && result.success) {
            if (txtTransferAuraSystem) {
              txtTransferAuraSystem.textContent = '¡Transferido con Éxito!';
            }
            setAuraStatus(`✅ ${result.successful} mensaje(s) sincronizados con AuraSystem Spa`, '#25D366');
            setTimeout(() => {
              if (txtTransferAuraSystem) {
                txtTransferAuraSystem.textContent = 'Transferir a AuraSystem';
              }
              setAuraStatus('', '');
            }, 4000);
          } else {
            setAuraStatus(`⚠️ ${result?.error || 'No se pudo completar la transferencia'}`, '#ff4d4f');
            if (txtTransferAuraSystem) {
              txtTransferAuraSystem.textContent = 'Reintentar Transferencia';
            }
          }
        } else {
          setAuraStatus('Error: Módulo AuraSystem no cargado.', '#ff4d4f');
        }
      } catch (err) {
        setAuraStatus(`Error: ${err.message}`, '#ff4d4f');
      } finally {
        btnTransferAuraSystem.disabled = false;
        btnTransferAuraSystem.classList.remove('is-loading');
      }
    });
  }

  function setAuraStatus(msg, color) {
    if (!auraStatusHint) return;
    if (!msg) {
      auraStatusHint.style.display = 'none';
      auraStatusHint.textContent = '';
    } else {
      auraStatusHint.style.display = 'block';
      auraStatusHint.style.color = color || '#ff2d75';
      auraStatusHint.textContent = msg;
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
});
