/**
 * One modal panel shared by the casino and the bank.
 *
 * Both venues hand it a title and rebuild its body with their own controls, so
 * gambling, the teller and vault cracking all live in the same place on screen
 * instead of stacking panels.
 */

export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function actionButton(label, onClick, { className = 'shop-item', detail = '', disabled = false } = {}) {
  const button = el('button', className);
  button.appendChild(el('span', '', label));
  if (detail) button.appendChild(el('span', 'price', detail));
  if (disabled) button.disabled = true;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

export class VenuePanel {
  constructor() {
    this.el = document.getElementById('venue');
    this.titleEl = document.getElementById('venue-title');
    this.bodyEl = document.getElementById('venue-body');
    this.hintEl = document.getElementById('venue-hint');
    this.open = false;
    this.onClose = null;
    this.el.addEventListener('mousedown', (event) => event.stopPropagation());
  }

  show(title, hint = '<kbd>E</kbd> or <kbd>Esc</kbd> to step away') {
    this.titleEl.textContent = title;
    this.hintEl.innerHTML = hint;
    this.el.classList.remove('hidden');
    this.open = true;
  }

  clear() {
    this.bodyEl.innerHTML = '';
    return this.bodyEl;
  }

  hide() {
    if (!this.open) return;
    this.el.classList.add('hidden');
    this.open = false;
    this.bodyEl.innerHTML = '';
    const callback = this.onClose;
    this.onClose = null;
    if (callback) callback();
  }
}
