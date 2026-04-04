chrome.runtime.onInstalled.addListener(() => {
  console.log('Dev Test Extension installed');
  chrome.storage.local.set({ count: 0 });
});
