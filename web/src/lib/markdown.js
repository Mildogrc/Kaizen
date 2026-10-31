// Markdown for AI replies. Raw HTML in model output is shown as text, links
// are limited to http(s)/mailto/relative, and remote images are not loaded.
import { Marked } from 'marked';

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    html({ text }) {
      return escape(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = /^(https?:|mailto:|\/(?!\/)|#)/i.test(href ?? '') ? href : '#';
      const t = title ? ` title="${escape(title)}"` : '';
      return `<a href="${escape(safe)}"${t} target="_blank" rel="noreferrer noopener">${label}</a>`;
    },
    image({ href, text }) {
      return escape(`[image: ${text || href}]`);
    },
  },
});

export const renderMarkdown = (text) => marked.parse(text ?? '', { async: false });
