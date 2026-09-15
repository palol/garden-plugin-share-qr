(function () {
  'use strict';
  const container = document.getElementById('share-qr-dialog');
  if (!container || window.ShareQr) return;
  const closeButton = container.querySelector('[data-share-qr-close]');
  const status = container.querySelector('[role="status"]');
  let opener;
  const controls = () => [...container.querySelectorAll('a[href], button')].filter(el => !el.disabled && el.getClientRects().length);
  const fallback = {
    isOpen: () => container.classList.contains('active'),
    open() {
      opener = document.activeElement;
      container.inert = false;
      container.setAttribute('aria-hidden', 'false');
      container.classList.add('active');
      document.body.classList.add('share-qr-active');
      closeButton.focus();
    },
    close() {
      if (!fallback.isOpen()) return;
      container.classList.remove('active');
      container.inert = true;
      container.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('share-qr-active');
      if (opener && opener.isConnected) opener.focus();
    },
    handleKeydown(event) {
      if (!fallback.isOpen()) return;
      if (event.key === 'Escape') { event.preventDefault(); fallback.close(); }
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    },
  };
  const controller = typeof window.createDialogController === 'function'
    ? window.createDialogController(container, { bodyActiveClass: 'share-qr-active', getInitialFocus: () => closeButton })
    : fallback;
  if (controller === fallback) document.addEventListener('focusin', event => {
    if (fallback.isOpen() && !container.contains(event.target)) closeButton.focus();
  });
  window.ShareQr = Object.freeze({
    open() { if (!controller.isOpen()) { status.textContent = ''; controller.open(); } },
    close() { controller.close(); },
  });
  document.addEventListener('click', event => {
    const trigger = event.target.closest && event.target.closest('[data-share-qr-trigger]');
    if (!trigger || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    trigger.focus();
    // Host adapters can collapse their own navigation and establish the opener.
    trigger.dispatchEvent(new CustomEvent('share-qr:before-open', { bubbles: true }));
    window.ShareQr.open();
  });
  closeButton.addEventListener('click', () => controller.close());
  container.addEventListener('click', event => { if (event.target === container) controller.close(); });
  document.addEventListener('keydown', event => controller.handleKeydown(event));
  const copyButton = container.querySelector('[data-share-qr-copy]');
  if (copyButton) copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(container.dataset.targetUrl);
      status.textContent = 'Link copied.';
    } catch { status.textContent = 'Could not copy. Use the link below.'; }
  });
})();
