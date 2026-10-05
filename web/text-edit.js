// 画布上就地编辑文字：在原文字节点上打开 contenteditable，位置、大小、样式与平时完全一致。
// 一次编辑会话只在结束时调用一次 onCommit；输入法选字过程中的中间态不回调 onInput。
const sessions = new WeakMap();
let plaintextSupport = null;

export function isEditingTextNode(node) { return !!node && sessions.has(node); }

function supportsPlaintext() {
  if (plaintextSupport === null) {
    try { const probe = document.createElement('div'); probe.contentEditable = 'plaintext-only'; plaintextSupport = probe.contentEditable === 'plaintext-only'; }
    catch { plaintextSupport = false; }
  }
  return plaintextSupport;
}

// 把编辑区内容规范成纯字符串：<br>、块级元素按换行算；缩放把手等非文字元素跳过；末尾占位用的 <br> 不算
function readText(host) {
  let out = '';
  const skip = el => el.hasAttribute('data-resize') || el.getAttribute('contenteditable') === 'false';
  const lastBr = (() => { let n = host.lastChild; while (n && n.nodeType === 3 && !n.data) n = n.previousSibling; return n?.nodeName === 'BR' ? n : null; })();
  const walk = parent => {
    for (const c of parent.childNodes) {
      if (c.nodeType === 3) out += c.data;
      else if (c.nodeType === 1 && !skip(c)) {
        if (c.nodeName === 'BR') { if (c !== lastBr) out += '\n'; continue; }
        const block = /^(DIV|P|LI|H[1-6]|PRE|BLOCKQUOTE)$/.test(c.nodeName);
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(c);
      }
    }
  };
  walk(host);
  return out;
}

// 双击位置换算成文字偏移：先用浏览器的命中测试（缩放容器里也按屏幕坐标算），落不到本节点时逐字找最近的位置
function caretAt(host, x, y) {
  let pos = null;
  try {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) pos = { node: p.offsetNode, offset: p.offset }; }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) pos = { node: r.startContainer, offset: r.startOffset }; }
  } catch { pos = null; }
  if (pos && host.contains(pos.node)) return pos;
  const text = host.firstChild;
  if (!text || text.nodeType !== 3) return null;
  const range = document.createRange();
  let best = { node: text, offset: text.length }, bestDist = Infinity;
  for (let i = 0; i <= text.length; i++) {
    range.setStart(text, i); range.setEnd(text, Math.min(i + 1, text.length));
    const rects = range.getClientRects(); const rect = rects[0] || (i > 0 ? (range.setStart(text, i - 1), range.setEnd(text, i), range.getClientRects()[0]) : null);
    if (!rect) continue;
    const edge = i < text.length && rects[0] ? rect.left : rect.right, midY = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(midY - y) * 1000 + Math.abs(edge - x);
    if (dist < bestDist) { bestDist = dist; best = { node: text, offset: i }; }
  }
  return best;
}

function insertPlain(text) {
  if (!document.execCommand('insertText', false, text)) {
    const sel = getSelection(); if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node);
    range.setStartAfter(node); range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
  }
}

// 词的范围：按浏览器的分词（中文、日文按词典分词）；点在空白上就选这段空白
export function wordRange(text, offset) {
  if (!text) return [0, 0];
  const at = Math.min(Math.max(0, offset), text.length);
  try {
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)];
    // 点在词尾（光标落在词和后面空白之间）时优先选前面的词
    let hit = segments.find(s => at >= s.index && at < s.index + s.segment.length) || segments.at(-1);
    const before = segments.find(s => s.index + s.segment.length === at);
    if (before?.isWordLike && !hit.isWordLike) hit = before;
    if (hit.segment === '\n' && before) hit = before;
    return [hit.index, hit.index + hit.segment.length];
  } catch {
    let start = at, end = at;
    while (start > 0 && /\S/.test(text[start - 1])) start--;
    while (end < text.length && /\S/.test(text[end])) end++;
    return [start, end];
  }
}
// 段的范围：两个换行之间（不含换行本身）
export function paragraphRange(text, offset) {
  const at = Math.min(Math.max(0, offset), text.length);
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const next = text.indexOf('\n', at);
  return [start, next < 0 ? text.length : next];
}

export function startTextEdit(node, { text = '', point = null, selectAll = false, selectWord = false, onInput, onCommit } = {}) {
  sessions.get(node)?.finish();
  const host = node.querySelector(':scope > [data-vw-flip]') || node;
  const initial = String(text ?? '');
  const plaintext = supportsPlaintext();
  // 暂时摘下非文字子元素（缩放把手等），结束时按原顺序放回
  const parked = [...host.childNodes].filter(c => c.nodeType === 1);
  parked.forEach(c => c.remove());
  host.replaceChildren(document.createTextNode(initial));
  const saved = { cursor: node.style.cursor, userSelect: node.style.userSelect, webkitUserSelect: node.style.webkitUserSelect, caretColor: host.style.caretColor, outline: host.style.outline };
  node.style.cursor = 'text'; node.style.userSelect = 'text'; node.style.webkitUserSelect = 'text';
  host.style.caretColor = getComputedStyle(host).color;
  if (!host.style.outline) host.style.outline = 'none';
  host.setAttribute('contenteditable', plaintext ? 'plaintext-only' : 'true');
  host.spellcheck = false;

  let finished = false, composing = false, last = initial;
  const controller = new AbortController(), signal = controller.signal;
  const current = () => finished ? last : readText(host);
  const emit = () => { if (finished || composing) return; const value = readText(host); if (value === last) return; last = value; try { onInput?.(value); } catch (error) { console.error(error); } };

  host.addEventListener('compositionstart', () => { composing = true; }, { signal });
  host.addEventListener('compositionend', () => { composing = false; queueMicrotask(emit); }, { signal });
  host.addEventListener('input', e => { e.stopPropagation(); if (e.isComposing || composing) return; emit(); }, { signal });
  host.addEventListener('beforeinput', e => {
    e.stopPropagation();
    // 退回 contenteditable="true" 时：Enter 只插入 "\n"，不生成 <div>
    if (!plaintext && !e.isComposing && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) { e.preventDefault(); insertPlain('\n'); }
  }, { signal });
  host.addEventListener('change', e => e.stopPropagation(), { signal });
  host.addEventListener('keydown', e => {
    e.stopPropagation(); // 方向键、Delete、Cmd+A/C/V/D/Z 作用于文字，不触发画布快捷键
    if (e.isComposing || composing || e.keyCode === 229) return; // 输入法选字中的 Esc/Enter 交给输入法
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
  }, { signal });
  host.addEventListener('keyup', e => e.stopPropagation(), { signal });
  if (!plaintext) host.addEventListener('paste', e => { e.preventDefault(); e.stopPropagation(); insertPlain(e.clipboardData?.getData('text/plain') || ''); }, { signal });
  else host.addEventListener('paste', e => e.stopPropagation(), { signal });
  // 点击元素外结束（不拦这次点击，让它照常生效）
  document.addEventListener('pointerdown', e => { if (!node.contains(e.target)) finish(); }, { capture: true, signal });
  // 窗口失焦不结束；焦点移到别的输入框（或其他地方）时结束
  host.addEventListener('blur', () => setTimeout(() => {
    if (finished || !document.hasFocus()) return;
    const active = document.activeElement;
    if (!active || active === document.body || !node.contains(active)) finish();
  }), { signal });

  function finish() {
    if (finished) return;
    const value = readText(host);
    finished = true; last = value; controller.abort(); sessions.delete(node);
    const extra = [...host.childNodes].filter(c => c.nodeType === 1 && c.hasAttribute('data-resize') && !parked.includes(c));
    const hadFocus = host.contains(document.activeElement);
    const sel = getSelection(); if (sel?.rangeCount && host.contains(sel.anchorNode)) sel.removeAllRanges();
    host.removeAttribute('contenteditable'); host.removeAttribute('spellcheck');
    host.replaceChildren(document.createTextNode(value), ...parked, ...extra);
    node.style.cursor = saved.cursor; node.style.userSelect = saved.userSelect; node.style.webkitUserSelect = saved.webkitUserSelect;
    host.style.caretColor = saved.caretColor; host.style.outline = saved.outline;
    if (hadFocus && document.activeElement === host) host.blur();
    try { onCommit?.({ text: value, changed: value !== initial }); } catch (error) { console.error(error); }
  }

  // 选中点到位置所在的词（unit="word"）或整段（unit="paragraph"，以换行分段）
  function selectAround(x, y, unit) {
    if (finished) return;
    const at = caretAt(host, x, y), text = host.firstChild;
    if (!at || !text || text.nodeType !== 3 || at.node !== text) return;
    const [start, end] = unit === 'paragraph' ? paragraphRange(text.data, at.offset) : wordRange(text.data, at.offset);
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
  }
  // 三击：选中整段（浏览器自己的三击在不同浏览器里范围不一，这里统一成换行之间的一段）
  host.addEventListener('click', e => { if (e.detail >= 3) { e.preventDefault(); selectAround(e.clientX, e.clientY, 'paragraph'); } }, { signal });

  host.focus({ preventScroll: true });
  const sel = getSelection(), range = document.createRange();
  if (selectAll) range.selectNodeContents(host);
  else {
    const at = point ? caretAt(host, point.clientX, point.clientY) : null;
    if (at) range.setStart(at.node, at.offset); else range.setStart(host.firstChild, initial.length);
    range.collapse(true);
  }
  sel.removeAllRanges(); sel.addRange(range);
  if (point && selectWord) selectAround(point.clientX, point.clientY, 'word');

  const session = { finish, get active() { return !finished; }, get text() { return current(); }, host,
    selectWordAt: (x, y) => selectAround(x, y, 'word'), selectParagraphAt: (x, y) => selectAround(x, y, 'paragraph') };
  sessions.set(node, session);
  return session;
}
