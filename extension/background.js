// Background service worker for WhatsApp Web Message Extractor

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

// Update badge count
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
});
