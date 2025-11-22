import { renderMarkdown, renderStyledMarkdown } from '../utils/markdown-renderer.js';

class MarkdownInput {
  constructor(textareaId, options = {}) {
    this.textarea = document.getElementById(textareaId);
    if (!this.textarea) {
      throw new Error(`Textarea with id "${textareaId}" not found`);
    }

    this.debounceDelay = options.debounceDelay || 300;
    this.onChange = options.onChange || null;

    this.debounceTimer = null;
    this.previewElement = null;

    this.init();
  }

  init() {
    this.createPreviewElement();
    this.attachEventListeners();
  }

  createPreviewElement() {
    const wrapper = this.textarea.closest('.message-input-wrapper');
    if (!wrapper) {
      console.warn('[MarkdownInput] Textarea must be inside .message-input-wrapper');
      return;
    }

    this.previewElement = document.createElement('div');
    this.previewElement.className = 'message-preview styled-markdown';
    this.previewElement.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(this.previewElement);
  }

  attachEventListeners() {
    this.textarea.addEventListener('input', () => this.handleInput());
    this.textarea.addEventListener('scroll', () => this.syncScroll(), { passive: true });
    this.textarea.addEventListener('focus', () => this.handleFocus());
    this.textarea.addEventListener('blur', () => this.handleBlur());
  }

  handleInput() {
    this.autoResize();

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
    this.updatePreview();
  }

  handleBlur() {
    this.textarea.parentElement.classList.remove('focused');
  }

  syncScroll() {
    if (!this.previewElement) return;
    const scrollTop = this.textarea.scrollTop;
    const scrollLeft = this.textarea.scrollLeft;
    this.previewElement.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
  }

  autoResize() {
    const maxHeight = 144;
    this.textarea.style.height = 'auto';
    const newHeight = Math.min(this.textarea.scrollHeight, maxHeight);
    this.textarea.style.height = newHeight + 'px';
  }

  updatePreview() {
    if (!this.previewElement) return;

    const text = this.textarea.value;

    if (!text.trim()) {
      this.previewElement.innerHTML = '';
      this.previewElement.classList.remove('active');
      this.textarea.classList.remove('preview-active');
      return;
    }

    try {
      const styled = renderStyledMarkdown(text);
      this.previewElement.innerHTML = styled;
      this.previewElement.classList.add('active');
      this.textarea.classList.add('preview-active');
    } catch (error) {
      console.error('[MarkdownInput] Preview error:', error);
      this.previewElement.innerHTML = '';
    }
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
    this.autoResize();
    this.updatePreview();
  }

  clear() {
    this.textarea.value = '';
    this.clearPreview();
  }

  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (this.previewElement) {
      this.previewElement.remove();
    }
  }
}

export default MarkdownInput;
