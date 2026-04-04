const textarea = document.getElementById('notes');
const status = document.getElementById('status');
let saveTimer;

chrome.storage.local.get('notes', ({ notes }) => {
  textarea.value = notes || '';
});

textarea.addEventListener('input', () => {
  status.textContent = 'Saving...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ notes: textarea.value });
    status.textContent = 'Saved';
  }, 500);
});
