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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function renderStyledMarkdown(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return '';
  }

  const lines = text.split('\n');
  const styledLines = lines.map((line, index, array) => {
    let styled = escapeHtml(line);

    styled = styled.replace(/^(#{1,6})\s+(.+)$/g, (match, hashes, content) => {
      const level = hashes.length;
      return `<span class="md-h${level}"><span class="md-syntax">${hashes} </span><span class="md-h${level}-text">${content}</span></span>`;
    });

    styled = styled.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold"><span class="md-syntax">**</span><span class="md-bold-text">$1</span><span class="md-syntax">**</span></span>');

    styled = styled.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<span class="md-italic"><span class="md-syntax">*</span><span class="md-italic-text">$1</span><span class="md-syntax">*</span></span>');

    styled = styled.replace(/~~([^~]+)~~/g, '<span class="md-strikethrough"><span class="md-syntax">~~</span><span class="md-strikethrough-text">$1</span><span class="md-syntax">~~</span></span>');

    styled = styled.replace(/`([^`]+)`/g, '<span class="md-code"><span class="md-syntax">`</span><span class="md-code-text">$1</span><span class="md-syntax">`</span></span>');

    styled = styled.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="md-link"><span class="md-syntax">[</span><span class="md-link-text">$1</span><span class="md-syntax">](</span><span class="md-link-url">$2</span><span class="md-syntax">)</span></span>');

    styled = styled.replace(/^(\s*[-*+])\s+(.+)$/g, '<span class="md-list"><span class="md-syntax">$1 </span><span class="md-list-text">$2</span></span>');

    styled = styled.replace(/^(\s*\d+\.)\s+(.+)$/g, '<span class="md-list"><span class="md-syntax">$1 </span><span class="md-list-text">$2</span></span>');

    styled = styled.replace(/^(&gt;)\s+(.+)$/g, '<span class="md-blockquote"><span class="md-syntax">&gt; </span><span class="md-blockquote-text">$2</span></span>');

    styled = styled.replace(/^(```)(.*)$/g, '<span class="md-codeblock"><span class="md-syntax">$1</span><span class="md-codeblock-lang">$2</span></span>');

    if (!styled.trim() && index < array.length - 1) {
      return '<div class="md-line-break">&nbsp;</div>';
    }

    if (styled.includes('class="md-')) {
      return styled;
    }

    return styled ? `<div class="md-line">${styled}</div>` : '';
  });

  return styledLines.filter(Boolean).join('');
}
