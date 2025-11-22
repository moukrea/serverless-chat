import { renderMarkdown } from '../utils/markdown-renderer.js';

class MarkdownInput {
  constructor(textareaId, options = {}) {
    this.textarea = document.getElementById(textareaId);
    if (!this.textarea) {
      throw new Error(`Textarea with id "${textareaId}" not found`);
    }

    this.mode = options.mode || this.loadMode();
    this.debounceDelay = options.debounceDelay || 300;
    this.mobileBreakpoint = options.mobileBreakpoint || 768;
    this.onChange = options.onChange || null;

    this.debounceTimer = null;
    this.previewElement = null;
    this.toggleButton = null;

    this.init();
  }

  init() {
    this.createPreviewElement();
    this.createToggleButton();
    this.attachEventListeners();
    this.updateUI();
  }

  createPreviewElement() {
    const wrapper = this.textarea.closest('.message-input-wrapper');
    if (!wrapper) {
      console.warn('[MarkdownInput] Textarea must be inside .message-input-wrapper');
      return;
    }

    this.previewElement = document.createElement('div');
    this.previewElement.className = 'message-preview';
    this.previewElement.setAttribute('aria-hidden', 'true');
    wrapper.insertBefore(this.previewElement, this.textarea.nextSibling);
  }

  createToggleButton() {
    const wrapper = this.textarea.closest('.message-input-wrapper');
    if (!wrapper) return;

    this.toggleButton = document.createElement('button');
    this.toggleButton.className = 'btn-preview-toggle';
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-label', 'Toggle markdown preview');
    this.toggleButton.setAttribute('title', 'Toggle preview mode');

    const icon = document.createElement('i');
    this.updateToggleIcon(icon);
    this.toggleButton.appendChild(icon);

    this.toggleButton.addEventListener('click', () => this.cycleMode());

    const inputElement = wrapper.querySelector('.message-input');
    wrapper.insertBefore(this.toggleButton, inputElement);
  }

  updateToggleIcon(icon) {
    const icons = {
      raw: 'ti-eye-off',
      hybrid: 'ti-eye',
      preview: 'ti-eye-check'
    };
    icon.className = `ti ${icons[this.mode] || icons.raw}`;
  }

  attachEventListeners() {
    this.textarea.addEventListener('input', () => this.handleInput());
    this.textarea.addEventListener('focus', () => this.handleFocus());
    this.textarea.addEventListener('blur', () => this.handleBlur());

    window.addEventListener('resize', () => this.handleResize());
  }

  handleInput() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.updatePreview();
      if (this.onChange) {
        this.onChange(this.textarea.value);
      }
    }, this.debounceDelay);
  }

  handleFocus() {
    this.textarea.parentElement.classList.add('focused');
  }

  handleBlur() {
    this.textarea.parentElement.classList.remove('focused');
  }

  handleResize() {
    this.updateUI();
  }

  updatePreview() {
    if (!this.previewElement) return;

    const text = this.textarea.value;

    if (this.mode === 'raw' || !text.trim()) {
      this.previewElement.innerHTML = '';
      this.previewElement.classList.remove('active');
      this.textarea.classList.remove('preview-active');
      return;
    }

    try {
      const rendered = renderMarkdown(text);
      this.previewElement.innerHTML = rendered;
      this.previewElement.classList.add('active');
      this.textarea.classList.add('preview-active');
    } catch (error) {
      console.error('[MarkdownInput] Preview error:', error);
      this.previewElement.innerHTML = '';
    }
  }

  cycleMode() {
    const modes = ['raw', 'hybrid', 'preview'];
    const currentIndex = modes.indexOf(this.mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.setMode(modes[nextIndex]);
  }

  setMode(mode) {
    if (!['raw', 'hybrid', 'preview'].includes(mode)) {
      console.warn(`[MarkdownInput] Invalid mode: ${mode}`);
      return;
    }

    this.mode = mode;
    this.saveMode();
    this.updateUI();
    this.updatePreview();
  }

  updateUI() {
    if (!this.previewElement || !this.toggleButton) return;

    const isMobile = window.innerWidth <= this.mobileBreakpoint;
    const wrapper = this.textarea.closest('.message-input-wrapper');

    wrapper.classList.remove('mode-raw', 'mode-hybrid', 'mode-preview');
    wrapper.classList.add(`mode-${this.mode}`);

    if (isMobile) {
      wrapper.classList.add('mobile-layout');
    } else {
      wrapper.classList.remove('mobile-layout');
    }

    const icon = this.toggleButton.querySelector('i');
    if (icon) {
      this.updateToggleIcon(icon);
    }

    this.toggleButton.setAttribute('aria-pressed', this.mode !== 'raw');
  }

  render(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return renderMarkdown(text);
  }

  clearPreview() {
    if (this.previewElement) {
      this.previewElement.innerHTML = '';
      this.previewElement.classList.remove('active');
    }
    if (this.textarea) {
      this.textarea.classList.remove('preview-active');
    }
  }

  getValue() {
    return this.textarea.value;
  }

  setValue(value) {
    this.textarea.value = value;
    this.updatePreview();
  }

  clear() {
    this.textarea.value = '';
    this.clearPreview();
  }

  loadMode() {
    try {
      return localStorage.getItem('markdown-mode') || 'hybrid';
    } catch (e) {
      return 'hybrid';
    }
  }

  saveMode() {
    try {
      localStorage.setItem('markdown-mode', this.mode);
    } catch (e) {
      console.warn('[MarkdownInput] Failed to save mode preference');
    }
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.previewElement) {
      this.previewElement.remove();
    }

    if (this.toggleButton) {
      this.toggleButton.remove();
    }
  }
}

export default MarkdownInput;
