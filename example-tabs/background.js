chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);

async function updateBadge() {
  const tabs = await chrome.tabs.query({});
  chrome.action.setBadgeText({ text: String(tabs.length) });
  chrome.action.setBadgeBackgroundColor({ color: '#1976d2' });
}

updateBadge();
