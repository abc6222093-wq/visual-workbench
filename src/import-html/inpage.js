// 旧 HTML / 网页导入（第 12 轮）：注入后台浏览器页面里运行的代码。install 整体 toString 后注入，不能引用外部变量。
// window.__vwImport 提供：
//   detect()                     识别分页方式（课件框架 / 页面容器 / 按屏滚动 / 保底）
//   pages(kind)                  每页的 { path（从 body 数的子元素下标）, width, height }
//   clues(path)                  原页面的动画、脚本库、分步线索（只记录，写进迁移说明）
//   prepare(o) / finish(o)       生成一页的 HTML：取原文档（未执行脚本的原文，或网址抓取时的当前 DOM），
//                                标出可改的文字 / 图片 / 纯色色块（data-vw-id、data-vw、data-vw-origin），只留这一页的那一块；
//                                文字标 text move resize color：用户会把 agent 在别处做好的 HTML 设计（多为绝对定位）导进来，要能挪文字；
//                                资源引用先换成绝对地址交给 Node 复制，再按 Node 给的对照表改写，最后序列化。
// 标记全部用 DOM 操作完成，不用正则改 HTML。
export function install() {
  if (window.__vwImport) return;
  const cs = el => getComputedStyle(el);

  // ---------- 分页识别 ----------
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'BR', 'WBR', 'SOURCE', 'TRACK', 'PARAM']);
  const visibleBlock = el => { if (SKIP.has(el.tagName)) return false; const s = cs(el), r = el.getBoundingClientRect(); return s.display !== 'none' && r.width > 1 && r.height > 1; };
  function slideList(kind) {
    if (kind === 'reveal') { const out = []; for (const s of document.querySelectorAll('.reveal .slides > section')) { const kids = [...s.children].filter(c => c.tagName === 'SECTION'); out.push(...(kids.length ? kids : [s])); } return out; }
    if (kind === 'impress') return [...document.querySelectorAll('#impress .step, .impress .step')].length ? [...document.querySelectorAll('#impress .step, .impress .step')] : [...document.querySelectorAll('.step')];
    if (kind === 'swiper') return [...document.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)')];
    if (kind === 'generic') return genericSlides() || [];
    if (kind === 'scroll') return scrollBlocks() || [];
    return [];
  }
  function genericSlides() {
    const W = innerWidth, H = innerHeight, ratio = W / H, groups = new Map();
    const levels = [...document.body.children, ...[...document.body.children].flatMap(c => [...c.children])];
    for (const el of levels) if (el.matches('section, .slide, .page, [data-page]') && !SKIP.has(el.tagName)) { const g = groups.get(el.parentElement) || []; g.push(el); groups.set(el.parentElement, g); }
    let best = null; for (const g of groups.values()) if (g.length >= 2 && (!best || g.length > best.length)) best = g;
    if (!best) return null;
    const ok = best.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && Math.abs(r.width / r.height - ratio) / ratio < 0.2; });
    return ok.length >= 2 && ok.length >= best.length * 0.8 ? best : null;
  }
  function scrollBlocks() {
    const H = innerHeight; let parent = document.body, kids = [...parent.children].filter(visibleBlock);
    if (kids.length === 1 && [...kids[0].children].filter(visibleBlock).length >= 2) { parent = kids[0]; kids = [...parent.children].filter(visibleBlock); }
    const screens = kids.filter(el => Math.abs(el.getBoundingClientRect().height - H) <= H * 0.12);
    return screens.length >= 2 && screens.length >= kids.length * 0.6 ? kids : null;
  }
  const LABELS = { reveal: 'reveal.js 幻灯片（.reveal .slides > section，嵌套 section 展开成顺序页）', impress: 'impress.js 幻灯片（.step）', swiper: 'Swiper 轮播（.swiper-slide）', generic: '页面容器（section / .slide / .page / [data-page]）', scroll: '按屏滚动（每个顶层块约一屏高）' };
  function detect() {
    for (const kind of ['reveal', 'impress', 'swiper']) { const list = slideList(kind); if (list.length >= (kind === 'reveal' ? 1 : 2)) return { kind, count: list.length, label: LABELS[kind] }; }
    const g = genericSlides(); if (g) return { kind: 'generic', count: g.length, label: LABELS.generic };
    const s = scrollBlocks(); if (s) return { kind: 'scroll', count: s.length, label: LABELS.scroll };
    const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    return { kind: 'fallback', count: Math.max(1, Math.min(200, Math.ceil((docH - 2) / innerHeight))), label: '保底：按画板高度切分整页' };
  }
  const pathOf = el => { const out = []; for (let e = el; e && e !== document.body; e = e.parentElement) out.unshift([...e.parentElement.children].indexOf(e)); return out; };
  const byPath = (body, path) => { let e = body; for (const i of path || []) { e = e?.children[i]; if (!e) return null; } return e; };
  function pages(kind) {
    return slideList(kind).map(el => {
      // 隐藏着的幻灯片（框架只显示当前页）：量尺寸前临时显示
      const old = el.getAttribute('style');
      if (cs(el).display === 'none') el.style.setProperty('display', 'block', 'important');
      const r = el.getBoundingClientRect(), out = { path: pathOf(el), width: Math.round(r.width), height: Math.round(r.height) };
      if (old === null) el.removeAttribute('style'); else el.setAttribute('style', old);
      return out;
    });
  }

  // ---------- 动画与库的线索（只记录） ----------
  const LIBS = ['gsap', 'TweenMax', 'TweenLite', 'anime', 'Reveal', 'impress', 'Swiper', 'AOS', 'ScrollMagic', 'ScrollReveal', 'lottie', 'bodymovin', 'THREE', 'PIXI', 'Motion', 'Velocity', 'p5', 'Typed', 'Splitting', 'Lenis', 'barba', 'fullpage', 'Konva', 'echarts', 'Chart', 'd3', 'Matter', 'mojs'];
  function clues(path) {
    const root = (path && byPath(document.body, path)) || document.body;
    const running = new Map();
    for (const a of document.getAnimations()) {
      const t = a.effect?.target; if (t && !root.contains(t) && t !== root) continue;
      const name = a.animationName ? `CSS 动画 ${a.animationName}` : a.transitionProperty ? `CSS 过渡 ${a.transitionProperty}` : 'Web Animations 动画';
      const set = running.get(name) || new Set(); if (t) set.add(t); running.set(name, set);
    }
    const keyframes = new Set();
    const walkRules = rules => { for (const r of rules) { if (r instanceof CSSKeyframesRule) keyframes.add(r.name); else if (r.cssRules) try { walkRules(r.cssRules); } catch {} } };
    for (const sheet of document.styleSheets) try { walkRules(sheet.cssRules); } catch {}
    const libs = LIBS.filter(n => { try { return window[n] !== undefined; } catch { return false; } });
    const attrs = new Map(); let fragments = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.classList?.contains('fragment')) fragments++;
      for (const at of el.attributes || []) if (/^data-.*(step|fragment|aos|anim|delay|duration|order|index|reveal|transition|motion|scroll|parallax|appear|enter)/i.test(at.name)) attrs.set(at.name, (attrs.get(at.name) || 0) + 1);
    }
    const title = document.title || '';
    return { running: [...running].map(([name, set]) => ({ name, count: set.size })), keyframes: [...keyframes], libs, attrs: [...attrs].map(([name, count]) => ({ name, count })), fragments, title };
  }

  // ---------- 原网页位置：在整份原文档里唯一的 CSS 选择器 ----------
  const cssEsc = s => (window.CSS?.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c));
  const stableClass = el => [...el.classList].find(c => /^[a-zA-Z][a-zA-Z0-9_-]{1,40}$/.test(c) && !/\d{3,}|^(vw|css|sc|jsx|svelte|astro)-|^_/.test(c) && !/^(active|show|visible|hidden|open|selected|current|present|past|future|aos-animate|fragment)$/.test(c));
  function selectorOf(el, doc) {
    const unique = sel => { try { const all = doc.querySelectorAll(sel); return all.length === 1 && all[0] === el; } catch { return false; } };
    if (el === doc.documentElement) return 'html';
    if (el === doc.body) return 'body';
    if (el.id && unique('#' + cssEsc(el.id))) return '#' + cssEsc(el.id);
    const tag = el.localName, cls = stableClass(el);
    if (cls && unique(`${tag}.${cssEsc(cls)}`)) return `${tag}.${cssEsc(cls)}`;
    const parts = []; let cur = el;
    while (cur && cur.parentElement) {
      if (cur !== el && cur.id) { try { const all = doc.querySelectorAll('#' + cssEsc(cur.id)); if (all.length === 1 && all[0] === cur) { parts.unshift('#' + cssEsc(cur.id)); const s = parts.join(' > '); if (unique(s)) return s; break; } } catch {} }
      const same = [...cur.parentElement.children].filter(c => c.localName === cur.localName);
      parts.unshift(cur === doc.body ? 'body' : same.length > 1 ? `${cur.localName}:nth-of-type(${same.indexOf(cur) + 1})` : cur.localName);
      if (cur === doc.body) break;
      const s = parts.join(' > ');
      if (unique(s)) return s;
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  // ---------- 自动标记 ----------
  const TEXT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'TD', 'TH', 'DT', 'DD', 'LABEL', 'BUTTON', 'A', 'CAPTION', 'SUMMARY', 'LEGEND']);
  const LOOSE_TAGS = new Set(['SPAN', 'DIV', 'STRONG', 'EM', 'B', 'I', 'SMALL', 'MARK', 'TIME']);
  // 块级子元素（有它们的容器不当作一段文字，继续往里找）
  const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'DT', 'DD', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'UL', 'IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'LABEL', 'FORM']);
  const NEVER = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'CANVAS', 'VIDEO', 'AUDIO', 'HEAD']);
  const hasText = el => /\S/.test(el.textContent || '');
  const directText = el => [...el.childNodes].some(n => n.nodeType === 3 && /\S/.test(n.nodeValue));
  const hasBlockChild = el => [...el.querySelectorAll('*')].some(c => BLOCK.has(c.tagName.toUpperCase()));
  function isText(el) {
    const tag = el.tagName.toUpperCase();
    if (!hasText(el) || hasBlockChild(el)) return false;
    if (TEXT_TAGS.has(tag)) return true;
    return LOOSE_TAGS.has(tag) && directText(el);
  }
  function mark(scope, doc) {
    const used = new Set([...doc.querySelectorAll('[data-vw-id]')].map(e => e.getAttribute('data-vw-id')));
    let t = 0, i = 0;
    const nextId = p => { let id; do id = `${p}${p === 't' ? ++t : ++i}`; while (used.has(id)); used.add(id); return id; };
    const stats = { text: 0, image: 0 };
    const visit = el => {
      const tag = el.tagName.toUpperCase();
      if (NEVER.has(tag)) return;
      if (el.hasAttribute('data-vw-id')) return; // 原文件自己已经标过的不动
      if (tag === 'IMG') {
        const origin = selectorOf(el, doc);
        el.setAttribute('data-vw-id', nextId('i')); el.setAttribute('data-vw', 'move resize crop'); el.setAttribute('data-vw-origin', origin); stats.image++;
        return;
      }
      if (isText(el)) {
        const origin = selectorOf(el, doc);
        el.setAttribute('data-vw-id', nextId('t')); el.setAttribute('data-vw', 'text move resize color'); el.setAttribute('data-vw-origin', origin); stats.text++;
        return; // 文字里面不再标
      }
      for (const c of [...el.children]) visit(c);
    };
    if (scope === doc.body) for (const c of [...scope.children]) visit(c); else visit(scope);
    return stats;
  }

  // ---------- 自动标记：纯色色块（第 12 轮修正） ----------
  // 有可见底色（底色不透明，或 background 是渐变；background-image 是图片的不算）、自身没有直接文字、不是图片 / 矢量 / 视频 / 画布、有尺寸的块：
  // 标 data-vw="move resize background"（编号 b1、b2…）。整页背景（html、body、这一页的根和它的祖先容器，
  // 或盒子 ≥ 页面尺寸 95% 的块）只标 background（编号 bg1、bg2…），可改颜色，不可移动缩放。
  // 判断要用到计算样式和盒子尺寸：网址抓取时量当前页面（文档是它的克隆）；本地文件在一个不跑脚本的隐藏 iframe 里
  // 按工作台显示时的尺寸渲染这一页再量。量之前先给候选元素打临时编号 data-vw-tmp，量完去掉。
  const NOT_BLOCK = new Set(['IMG', 'PICTURE', 'EMBED', 'INPUT', 'LINK', 'META', 'BR', 'WBR', 'SOURCE', 'TRACK', 'PARAM', 'AREA', 'MAP', 'BASE', 'TITLE']);
  function blockCandidates(scope, doc, root, snapshot) {
    const out = []; let n = 0;
    const live = el => {
      if (!snapshot) return null;
      if (el === doc.documentElement) return document.documentElement;
      if (el === doc.body) return document.body;
      const path = []; for (let e = el; e && e !== doc.body; e = e.parentElement) { if (!e.parentElement) return null; path.unshift([...e.parentElement.children].indexOf(e)); }
      const found = byPath(document.body, path);
      return found && found.localName === el.localName ? found : null;
    };
    const add = (el, page) => { if (!el || el.hasAttribute('data-vw-id')) return; el.setAttribute('data-vw-tmp', String(++n)); out.push({ n: String(n), el, page, live: live(el) }); };
    add(doc.documentElement, true); add(doc.body, true);
    if (root) { const chain = []; for (let e = root; e && e !== doc.body; e = e.parentElement) chain.unshift(e); for (const e of chain) add(e, true); }
    const walk = el => { for (const c of [...el.children]) { const tag = c.tagName.toUpperCase(); if (NEVER.has(tag) || NOT_BLOCK.has(tag) || c.hasAttribute('data-vw-id')) continue; add(c, false); walk(c); } };
    walk(root || doc.body);
    return out;
  }
  const clearColor = c => !c || c === 'transparent' || /,\s*0(\.0+)?\s*\)$/.test(c) || /\/\s*0(\.0+)?%?\s*\)$/.test(c);
  const colorBg = s => { const img = s.backgroundImage || 'none'; if (/url\(/i.test(img)) return false; return !clearColor(s.backgroundColor) || /gradient\(/i.test(img); };
  // 本地文件：在隐藏 iframe（sandbox 只给 allow-same-origin，不跑脚本）里按工作台的尺寸渲染这一页
  async function renderedView(doc, { base, width, height, web }) {
    const clone = doc.documentElement.cloneNode(true);
    let head = clone.querySelector('head'); if (!head) { head = doc.createElement('head'); clone.prepend(head); }
    for (const m of clone.querySelectorAll('meta[http-equiv]')) m.remove();
    const st = doc.createElement('style'); st.textContent = web ? `html,body{margin:0;width:${width}px}` : `html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}`;
    head.prepend(st);
    if (base) { const b = doc.createElement('base'); b.setAttribute('href', base); head.prepend(b); }
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin'); frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('tabindex', '-1');
    frame.style.cssText = `position:fixed!important;left:${-width - 2000}px!important;top:0!important;width:${width}px!important;height:${height}px!important;border:0!important;pointer-events:none!important;display:block!important;visibility:visible!important`;
    const loaded = new Promise(ok => { frame.addEventListener('load', ok, { once: true }); setTimeout(ok, 10000); });
    frame.srcdoc = `<!DOCTYPE html>\n${clone.outerHTML}`;
    document.documentElement.append(frame);
    await loaded;
    const fdoc = frame.contentDocument;
    if (fdoc?.fonts?.ready) await Promise.race([fdoc.fonts.ready, new Promise(ok => setTimeout(ok, 3000))]);
    return { frame, fdoc };
  }
  async function markBlocks({ doc, whole, cands, snapshot, base, width, height, web }) {
    const stats = { block: 0, background: 0 };
    if (!cands.length) return stats;
    let view = null;
    try {
      let find, pageW = width, pageH = height;
      if (snapshot) { find = c => c.live; if (web) pageH = Math.max(height, document.documentElement.scrollHeight, document.body?.scrollHeight || 0); }
      else {
        view = await renderedView(doc, { base, width, height, web });
        const byTmp = new Map(); if (view.fdoc) for (const e of view.fdoc.querySelectorAll('[data-vw-tmp]')) byTmp.set(e.getAttribute('data-vw-tmp'), e);
        find = c => byTmp.get(c.n) || null;
        if (web && view.fdoc) pageH = Math.max(height, view.fdoc.documentElement.scrollHeight, view.fdoc.body?.scrollHeight || 0);
      }
      const used = new Set([...doc.querySelectorAll('[data-vw-id]')].map(e => e.getAttribute('data-vw-id')));
      const counters = { b: 0, bg: 0 };
      const nextId = p => { let id; do id = `${p}${++counters[p]}`; while (used.has(id)); used.add(id); return id; };
      for (const c of cands) {
        if (!c.el.isConnected) continue; // 这一页之外的（兄弟页已经去掉）
        const el = find(c); if (!el) continue;
        const s = el.ownerDocument.defaultView.getComputedStyle(el);
        if (!colorBg(s)) continue;
        let page = c.page;
        if (!page) {
          if (s.display === 'none' || s.visibility === 'hidden' || directText(c.el)) continue;
          const r = el.getBoundingClientRect();
          if (!(r.width >= 2 && r.height >= 2)) continue;
          page = r.width >= pageW * 0.95 && r.height >= pageH * 0.95;
        }
        const w = whole.querySelector(`[data-vw-tmp="${c.n}"]`);
        const origin = w ? selectorOf(w, whole) : '';
        c.el.removeAttribute('data-vw-tmp');
        c.el.setAttribute('data-vw-id', nextId(page ? 'bg' : 'b')); c.el.setAttribute('data-vw', page ? 'background' : 'move resize background');
        if (origin) c.el.setAttribute('data-vw-origin', origin);
        stats[page ? 'background' : 'block']++;
      }
    } finally {
      view?.frame.remove();
      for (const e of doc.querySelectorAll('[data-vw-tmp]')) e.removeAttribute('data-vw-tmp');
    }
    return stats;
  }

  // ---------- 生成一页 ----------
  // 网址抓取：当前 DOM（脚本跑过之后的样子）；能读到的样式表内容放进 <style>（url() 换成绝对地址）
  const absCss = (text, base) => String(text).replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g, (m, q, u) => { if (!u || /^(data:|#)/i.test(u.trim())) return m; try { return `url("${new URL(u.trim(), base).href}")`; } catch { return m; } });
  const sheetText = sheet => { try { return [...sheet.cssRules].map(r => r.cssText).join('\n'); } catch { return null; } };
  function snapshotDoc() {
    const doc = document.implementation.createHTMLDocument('');
    doc.replaceChild(doc.importNode(document.documentElement, true), doc.documentElement);
    const live = [...document.querySelectorAll('style, link[rel~="stylesheet" i]')], copies = [...doc.querySelectorAll('style, link[rel~="stylesheet" i]')];
    live.forEach((el, n) => {
      const copy = copies[n]; if (!copy || !el.sheet) return;
      const text = sheetText(el.sheet); if (text === null) return; // 跨域读不到：留 link，Node 那边再按 GET 下载
      const base = el.sheet.href || document.baseURI;
      if (copy.localName === 'link') { const st = doc.createElement('style'); if (el.media) st.setAttribute('media', el.media); st.setAttribute('data-vw-from', el.href); st.textContent = absCss(text, base); copy.replaceWith(st); }
      else if (text.trim() && text.replace(/\s+/g, '') !== copy.textContent.replace(/\s+/g, '')) copy.textContent = absCss(text, base); // CSS-in-JS 用 insertRule 写的规则
    });
    // 表单当前值、画布内容不在 outerHTML 里；画布在迁移说明里提醒
    return doc;
  }
  const URL_ATTRS = [
    ['img', 'src'], ['img', 'srcset'], ['source', 'src'], ['source', 'srcset'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'], ['track', 'src'],
    ['input', 'src'], ['embed', 'src'], ['object', 'data'], ['script', 'src'], ['link', 'href'], ['image', 'href'], ['image', 'xlink:href'], ['use', 'href'], ['use', 'xlink:href'],
  ];
  async function prepare({ source, sourceUrl, spec, width, height, snapshot }) {
    const doc = snapshot ? snapshotDoc() : new DOMParser().parseFromString(String(source), 'text/html');
    let base = snapshot ? document.baseURI : sourceUrl;
    const baseEl = doc.querySelector('base[href]');
    if (baseEl) { try { base = new URL(baseEl.getAttribute('href'), base).href; } catch {} }
    for (const b of doc.querySelectorAll('base')) b.remove();
    const root = spec.mode === 'section' ? byPath(doc.body, spec.path) : null;
    if (spec.mode === 'section' && !root) throw new Error('原文件里找不到这一页');
    const stats = mark(root || doc.body, doc);
    // 色块候选：先打临时编号，再留一份整份文档的副本（data-vw-origin 要在整份原文档里唯一）
    const cands = blockCandidates(root || doc.body, doc, root, snapshot);
    const whole = doc.cloneNode(true);
    const notes = { scripts: { inline: 0, external: [] }, removedScripts: [], styles: 0, canvas: doc.querySelectorAll('canvas').length, iframes: [], fragments: 0 };
    // 网址抓取：DOM 是脚本跑过之后的样子，脚本再跑一遍会重复渲染，所以不保留
    if (snapshot) for (const s of [...doc.querySelectorAll('script')]) { const t = (s.getAttribute('type') || '').toLowerCase(); if (t && !/javascript|module|ecmascript/.test(t)) continue; notes.removedScripts.push(s.getAttribute('src') || '内联脚本'); s.remove(); }
    // 只留这一页：祖先容器保留标签和属性（class 等，原 CSS 的选择器还能对上），兄弟页面去掉
    if (root) {
      for (let e = root; e && e !== doc.body; e = e.parentElement) for (const sib of [...e.parentElement.children]) if (sib !== e && !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(sib.tagName.toUpperCase())) sib.remove();
      root.setAttribute('data-vw-import-page', '');
      const rules = [];
      if (spec.framework) { rules.push('[data-vw-import-page]{display:block!important;visibility:visible!important;opacity:1!important;transform:none!important}'); }
      if (spec.framework === 'reveal') { for (const f of root.querySelectorAll('.fragment')) { f.classList.add('visible'); notes.fragments++; } }
      if (spec.zoom && Math.abs(spec.zoom - 1) > 0.02) rules.push(`[data-vw-import-page]{zoom:${Math.round(spec.zoom * 10000) / 10000}}`);
      if (rules.length) { const st = doc.createElement('style'); st.setAttribute('data-vw-import', ''); st.textContent = rules.join('\n'); doc.head.append(st); }
    }
    // 保底切分：整份文档，往上挪 N 屏露出第 N 屏
    if (spec.mode === 'fallback' && spec.index > 0) {
      const st = doc.createElement('style'); st.setAttribute('data-vw-import', '');
      st.textContent = `html{overflow:hidden!important}body{margin-top:${-spec.index * height}px!important;height:auto!important;overflow:visible!important}`;
      doc.head.append(st);
    }
    // 色块：这一页切好之后量（隐藏的幻灯片已经显示出来、缩放已经加上）
    Object.assign(stats, await markBlocks({ doc, whole, cands, snapshot, base, width, height, web: !!spec.web }));
    // 资源引用 → 绝对地址，交给 Node
    const slots = [], refs = new Set();
    const abs = u => { const v = String(u || '').trim(); if (!v || /^(#|javascript:|about:|mailto:|tel:)/i.test(v)) return null; try { return new URL(v, base).href; } catch { return null; } };
    for (const [tag, attr] of URL_ATTRS) for (const el of doc.getElementsByTagName(tag)) {
      if (!el.hasAttribute(attr)) continue;
      if (tag === 'link' && !/(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|preload|modulepreload|prefetch)(\s|$)/i.test(el.getAttribute('rel') || '')) continue;
      if (tag === 'use' && /^#/.test(el.getAttribute(attr))) continue;
      const raw = el.getAttribute(attr);
      const role = tag === 'link' && /stylesheet/i.test(el.getAttribute('rel') || '') ? 'css' : tag === 'script' ? 'script' : 'asset';
      if (attr === 'srcset') {
        const parts = raw.split(',').map(p => { const [u, ...d] = p.trim().split(/\s+/); return { url: abs(u), d: d.join(' ') }; }).filter(p => p.url);
        for (const p of parts) refs.add(JSON.stringify([p.url, 'asset']));
        slots.push({ el, attr, srcset: parts });
      } else { const url = abs(raw); if (!url) continue; refs.add(JSON.stringify([url, role])); slots.push({ el, attr, url }); }
      if (tag === 'script') notes.scripts.external.push(raw);
    }
    for (const s of doc.querySelectorAll('script:not([src])')) if (!/json|template|text\/(?!javascript)/i.test(s.getAttribute('type') || '')) notes.scripts.inline++;
    for (const f of doc.querySelectorAll('iframe[src]')) notes.iframes.push(f.getAttribute('src'));
    const css = [];
    for (const st of doc.querySelectorAll('style')) { css.push({ el: st, text: st.textContent }); notes.styles++; }
    for (const el of doc.querySelectorAll('[style]')) if (/url\(/i.test(el.getAttribute('style'))) css.push({ el, attr: 'style', text: el.getAttribute('style') });
    const heading = [...(root || doc.body).querySelectorAll('h1, h2, h3')].map(h => h.textContent.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    window.__vwKit = { doc, slots, css, base };
    return { base, refs: [...refs].map(r => JSON.parse(r)), css: css.map(c => c.text), stats, notes, heading, title: doc.title || '' };
  }
  // map：绝对地址 → 新地址（../assets/…）；css：改写好的样式文本（与 prepare 返回的顺序一一对应）
  function finish({ map, css }) {
    const { doc, slots, css: cssSlots, base } = window.__vwKit;
    const to = u => (Object.prototype.hasOwnProperty.call(map, u) ? map[u] : u);
    for (const s of slots) {
      if (s.srcset) s.el.setAttribute(s.attr, s.srcset.map(p => `${to(p.url)}${p.d ? ' ' + p.d : ''}`).join(', '));
      else if (to(s.url) === '') s.el.removeAttribute(s.attr); // 本地缺失的文件：去掉引用（迁移说明里列出）
      else s.el.setAttribute(s.attr, to(s.url));
    }
    cssSlots.forEach((c, n) => { if (c.attr) c.el.setAttribute(c.attr, css[n]); else c.el.textContent = css[n]; });
    // 链接（<a href>）保持原样；相对链接在工作台里没有意义，换成原网页的绝对地址
    for (const a of doc.querySelectorAll('a[href]')) { const h = a.getAttribute('href'); if (h && !/^(#|[a-z][a-z0-9+.-]*:)/i.test(h)) { try { a.setAttribute('href', new URL(h, base).href); } catch {} } }
    window.__vwKit = null;
    const dt = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
    return `${dt}\n${doc.documentElement.outerHTML}\n`;
  }
  window.__vwImport = { detect, pages, clues, prepare, finish };
}
