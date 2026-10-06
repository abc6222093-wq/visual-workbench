// 草稿页编辑（第 13 轮，docs/round13-contract.md §5）：当前页是草稿页时，在画布上盖一层和页面同尺寸、同缩放、
// 同样式（draftCss）的 contenteditable 表单。每块一个 <p data-vw-level>。用户的改动算成新的 blocks，
// 600ms 不动后发 op 'draft-update'，服务端重写草稿页文件。分页（Ctrl/Cmd + Enter）发 'draft-split'，
// 和下一页合并发 'draft-merge'。撤销 / 重做：每页一份块历史，撤销就发 draft-update 回到上一份；
// 分页、合并另记一份操作栈（ops），这一页的文字撤销到头（分页 / 合并之后的起点）再撤就撤回那次分页 / 合并。
import { DRAFT_LEVELS, draftCss, blocksFromDraftHtml, normalizeBlocks, isDraftLevel } from './draft-model.js';

const SAVE_DELAY = 600;
const RESET_AFTER = new Set(['header', 'footer', 'title']); // 这些层级后面回车出来的新段落是正文
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const levelLabel = id => DRAFT_LEVELS.find(l => l.id === id)?.label || '正文';

/** 段落文字：文本原样，<br> 当换行；末尾那个占位的 <br> 不算。 */
function textOf(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeName === 'BR') return '\n';
  let s = '';
  for (const c of node.childNodes) s += textOf(c);
  return s;
}
function lastLeaf(node) { while (node.lastChild) node = node.lastChild; return node; }
function blockText(p) {
  const s = textOf(p);
  return lastLeaf(p)?.nodeName === 'BR' && s.endsWith('\n') ? s.slice(0, -1) : s;
}
function renderBlock(doc, block) {
  const p = doc.createElement('p');
  p.dataset.vwLevel = isDraftLevel(block.level) ? block.level : 'body';
  const lines = String(block.text ?? '').split('\n');
  lines.forEach((line, i) => { if (i) p.append(doc.createElement('br')); if (line) p.append(doc.createTextNode(line)); });
  if (!block.text || block.text.endsWith('\n')) p.append(doc.createElement('br')); // 占位：空段落 / 末尾换行要有高度
  return p;
}
// 结构被浏览器改乱了（跨段删除后多出 span / 带样式的节点 / 不是段落的子节点）
function messy(main) {
  for (const child of main.childNodes) {
    if (child.nodeType === 3) { if (child.data.trim()) return true; continue; }
    if (child.nodeName !== 'P' || !child.dataset.vwLevel) return true;
    if (child.querySelector('*:not(br)')) return true;
  }
  return !main.querySelector('p');
}

export function createDraftEditor(deps) {
  const { getProject, getPageId, holder, viewOf, fetchText, pagesOp, request, notice = () => {}, onState = () => {}, selectPage = () => {}, status = () => {}, touch = () => {} } = deps;
  const histories = new Map(); // pageId → { stack: [{ blocks, caret }], index }
  const pending = new Set(); // 正在发的保存
  const ops = { undo: [], redo: [], busy: false }; // 分页 / 合并：{ kind, pageId, … , hist: 操作前相关页的块历史 }
  const cloneHist = h => (h ? { stack: h.stack.slice(), index: h.index } : null);
  const freshHist = blocks => ({ stack: [{ blocks, caret: null }], index: 0 });
  let cur = null; // { pageId, file, layer, main, timer, lastSaved, loading, token, caret, saving, again }
  let loadToken = 0;
  let focusOnLoad = null;

  const project = () => getProject();
  const pageOf = id => project()?.pages.find(p => p.id === id);
  const active = () => !!cur && !!pageOf(cur.pageId)?.draft;

  // ---------- 块 ↔ DOM ----------
  function readBlocks(main = cur?.main) {
    if (!main) return [];
    const blocks = [];
    for (const child of main.childNodes) {
      if (child.nodeType === 3) { if (child.data.trim()) blocks.push({ level: 'body', text: child.data }); continue; }
      if (child.nodeType !== 1) continue;
      const level = isDraftLevel(child.dataset?.vwLevel) ? child.dataset.vwLevel : 'body';
      blocks.push({ level, text: child.nodeName === 'P' ? blockText(child) : textOf(child).replace(/\n$/, '') });
    }
    return blocks.length ? blocks : [{ level: 'body', text: '' }];
  }
  function render(blocks) {
    const main = cur.main, doc = main.ownerDocument;
    main.replaceChildren(...(blocks.length ? blocks : [{ level: 'body', text: '' }]).map(b => renderBlock(doc, b)));
  }
  const paragraphs = () => [...(cur?.main?.children || [])];
  // 光标位置 ↔ { b: 第几段, o: 段内第几个字 }
  function posOf(node, offset) {
    const main = cur.main;
    if (node === main) {
      const kids = paragraphs();
      if (offset >= kids.length) { const b = kids.length - 1; return { b: Math.max(0, b), o: kids[b] ? blockText(kids[b]).length : 0 }; }
      return { b: offset, o: 0 };
    }
    let p = node.nodeType === 1 ? node : node.parentNode;
    while (p && p.parentNode !== main) p = p.parentNode;
    if (!p) return null;
    const range = main.ownerDocument.createRange();
    range.setStart(p, 0);
    try { range.setEnd(node, offset); } catch { return null; }
    const box = main.ownerDocument.createElement('div');
    box.append(range.cloneContents());
    return { b: paragraphs().indexOf(p), o: Math.min(textOf(box).length, blockText(p).length) };
  }
  function selectionPos() {
    const sel = cur?.main?.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount || !cur.main.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0), s = posOf(r.startContainer, r.startOffset), e = posOf(r.endContainer, r.endOffset);
    if (!s || !e) return null;
    return { s, e, collapsed: r.collapsed };
  }
  function pointAt(b, o) {
    const p = paragraphs()[b];
    if (!p) return null;
    let left = o;
    const walk = node => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { if (left <= c.data.length) return [c, left]; left -= c.data.length; }
        else if (c.nodeName === 'BR') { if (left === 0) return [node, [...node.childNodes].indexOf(c)]; left -= 1; }
        else { const hit = walk(c); if (hit) return hit; }
      }
      return null;
    };
    const hit = walk(p);
    if (hit) return hit;
    const last = p.lastChild?.nodeName === 'BR' ? p.childNodes.length - 1 : p.childNodes.length;
    return [p, Math.max(0, last)];
  }
  function place(s, e = s) {
    const doc = cur.main.ownerDocument, a = pointAt(s.b, s.o), z = pointAt(e.b, e.o);
    if (!a || !z) return;
    const range = doc.createRange();
    range.setStart(a[0], a[1]);
    range.setEnd(z[0], z[1]);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- 块的纯操作 ----------
  function deleteRange(blocks, s, e) {
    if (s.b === e.b && s.o === e.o) return blocks;
    const out = blocks.slice(0, s.b);
    out.push({ level: blocks[s.b].level, text: blocks[s.b].text.slice(0, s.o) + blocks[e.b].text.slice(e.o) });
    return out.concat(blocks.slice(e.b + 1));
  }
  function insertLines(blocks, at, lines) {
    const out = blocks.map(b => ({ ...b })), block = out[at.b], before = block.text.slice(0, at.o), after = block.text.slice(at.o);
    if (lines.length === 1) { block.text = before + lines[0] + after; return { blocks: out, caret: { b: at.b, o: at.o + lines[0].length } }; }
    block.text = before + lines[0];
    const level = RESET_AFTER.has(block.level) ? 'body' : block.level;
    const added = lines.slice(1).map(text => ({ level, text }));
    const last = added.at(-1), caret = { b: at.b + added.length, o: last.text.length };
    last.text += after;
    out.splice(at.b + 1, 0, ...added);
    return { blocks: out, caret };
  }
  // 用块模型做一次修改：读当前块和选区 → fn → 重画 → 放回光标 → 记一次改动
  function apply(fn) {
    const sel = selectionPos() || cur.caret;
    if (!sel) return false;
    const result = fn(readBlocks(), sel);
    if (!result) return false;
    render(result.blocks);
    place(result.caret, result.end || result.caret);
    edited();
    return true;
  }

  // ---------- 改动、保存、历史 ----------
  function history(pageId) {
    if (!histories.has(pageId)) histories.set(pageId, { stack: [], index: -1 });
    return histories.get(pageId);
  }
  function remember(blocks, caret = null) {
    const h = history(cur.pageId);
    if (h.index >= 0 && same(h.stack[h.index].blocks, blocks)) return;
    if (h.index >= 0) ops.redo.length = 0; // 新的文字改动：分页 / 合并的重做作废（第一次读进来不算）
    h.stack.splice(h.index + 1);
    h.stack.push({ blocks, caret });
    if (h.stack.length > 100) h.stack.shift();
    h.index = h.stack.length - 1;
  }
  function edited() {
    if (!cur) return;
    measure();
    status('busy');
    clearTimeout(cur.timer);
    const mine = cur;
    mine.timer = setTimeout(() => { if (cur === mine) { remember(readBlocks(), selectionPos()?.s || null); onState(); } save(mine); }, SAVE_DELAY);
    onState();
  }
  function save(state = cur, blocks = null) {
    if (!state) return Promise.resolve();
    clearTimeout(state.timer);
    state.timer = null;
    if (state.saving) { state.again = true; return state.saving; }
    const next = blocks || (state === cur ? readBlocks() : state.blocks);
    if (!next || same(next, state.lastSaved)) { status('ok'); return Promise.resolve(); }
    const run = (async () => {
      try {
        await request('draft-update', { pageId: state.pageId, blocks: normalizeBlocks(next) });
        state.lastSaved = next;
        const stamp = touch(state.file);
        if (stamp != null) state.stamp = stamp;
      } catch (error) {
        notice(error.message);
      } finally {
        state.saving = null;
        pending.delete(run);
      }
      if (state.again) { state.again = false; await save(state); }
    })();
    state.saving = run;
    pending.add(run);
    return run;
  }
  async function flush() {
    if (cur?.timer) { remember(readBlocks(), selectionPos()?.s || null); await save(cur); }
    while (pending.size) await Promise.all([...pending]);
  }
  function measure() {
    if (!cur?.main) return;
    const view = viewOf(pageOf(cur.pageId));
    const over = Math.max(0, Math.round(cur.main.scrollHeight - (view?.height || 0)));
    if (cur.overflow !== over) { cur.overflow = over; onState(); }
  }
  function step(dir) {
    if (!active()) return false;
    if (cur.timer) { clearTimeout(cur.timer); cur.timer = null; remember(readBlocks(), selectionPos()?.s || null); }
    const h = history(cur.pageId), to = h.index + dir;
    if (to < 0 || to >= h.stack.length) { if ((dir < 0 ? ops.undo : ops.redo).length && !ops.busy) structural(dir).catch(err => notice(err.message)); return true; }
    h.index = to;
    const snap = h.stack[to];
    render(snap.blocks);
    cur.main.focus({ preventScroll: true });
    const caret = snap.caret && snap.caret.b < snap.blocks.length ? snap.caret : { b: snap.blocks.length - 1, o: snap.blocks.at(-1)?.text.length || 0 };
    place(caret);
    measure();
    status('busy');
    save(cur, snap.blocks);
    onState();
    return true;
  }

  // ---------- 键盘、输入、粘贴 ----------
  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    if (mod && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); split().catch(err => notice(err.message)); return; }
    if (mod && (key === 'z' || key === 'y')) { e.preventDefault(); e.stopPropagation(); step(key === 'y' || e.shiftKey ? 1 : -1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) apply((blocks, { s, e: end }) => { const b = deleteRange(blocks, s, end); b[s.b] = { ...b[s.b], text: b[s.b].text.slice(0, s.o) + '\n' + b[s.b].text.slice(s.o) }; return { blocks: b, caret: { b: s.b, o: s.o + 1 } }; });
      else apply((blocks, { s, e: end }) => insertLines(deleteRange(blocks, s, end), s, ['', '']));
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const sel = selectionPos();
      if (!sel) return;
      const blocks = readBlocks();
      if (!sel.collapsed && sel.s.b !== sel.e.b) { e.preventDefault(); apply((b, { s, e: end }) => ({ blocks: deleteRange(b, s, end), caret: s })); return; }
      if (!sel.collapsed) return;
      const { b, o } = sel.s;
      if (e.key === 'Backspace' && o === 0 && b > 0) { e.preventDefault(); apply(bl => ({ blocks: deleteRange(bl, { b: b - 1, o: bl[b - 1].text.length }, { b, o: 0 }), caret: { b: b - 1, o: bl[b - 1].text.length } })); return; }
      if (e.key === 'Delete' && o === blocks[b].text.length && b < blocks.length - 1) { e.preventDefault(); apply(bl => ({ blocks: deleteRange(bl, { b, o }, { b: b + 1, o: 0 }), caret: { b, o } })); return; }
    }
  }
  function onBeforeInput(e) {
    // 跨段选中后直接打字：用块模型删掉选中的再插入
    if (e.inputType !== 'insertText' || !e.data) return;
    const sel = selectionPos();
    if (!sel || sel.collapsed || sel.s.b === sel.e.b) return;
    e.preventDefault();
    apply((blocks, { s, e: end }) => insertLines(deleteRange(blocks, s, end), s, [e.data]));
  }
  function onInput() {
    if (!cur || cur.composing) return;
    if (messy(cur.main)) {
      const caret = selectionPos()?.s;
      const blocks = readBlocks();
      render(blocks);
      if (caret) place({ b: Math.min(caret.b, blocks.length - 1), o: caret.o });
    }
    edited();
  }
  function onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    apply((blocks, { s, e: end }) => insertLines(deleteRange(blocks, s, end), s, lines));
  }
  function onSelection() {
    if (!cur?.main) return;
    const sel = selectionPos();
    if (!sel) return;
    cur.caret = sel;
    const level = readBlocks()[sel.s.b]?.level;
    if (level !== cur.level) { cur.level = level; onState(); }
  }

  // ---------- 层级、分页、合并 ----------
  function setLevel(level) {
    if (!active() || !isDraftLevel(level)) return;
    const sel = selectionPos() || cur.caret || { s: { b: 0, o: 0 }, e: { b: 0, o: 0 } };
    const blocks = readBlocks().map((b, i) => (i >= sel.s.b && i <= sel.e.b ? { ...b, level } : b));
    render(blocks);
    cur.main.focus({ preventScroll: true });
    place(sel.s, sel.e);
    cur.level = level;
    edited();
  }
  async function split() {
    if (!active()) return;
    const state = cur, sel = selectionPos() || cur.caret;
    const blocks = readBlocks();
    const at = sel ? sel.s : { b: blocks.length - 1, o: blocks.at(-1).text.length };
    let before, after;
    const block = blocks[at.b];
    if (at.o === 0 && at.b > 0) { before = blocks.slice(0, at.b); after = blocks.slice(at.b); }
    else if (at.o >= block.text.length) { before = blocks.slice(0, at.b + 1); after = blocks.slice(at.b + 1); }
    else { before = [...blocks.slice(0, at.b), { level: block.level, text: block.text.slice(0, at.o) }]; after = [{ level: block.level, text: block.text.slice(at.o) }, ...blocks.slice(at.b + 1)]; }
    if (!after.length) after = [{ level: 'body', text: '' }];
    if (!before.length) before = [{ level: 'body', text: '' }];
    clearTimeout(state.timer); state.timer = null;
    while (pending.size) await Promise.all([...pending]);
    if (cur === state) remember(blocks);
    const hist = cloneHist(histories.get(state.pageId));
    const out = await pagesOp('draft-split', { pageId: state.pageId, blocksBefore: normalizeBlocks(before), blocksAfter: normalizeBlocks(after) });
    if (!out) return;
    state.lastSaved = before;
    const next = out.added?.[0] || (out.pageIds || [])[0];
    if (next) record({ kind: 'split', pageId: state.pageId, newId: next, blocks: normalizeBlocks(blocks), before: normalizeBlocks(before), after: normalizeBlocks(after), hist: { [state.pageId]: hist } });
    histories.set(state.pageId, freshHist(before));
    touch(state.file);
    if (next) { focusOnLoad = { b: 0, o: 0 }; selectPage(next); }
    else reload();
  }
  async function mergeNext() {
    if (!active()) return;
    const state = cur;
    await flush();
    const pages = project().pages, i = pages.findIndex(p => p.id === state.pageId), nx = pages[i + 1];
    // 记下合并前两页的样子（撤销时按原编号、名称、备注拆回去）
    let a = null, b = null;
    try { a = normalizeBlocks(blocksFromDraftHtml(await fetchText(pages[i]))); b = normalizeBlocks(blocksFromDraftHtml(await fetchText(nx))); } catch {}
    if (cur === state) a = normalizeBlocks(readBlocks());
    const hist = { [state.pageId]: cloneHist(histories.get(state.pageId)), [nx?.id]: cloneHist(histories.get(nx?.id)) };
    const out = await pagesOp('draft-merge', { pageId: state.pageId });
    if (!out) return;
    if (a && b && nx) {
      const merged = [...a, ...b];
      record({ kind: 'merge', pageId: state.pageId, nextId: nx.id, nextName: nx.name, nextNotes: nx.notes ?? null, pageNotes: pages[i].notes ?? null, a, b, merged, hist });
      histories.set(state.pageId, freshHist(merged));
    } else histories.delete(state.pageId);
    histories.delete(nx?.id);
    touch(state.file);
    if (cur === state) focusOnLoad = cur.caret?.s || null;
    deps.refresh?.(); // 页面栏少了一页；时间戳变了，sync 会重新读这一页
  }
  function record(op) { ops.undo.push(op); if (ops.undo.length > 50) ops.undo.shift(); ops.redo.length = 0; }
  // 撤销 / 重做一次分页或合并：服务端照原样拆回 / 并回，块历史换回操作前 / 后的那份，跳到相关的页
  async function structural(dir) {
    const from = dir < 0 ? ops.undo : ops.redo, to = dir < 0 ? ops.redo : ops.undo, op = from.at(-1);
    if (!op || ops.busy) return;
    ops.busy = true;
    onState();
    try {
      await flush();
      const pages = project()?.pages || [], i = pages.findIndex(p => p.id === op.pageId);
      const otherId = op.kind === 'split' ? op.newId : op.nextId;
      const hasPair = i >= 0 && pages[i].draft && pages[i + 1]?.id === otherId && pages[i + 1]?.draft;
      const merging = (op.kind === 'split') === (dir < 0); // 撤销分页 / 重做合并 = 并起来
      if (merging ? !hasPair : (i < 0 || !pages[i].draft || pages.some(p => p.id === otherId))) { from.pop(); notice('页面已经变了，这一步撤不回来了'); return; }
      const now = { [op.pageId]: cloneHist(histories.get(op.pageId)), [otherId]: cloneHist(histories.get(otherId)) };
      const out = merging
        ? await pagesOp('draft-merge', { pageId: op.pageId, blocks: op.kind === 'split' ? op.blocks : op.merged })
        : await pagesOp('draft-split', op.kind === 'split'
          ? { pageId: op.pageId, blocksBefore: op.before, blocksAfter: op.after, nextId: op.newId }
          : { pageId: op.pageId, blocksBefore: op.a, blocksAfter: op.b, nextId: op.nextId, nextName: op.nextName, nextNotes: op.nextNotes ?? '', pageNotes: op.pageNotes });
      if (!out) return;
      from.pop();
      if (op.kind === 'split' && !merging) op.newId = out.added?.[0] || out.pageIds?.[0] || op.newId;
      if (op.kind === 'merge' && !merging) op.nextId = out.added?.[0] || out.pageIds?.[0] || op.nextId;
      for (const [id, h] of Object.entries(op.hist)) { if (h) histories.set(id, h); else histories.delete(id); }
      op.hist = now;
      to.push(op);
      const target = op.kind === 'split' && !merging ? op.newId : op.pageId; // 重做分页跳到新页，其余回到原页
      const file = pageOf(op.pageId)?.file;
      if (file) touch(file);
      if (cur && cur.pageId === target) { focusOnLoad = cur.caret?.s || null; reload(); }
      else { focusOnLoad = { b: 0, o: 0 }; selectPage(target); }
      deps.refresh?.();
    } finally { ops.busy = false; onState(); }
  }
  function canMerge() {
    const pages = project()?.pages || [], i = pages.findIndex(p => p.id === cur?.pageId);
    return i >= 0 && !!pages[i + 1]?.draft;
  }

  // ---------- 挂层、跟着当前页 ----------
  function mount(p) {
    const host = holder();
    if (!host) return;
    const layer = host.ownerDocument.createElement('div');
    layer.className = 'vw-layer vw-draft-layer';
    layer.dataset.pageId = p.id;
    const style = host.ownerDocument.createElement('style');
    // 草稿样式里给 html,body 的那条不进工作台页面（底色、字色由这一层自己给）
    style.textContent = draftCss(project().artboard).split('\n').filter(line => !/^html\s*,\s*body/.test(line)).join('\n');
    const main = host.ownerDocument.createElement('main');
    main.setAttribute('data-vw-draft', '');
    main.setAttribute('contenteditable', 'true');
    main.setAttribute('spellcheck', 'false');
    main.setAttribute('role', 'textbox');
    main.setAttribute('aria-multiline', 'true');
    main.setAttribute('aria-label', '草稿文字');
    layer.append(style, main);
    host.append(layer);
    const ctl = new AbortController(), o = { signal: ctl.signal };
    main.addEventListener('keydown', onKeyDown, o);
    main.addEventListener('beforeinput', onBeforeInput, o);
    main.addEventListener('input', onInput, o);
    main.addEventListener('paste', onPaste, o);
    main.addEventListener('compositionstart', () => { if (cur) cur.composing = true; }, o);
    main.addEventListener('compositionend', () => { if (cur) { cur.composing = false; onInput(); } }, o);
    host.ownerDocument.addEventListener('selectionchange', onSelection, o);
    cur = { pageId: p.id, file: p.file, layer, main, style, ctl, timer: null, lastSaved: null, saving: null, again: false, caret: null, level: null, overflow: null, stamp: deps.stampOf?.(p.file) ?? '' };
    reload();
  }
  async function reload() {
    if (!cur) return;
    const state = cur, token = ++loadToken, p = pageOf(state.pageId);
    state.layer.dataset.loading = '1';
    let blocks = [];
    try { blocks = blocksFromDraftHtml(await fetchText(p)); } catch (error) { notice(`读不出这一页的草稿：${error.message}`); }
    if (cur !== state || token !== loadToken) return;
    if (!blocks.length) blocks = [{ level: 'body', text: '' }];
    render(blocks);
    state.lastSaved = blocks;
    state.stamp = deps.stampOf?.(state.file) ?? '';
    remember(blocks);
    delete state.layer.dataset.loading;
    state.layer.dataset.ready = '1';
    measure();
    onState();
    if (focusOnLoad) { const at = focusOnLoad; focusOnLoad = null; state.main.focus({ preventScroll: true }); place({ b: Math.min(at.b, blocks.length - 1), o: Math.min(at.o, blocks[Math.min(at.b, blocks.length - 1)].text.length) }); }
  }
  /** 跟着当前页：草稿页挂上表单层，别的页拿掉。agent 改了草稿页文件（时间戳变了、自己没有没保存的改动）就重新读。 */
  function sync() {
    const id = getPageId(), p = pageOf(id), host = holder();
    if (cur && (!p || !p.draft || cur.pageId !== id || !cur.layer.isConnected || cur.layer.parentNode !== host)) {
      unmountKeep();
    }
    if (!p?.draft || !host) { onState(); return; }
    if (!cur) { mount(p); onState(); return; }
    cur.file = p.file;
    const stamp = deps.stampOf?.(p.file) ?? '';
    if (stamp !== cur.stamp && !cur.timer && !cur.saving) { cur.stamp = stamp; reload(); }
    else cur.stamp = stamp;
    if (cur.style) {
      const css = draftCss(project().artboard).split('\n').filter(line => !/^html\s*,\s*body/.test(line)).join('\n');
      if (cur.style.textContent !== css) cur.style.textContent = css;
    }
  }
  function unmountKeep() {
    const state = cur;
    if (!state) return;
    if (state.timer) {
      state.blocks = readBlocks(state.main);
      const h = history(state.pageId);
      if (!(h.index >= 0 && same(h.stack[h.index].blocks, state.blocks))) { h.stack.splice(h.index + 1); h.stack.push({ blocks: state.blocks, caret: null }); h.index = h.stack.length - 1; }
    }
    cur = null;
    if (state.timer) save(state);
    state.ctl.abort();
    state.layer.remove();
  }
  function toolbarHTML(esc) {
    if (!active()) return '';
    const level = cur.level || readBlocks()[0]?.level || 'body';
    return `<div class="qt-inner qt-draft" data-mark="draft:${esc(cur.pageId)}"><label class="g-field qt-field qt-select" title="段落层级（对光标所在段或选中的几段生效）"><span>层级</span><select data-draft-level aria-label="层级">${DRAFT_LEVELS.map(l => `<option value="${l.id}" ${l.id === level ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label><button class="ed-tbtn qt-btn" data-action="draft-split" title="从光标处分成两页（Ctrl/Cmd + Enter）"><span>分页</span></button><button class="ed-tbtn qt-btn" data-action="draft-merge" title="把下一页接到这一页后面" ${canMerge() ? '' : 'disabled'}><span>和下一页合并</span></button></div>`;
  }
  return {
    sync, flush, setLevel, split, mergeNext, canMerge, toolbarHTML,
    undo: () => step(-1), redo: () => step(1),
    get active() { return active(); },
    get pageId() { return cur?.pageId || null; },
    get level() { return cur?.level || null; },
    get overflow() { return active() ? cur.overflow ?? 0 : null; },
    get canUndo() { if (!active()) return false; const h = history(cur.pageId); return h.index > 0 || !!cur.timer || (!ops.busy && ops.undo.length > 0); },
    get canRedo() { if (!active()) return false; const h = history(cur.pageId); return h.index < h.stack.length - 1 || (!ops.busy && ops.redo.length > 0); },
    get main() { return cur?.main || null; },
    levelLabel,
    destroy() { unmountKeep(); },
    reset() { unmountKeep(); histories.clear(); ops.undo.length = 0; ops.redo.length = 0; },
  };
}
