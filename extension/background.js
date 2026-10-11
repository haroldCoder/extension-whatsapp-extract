// Background service worker for WhatsApp Web Message Extractor

try {
  importScripts('aurasystem.js');
} catch (e) {
  console.warn('[WA-Extractor] Could not import aurasystem.js in worker:', e);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[WA-Extractor] Extensión instalada con éxito.');
  // Initialize storage defaults if empty
  chrome.storage.local.get(['wa_saved_chats', 'wa_settings'], (result) => {
    if (!result.wa_saved_chats) {
      chrome.storage.local.set({ wa_saved_chats: {} });
    }
    if (!result.wa_settings) {
      chrome.storage.local.set({
        wa_settings: {
          autoCaptureNew: false,
          showHoverButton: true
        }
      });
    }
  });
});

// Update badge count & message routing
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'UPDATE_BADGE') {
    const count = request.count || 0;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#25D366' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'GET_ACTIVE_TAB_STATUS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      const isWA = activeTab && activeTab.url && activeTab.url.includes('web.whatsapp.com');
      sendResponse({ isWA, tabId: activeTab?.id, url: activeTab?.url });
    });
    return true; // Keep channel open for async response
  }

  // Background transfer to AuraSystem
  if (request.action === 'TRANSFER_TO_AURASYSTEM') {
    const { chatName, messages, businessId, workerId } = request.payload || {};
    if (typeof auraService !== 'undefined') {
      auraService.transferMessages({
        chatName,
        messages,
        businessId,
        workerId,
        onProgress: (prog) => {
          chrome.runtime.sendMessage({ action: 'AURASYSTEM_PROGRESS', progress: prog }).catch(() => {});
        }
      }).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    } else {
      sendResponse({ success: false, error: 'AuraSystemService no disponible en worker.' });
    }
    return true;
  }
});

