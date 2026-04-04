chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('notes', ({ notes }) => {
    if (!notes) chrome.storage.local.set({ notes: '' });
  });
});
