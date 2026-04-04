const countEl = document.getElementById('count');
const btn = document.getElementById('btn');

chrome.storage.local.get('count', ({ count }) => {
  countEl.textContent = count || 0;
});

btn.addEventListener('click', () => {
  chrome.storage.local.get('count', ({ count }) => {
    const next = (count || 0) + 1;
    chrome.storage.local.set({ count: next });
    countEl.textContent = next;
  });
});
