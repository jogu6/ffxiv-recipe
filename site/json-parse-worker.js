'use strict';

self.addEventListener('message', event => {
  try {
    self.postMessage({ value: JSON.parse(String(event.data || '')) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
});
