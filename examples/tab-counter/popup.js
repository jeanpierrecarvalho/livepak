const countEl = document.getElementById('count');
const listEl = document.getElementById('list');

chrome.tabs.query({}, (tabs) => {
  countEl.textContent = tabs.length;
  listEl.innerHTML = tabs
    .map((t) => `<div class="tab">${t.title || t.url}</div>`)
    .join('');
});
