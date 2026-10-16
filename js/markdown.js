// Compacte Markdown-renderer voor samenvattingen (koppen, lijsten, tabellen, code, citaten).
import { esc } from './util.js';

function inline(src) {
  const codes = [];
  let s = esc(src).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`);
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function renderList(lines) {
  // lines: [{indent, ordered, text}]
  let html = '';
  const stack = [];
  for (const it of lines) {
    const level = Math.floor(it.indent / 2);
    while (stack.length > level + 1) html += `</li></${stack.pop()}>`;
    if (stack.length === level + 1) html += '</li>';
    while (stack.length < level + 1) { const tag = it.ordered ? 'ol' : 'ul'; stack.push(tag); html += `<${tag}>`; }
    const task = it.text.match(/^\[( |x|X)\]\s+(.*)$/);
    html += task ? `<li class="task-li"><span class="cb ${task[1] !== ' ' ? 'on' : ''}"></span>${inline(task[2])}` : `<li>${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop()}>`;
  return html;
}

export function markdown(src = '') {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let out = '', para = [];
  const flush = () => { if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); out += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out += '<hr>'; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      i--;
      out += `<blockquote>${markdown(buf.join('\n'))}</blockquote>`;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      i--;
      out += `<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (LIST_RE.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && (LIST_RE.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const m = lines[i].match(LIST_RE);
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
      i--;
      out += renderList(items);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(line);
  }
  flush();
  return out;
}

export function plainText(src = '') {
  return String(src).replace(/[#>*_`|=-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
