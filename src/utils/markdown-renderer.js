import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

const sanitizeConfig = {
  ALLOWED_TAGS: [
    'p', 'br', 'span', 'div',
    'strong', 'em', 'b', 'i', 'u', 's', 'del',
    'code', 'pre',
    'a',
    'ul', 'ol', 'li',
    'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr'
  ],
  ALLOWED_ATTR: ['href', 'class', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  try {
    const rawHtml = marked.parse(text, options);
    const cleanHtml = DOMPurify.sanitize(rawHtml, sanitizeConfig);
    return cleanHtml;
  } catch (error) {
    console.error('[Markdown] Rendering error:', error);
    return DOMPurify.sanitize(text);
  }
}

export function validateMarkdownInput(text) {
  if (typeof text !== 'string') {
    return '';
  }

  const trimmed = text.trim().substring(0, 5000);

  if (/<script|javascript:/i.test(trimmed)) {
    throw new Error('Invalid content detected');
  }

  return trimmed;
}

export function detectMarkdownSyntax(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return false;
  }

  const markdownPatterns = [
    /^#{1,6}\s/m,
    /\*\*[^*]+\*\*/,
    /\*[^*]+\*/,
    /`[^`]+`/,
    /^\s*[-*+]\s/m,
    /^\s*\d+\.\s/m,
    /^\s*>/m,
    /\[.+\]\(.+\)/,
    /~~.+~~/
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}
