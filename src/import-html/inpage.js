// 旧 HTML 导入：注入后台浏览器页面里运行的分析代码。install 整体 toString 后注入，不能引用外部变量。
// 提供 window.__vwImport：detect（识别分页）、isolate（单独显示某一页）、analyze（等动画播完后取文字 / 图片 / 背景 / 截图块）、
// shotOn / shotOff（截图时只显示目标元素）。坐标一律换算成画板坐标：(元素位置 - 页面框) × 缩放。
export function install() {
  if (window.__vwImport) return;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const cs = el => getComputedStyle(el);
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  // 颜色 → {r,g,b,a}；rgb()/rgba() 直接解析，其他写法（oklch、color() 等）用 canvas 换算
  function color(str) {
    if (!str || str === 'transparent') return null;
    const m = /^rgba?\(([^)]+)\)$/.exec(str.trim());
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean); const a = p[3] === undefined ? 1 : p[3].endsWith('%') ? num(p[3]) / 100 : num(p[3]); return { r: num(p[0]), g: num(p[1]), b: num(p[2]), a }; }
    try { c2d.clearRect(0, 0, 1, 1); c2d.fillStyle = '#000'; c2d.fillStyle = str; c2d.fillRect(0, 0, 1, 1); const d = c2d.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; } catch { return null; }
  }
  const h2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const hex = c => '#' + h2(c.r) + h2(c.g) + h2(c.b) + (c.a < 0.996 ? h2(c.a * 255) : '');
  // 按顶层逗号拆分（括号里的逗号不拆）
  function splitTop(str, sep = ',') { const out = []; let depth = 0, cur = ''; for (const ch of str) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
  // CSS 渐变 → 项目格式渐变；解析不了返回 null
  function gradient(str) {
    const m = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(str.trim()); if (!m || m[1]) return null;
    const args = splitTop(m[3]); let angle = 180;
    if (m[2] === 'linear' && args.length && !color(args[0].replace(/\s+[\d.]+%$/, ''))) {
      const a = args.shift().trim(), sides = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
      if (a in sides) angle = sides[a]; else if (/deg$/.test(a)) angle = num(a); else if (/turn$/.test(a)) angle = num(a) * 360; else if (/rad$/.test(a)) angle = num(a) * 180 / Math.PI; else return null;
    } else if (m[2] === 'radial' && args.length && !color(args[0].replace(/\s+[\d.]+%$/, ''))) args.shift();
    const stops = [];
    for (const arg of args) {
      const sm = /^(.*\))\s*(.*)$|^(\S+)\s*(.*)$/.exec(arg); const cpart = sm[1] || sm[3], rest = (sm[2] ?? sm[4] ?? '').trim();
      const c = color(cpart); if (!c) return null;
      const pos = rest.split(/\s+/).filter(Boolean); if (pos.some(p => !p.endsWith('%'))) return null;
      if (!pos.length) stops.push({ color: hex(c) }); else for (const p of pos) stops.push({ color: hex(c), offset: Math.max(0, Math.min(1, num(p) / 100)) });
    }
    if (stops.length < 2) return null;
    stops.forEach((s, i) => { if (s.offset === undefined) s.offset = i === 0 ? 0 : i === stops.length - 1 ? 1 : undefined; });
    for (let i = 1; i < stops.length - 1; i++) if (stops[i].offset === undefined) { let j = i; while (stops[j].offset === undefined) j++; const a = stops[i - 1].offset, b = stops[j].offset; for (let k = i; k < j; k++) stops[k].offset = a + (b - a) * (k - i + 1) / (j - i + 1); }
    let last = 0; for (const s of stops) { s.offset = round(Math.max(last, s.offset), 4); last = s.offset; }
    angle = ((angle % 360) + 360) % 360;
    return m[2] === 'linear' ? { type: 'linear', angle: round(angle, 2), stops } : { type: 'radial', stops };
  }
  const urlOf = layer => { const m = /^url\((['"]?)(.*)\1\)$/s.exec(layer.trim()); return m ? m[2] : null; };
  const fitOf = size => /cover/.test(size) ? 'cover' : /contain/.test(size) ? 'contain' : /^100%\s+100%$/.test(size.trim()) ? 'fill' : 'cover';
  async function inlineBlob(src) { if (!src.startsWith('blob:')) return src; try { const b = await (await fetch(src)).blob(); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(src); fr.readAsDataURL(b); }); } catch { return src; } }

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

  // ---------- 单独显示某一页 ----------
  const force = (el, prop, value) => el.style.setProperty(prop, value, 'important');
  function isolate(kind, index) {
    let root = document.body, box, mode = 'element';
    if (kind === 'deck') { mode = 'viewport'; }
    else if (kind === 'fallback') { mode = 'fallback'; scrollTo(0, index * innerHeight); }
    else {
      const all = slideList(kind); root = all[index]; if (!root) throw new Error(`找不到第 ${index + 1} 页`);
      if (kind !== 'scroll') {
        for (const o of all) if (o !== root && !o.contains(root) && !root.contains(o)) force(o, 'display', 'none');
        for (let e = root; e && e !== document.body; e = e.parentElement) { const s = cs(e); if (s.display === 'none') force(e, 'display', 'block'); if (s.visibility !== 'visible') force(e, 'visibility', 'visible'); if (num(s.opacity) < 1) force(e, 'opacity', '1'); }
        force(root, 'transform', 'none');
        if (kind === 'swiper' && root.parentElement) force(root.parentElement, 'transform', 'none');
      }
    }
    if (mode === 'element') { const r = root.getBoundingClientRect(); scrollTo(scrollX + r.left, scrollY + r.top); }
    window.__vwPage = { kind, index, root, mode };
  }
  function pageBox() {
    const p = window.__vwPage;
    if (p.mode === 'viewport') return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    if (p.mode === 'fallback') return { left: -scrollX, top: p.index * innerHeight - scrollY, width: innerWidth, height: innerHeight };
    const r = p.root.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // ---------- 动画与库的线索（只记录，不搬代码） ----------
  const LIBS = ['gsap', 'TweenMax', 'TweenLite', 'anime', 'Reveal', 'impress', 'Swiper', 'AOS', 'ScrollMagic', 'ScrollReveal', 'lottie', 'bodymovin', 'THREE', 'PIXI', 'Motion', 'Velocity', 'p5', 'Typed', 'Splitting', 'Lenis', 'barba', 'fullpage', 'Konva', 'echarts', 'Chart', 'd3', 'Matter', 'mojs'];
  function clues(root) {
    const running = new Map();
    for (const a of document.getAnimations()) {
      const t = a.effect?.target; if (t && !root.contains(t) && t !== root) continue;
      const name = a.animationName ? `CSS 动画 ${a.animationName}` : a.transitionProperty ? `CSS 过渡 ${a.transitionProperty}` : 'Web Animations 动画';
      const set = running.get(name) || new Set(); if (t) set.add(t); running.set(name, set);
    }
    const keyframes = new Set();
    const walkRules = rules => { for (const r of rules) { if (r.type === 7 || r instanceof CSSKeyframesRule) keyframes.add(r.name); if (r.cssRules && !(r instanceof CSSKeyframesRule)) try { walkRules(r.cssRules); } catch {} } };
    for (const sheet of document.styleSheets) try { walkRules(sheet.cssRules); } catch {}
    const libs = LIBS.filter(n => { try { return window[n] !== undefined; } catch { return false; } });
    const scripts = [...document.scripts].map(s => s.getAttribute('src')).filter(Boolean).map(s => s.split(/[?#]/)[0].split('/').pop()).filter(Boolean);
    const attrs = new Map(); let fragments = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.classList?.contains('fragment')) fragments++;
      for (const at of el.attributes || []) if (/^data-.*(step|fragment|aos|anim|delay|duration|order|index|reveal|transition|motion|scroll|parallax|appear|enter)/i.test(at.name)) attrs.set(at.name, (attrs.get(at.name) || 0) + 1);
    }
    return { running: [...running].map(([name, set]) => ({ name, count: set.size })), keyframes: [...keyframes], libs, scripts, attrs: [...attrs].map(([name, count]) => ({ name, count })), fragments };
  }
  // 播放到「最后一步」：揭开常见的分步隐藏（reveal fragment、AOS），有限动画直接 finish，无限动画停在当前帧
  function finishAll(root) {
    for (const el of root.querySelectorAll('.fragment')) el.classList.add('visible');
    for (const el of root.querySelectorAll('[data-aos]')) el.classList.add('aos-animate');
    for (const a of document.getAnimations()) { try { const it = a.effect?.getComputedTiming?.().iterations; if (it === Infinity) a.pause(); else a.finish(); } catch { try { a.pause(); } catch {} } }
  }

  // ---------- 字体线索 ----------
  function fontInfo() {
    const faces = [];
    const walkRules = (rules, base) => { for (const r of rules) { if (r instanceof CSSFontFaceRule) { const st = r.style; const src = st.getPropertyValue('src'); const urls = []; for (const part of splitTop(src)) { const u = /url\((['"]?)(.*?)\1\)/s.exec(part); if (!u) continue; let abs = u[2]; try { abs = new URL(u[2], base).href; } catch {} urls.push({ url: abs, format: (/format\((['"]?)(.*?)\1\)/.exec(part) || [])[2] || '' }); } faces.push({ family: st.getPropertyValue('font-family').trim().replace(/^['"]|['"]$/g, ''), weight: st.getPropertyValue('font-weight').trim() || '400', style: st.getPropertyValue('font-style').trim() || 'normal', urls }); } else if (r instanceof CSSImportRule && r.styleSheet) { try { walkRules(r.styleSheet.cssRules, r.styleSheet.href || base); } catch {} } else if (r.cssRules) { try { walkRules(r.cssRules, base); } catch {} } } };
    for (const sheet of document.styleSheets) try { walkRules(sheet.cssRules, sheet.href || document.baseURI); } catch {}
    const remote = [];
    for (const link of document.querySelectorAll('link[href]')) { const href = link.getAttribute('href') || ''; if (/fonts\.googleapis\.com|fonts\.loli\.net|fonts\.bunny\.net/.test(href)) { try { for (const f of new URL(href, document.baseURI).searchParams.getAll('family')) for (const one of f.split('|')) remote.push(one.split(':')[0].replace(/\+/g, ' ')); } catch {} } }
    for (const st of document.querySelectorAll('style')) for (const m of st.textContent.matchAll(/@import\s+url\(['"]?([^'")]+)/g)) { try { const u = new URL(m[1], document.baseURI); for (const f of u.searchParams.getAll('family')) remote.push(f.split(':')[0].replace(/\+/g, ' ')); } catch {} }
    return { faces, remote };
  }

  // ---------- 取一页内容 ----------
  const SHOT_TAGS = new Set(['CANVAS', 'VIDEO', 'IFRAME', 'EMBED', 'OBJECT', 'AUDIO']);
  const LIMIT = 300;
  async function analyze({ width, wait: waitMs = 250 }) {
    const page = window.__vwPage; const root = page.root;
    try { await Promise.race([document.fonts.ready, wait(4000)]); } catch {}
    await wait(waitMs);
    const clue = clues(root);
    finishAll(root);
    await frames(2);
    if (page.mode === 'element') { const r = root.getBoundingClientRect(); scrollTo(scrollX + r.left, scrollY + r.top); await frames(1); }
    const box = pageBox(), scale = box.width > 0 ? width / box.width : 1, boxArea = box.width * box.height;
    const items = [], rest = []; let uid = 0;
    const mark = el => { if (!el.dataset.vwImp) el.dataset.vwImp = String(++uid); return el.dataset.vwImp; };
    const toBox = r => ({ x: round((r.left - box.left) * scale), y: round((r.top - box.top) * scale), width: round(r.width * scale), height: round(r.height * scale) });
    const raw = r => ({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height });
    const hits = r => r.right > box.left + 1 && r.left < box.left + box.width - 1 && r.bottom > box.top + 1 && r.top < box.top + box.height - 1;
    const centered = r => { const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx >= box.left && cx < box.left + box.width && cy >= box.top && cy < box.top + box.height; };
    const owns = page.mode === 'fallback' ? centered : hits;
    const clipToBox = r => { const left = Math.max(r.left, box.left), top = Math.max(r.top, box.top), right = Math.min(r.right, box.left + box.width), bottom = Math.min(r.bottom, box.top + box.height); return { left, top, width: right - left, height: bottom - top, right, bottom }; };
    const elScale = (el, r) => (el.offsetWidth > 0 ? r.width / el.offsetWidth : 1) || 1;
    const push = item => { items.push(item); };

    // 背景：页面根、body、html 的背景色取第一个不透明的；背景图（url / 解析不了的渐变）成为铺满的锁定图片或截图
    const bgOwners = [...new Set([document.documentElement, document.body, root])];
    let background = null, bgGradient = null;
    for (const el of [...bgOwners].reverse()) { const c = color(cs(el).backgroundColor); if (c && c.a > 0) { background = hex(c); break; } }
    const full = { x: 0, y: 0, width: round(box.width * scale), height: round(box.height * scale) };
    for (const el of bgOwners) {
      const s = cs(el); if (!s.backgroundImage || s.backgroundImage === 'none') continue;
      const layers = splitTop(s.backgroundImage);
      const urls = layers.map(urlOf);
      if (layers.length === 1 && !urls[0] && gradient(layers[0])) { bgGradient = gradient(layers[0]); continue; }
      if (urls.every(Boolean) && /no-repeat/.test(s.backgroundRepeat) || (urls.every(Boolean) && /cover|contain/.test(s.backgroundSize))) { for (const u of [...urls].reverse()) push({ kind: 'image', role: 'background', ...full, src: await inlineBlob(u), fit: fitOf(splitTop(s.backgroundSize)[0] || 'cover'), name: '背景图' }); }
      else push({ kind: 'shot', role: 'background', own: true, mark: mark(el), ...full, clip: raw(clipToBox(page.mode === 'element' && el === root ? root.getBoundingClientRect() : { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height, width: box.width, height: box.height })), reason: '背景图案', name: '背景' });
    }

    const consumedBy = new WeakSet();
    const hasBlockInside = el => [...el.querySelectorAll('*')].some(d => { const s = cs(d); return s.display !== 'inline' && s.display !== 'contents' && s.display !== 'none' && !SKIP.has(d.tagName); });
    const inlineChild = n => { if (n.nodeType !== 1 || SKIP.has(n.tagName) && n.tagName !== 'BR') return false; if (n.tagName === 'BR') return true; const s = cs(n); return (s.display === 'inline' || s.display === 'contents') && !SHOT_TAGS.has(n.tagName) && !(n instanceof SVGElement) && !n.querySelector('img, svg, canvas, video, iframe, embed, object') && !hasBlockInside(n) && !needsShot(n, s); };
    function textParts(el) {
      const parts = [], nodes = [];
      const take = (node, transform) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) { if (n.data.length) { let t = n.data; if (transform === 'uppercase') t = t.toUpperCase(); else if (transform === 'lowercase') t = t.toLowerCase(); parts.push(t); nodes.push(n); } }
          else if (inlineChild(n)) { if (n.tagName === 'BR') { parts.push('\u2028'); continue; } const s = cs(n); if (s.display === 'none') continue; consumedBy.add(n); nodes.push(n); take(n, s.textTransform !== 'none' ? s.textTransform : transform); }
        }
      };
      take(el, cs(el).textTransform);
      return { parts, nodes };
    }
    function cleanText(parts, ws) {
      let text = parts.join('');
      text = /^(pre|pre-wrap|break-spaces|pre-line)$/.test(ws) ? text.replaceAll('\u2028', '\n') : text;
      if (/^(pre|pre-wrap|break-spaces)$/.test(ws)) return text.replace(/^\n+|\s+$/g, '');
      if (ws === 'pre-line') return text.split('\n').map(l => l.replace(/[ \t\r\f]+/g, ' ').trim()).join('\n').trim();
      // 普通空白：连续空白（含源码里的换行）合成一个空格；只有 <br> 产生换行
      return text.replace(/[ \t\n\r\f\v]+/g, ' ').split('\u2028').map(l => l.trim()).join('\n').trim();
    }
    function needsShot(el, s) {
      if (SHOT_TAGS.has(el.tagName)) return el.tagName.toLowerCase();
      if (el === root || el === document.body || el === document.documentElement) return null;
      if (s.filter && s.filter !== 'none') return 'filter 滤镜';
      if (s.backdropFilter && s.backdropFilter !== 'none') return 'backdrop-filter 背景模糊';
      if (s.clipPath && s.clipPath !== 'none') return 'clip-path 裁切';
      if ((s.maskImage && s.maskImage !== 'none') || (s.webkitMaskImage && s.webkitMaskImage !== 'none')) return 'mask 遮罩';
      if (s.mixBlendMode && s.mixBlendMode !== 'normal') return 'mix-blend-mode 混合';
      if ((s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text')) return 'background-clip:text 渐变字';
      const r = el.getBoundingClientRect(), large = r.width * r.height >= boxArea * 0.5;
      if (s.transform && s.transform !== 'none') {
        const m = new DOMMatrixReadOnly(s.transform), e = 1e-3;
        const translate = m.is2D && Math.abs(m.a - 1) < e && Math.abs(m.b) < e && Math.abs(m.c) < e && Math.abs(m.d - 1) < e;
        const pureScale = m.is2D && Math.abs(m.b) < e && Math.abs(m.c) < e && m.a > 0 && Math.abs(m.a - m.d) < e;
        if (!translate && !(pureScale && large)) return 'transform 变形';
      }
      if (s.rotate && s.rotate !== 'none') return 'transform 旋转';
      if (s.scale && s.scale !== 'none' && !large) return 'transform 缩放';
      return null;
    }
    function decoration(el, s, r, op, k) {
      const b = toBox(r), radius = round(num(s.borderTopLeftRadius) * k * scale);
      const bw = num(s.borderTopWidth), bc = color(s.borderTopColor);
      const uniform = ['Right', 'Bottom', 'Left'].every(side => num(s[`border${side}Width`]) === bw && s[`border${side}Style`] === s.borderTopStyle) && /solid|double/.test(s.borderTopStyle);
      const stroke = bw > 0 && uniform && bc && bc.a > 0 ? { color: hex(bc), width: round(bw * k * scale) } : null;
      const layers = s.backgroundImage && s.backgroundImage !== 'none' ? splitTop(s.backgroundImage) : [];
      const urls = layers.map(urlOf), grads = layers.map(l => urlOf(l) ? null : gradient(l));
      const repeated = urls.some(Boolean) && !/no-repeat/.test(s.backgroundRepeat) && !/cover|contain|100%/.test(s.backgroundSize);
      const plain = layers.every((l, i) => urls[i] || grads[i]) && !repeated && grads.filter(Boolean).length <= 1;
      if (layers.length && !plain) { push({ kind: 'shot', own: true, mark: mark(el), ...b, clip: raw(r), reason: '背景图案', name: '背景块', opacity: 1 }); return; }
      const bg = color(s.backgroundColor);
      if ((bg && bg.a > 0) || stroke) push({ kind: 'shape', ...b, fill: bg && bg.a > 0 ? hex(bg) : null, stroke, radius, opacity: op, name: '色块' });
      for (let i = layers.length - 1; i >= 0; i--) {
        if (grads[i]) push({ kind: 'shape', ...b, fill: grads[i], stroke: null, radius, opacity: op, name: '渐变块' });
        else push({ kind: 'image', ...b, src: urls[i], fit: fitOf(splitTop(s.backgroundSize)[i] || splitTop(s.backgroundSize)[0] || 'auto'), opacity: op, name: '背景图' });
      }
    }
    function serializeSvg(svg) {
      const clone = svg.cloneNode(true), src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
      src.forEach((el, i) => { if (!(el instanceof SVGGraphicsElement) && el !== svg) return; const s = cs(el), d = dst[i]; for (const p of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family']) { const v = s.getPropertyValue(p); if (v) d.style.setProperty(p, v); } });
      for (const d of dst) { d.removeAttribute('data-vw-imp'); for (const a of [...d.attributes]) if (/^on/i.test(a.name)) d.removeAttribute(a.name); }
      for (const bad of clone.querySelectorAll('script, foreignObject')) bad.remove();
      const r = svg.getBoundingClientRect();
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(Math.max(1, Math.round(r.width)))); clone.setAttribute('height', String(Math.max(1, Math.round(r.height))));
      clone.setAttribute('color', cs(svg).color);
      return new XMLSerializer().serializeToString(clone);
    }
    async function walk(el, opacity) {
      if (SKIP.has(el.tagName)) return;
      const s = cs(el); if (s.display === 'none') return;
      const op = opacity * (el === root ? 1 : num(s.opacity === '' ? 1 : s.opacity));
      if (op <= 0.01) return;
      const hidden = s.visibility !== 'visible', r = el.getBoundingClientRect(), sized = r.width >= 0.5 && r.height >= 0.5;
      const shown = !hidden && sized && (s.display !== 'contents');
      if (items.length >= LIMIT) { if (shown && hits(r)) rest.push(el); return; }
      const reason = el === root ? null : needsShot(el, s);
      if (reason) { if (shown && owns(r)) push({ kind: 'shot', own: false, mark: mark(el), ...toBox(r), clip: raw(r), reason, name: `[截图] ${reason.split(' ')[0]}` }); return; }
      if (el.tagName === 'IMG') { if (shown && owns(r) && (el.currentSrc || el.src)) push({ kind: 'image', ...toBox(r), src: await inlineBlob(el.currentSrc || el.src), fit: /contain|scale-down|none/.test(s.objectFit) ? 'contain' : s.objectFit === 'cover' ? 'cover' : 'fill', opacity: op, name: el.alt || '图片' }); return; }
      if (el instanceof SVGSVGElement) { if (shown && owns(r)) push({ kind: 'image', ...toBox(r), svg: serializeSvg(el), fit: 'fill', opacity: op, name: '矢量图' }); return; }
      if (el instanceof SVGElement) return;
      if (el !== root && shown && (page.mode === 'fallback' ? hits(r) : owns(r))) decoration(el, s, page.mode === 'fallback' ? clipToBox(r) : r, op, elScale(el, r));
      const { parts, nodes } = textParts(el);
      const text = cleanText(parts, s.whiteSpace);
      if (text && !hidden) {
        const range = document.createRange(); let u = null; const lineRects = [];
        for (const n of nodes) { let rr; if (n.nodeType === 3) { range.selectNodeContents(n); rr = range.getBoundingClientRect(); lineRects.push(...[...range.getClientRects()].filter(x => x.width > 0 && x.height > 0)); } else rr = n.getBoundingClientRect(); if (rr.width <= 0 && rr.height <= 0) continue; u = u ? { left: Math.min(u.left, rr.left), top: Math.min(u.top, rr.top), right: Math.max(u.right, rr.right), bottom: Math.max(u.bottom, rr.bottom) } : { left: rr.left, top: rr.top, right: rr.right, bottom: rr.bottom }; }
        if (u) {
          u.width = u.right - u.left; u.height = u.bottom - u.top;
          const k = elScale(el, r), pad = side => (num(s[`padding${side}`]) + num(s[`border${side}Width`])) * k;
          const fs = num(s.fontSize), c = color(s.color) || { r: 0, g: 0, b: 0, a: 1 };
          // 行数：按文字行框的顶边分组；行高 normal 时，纯文字块按内容高度 / 行数推算，否则取 1.2
          const tops = []; for (const x of lineRects.sort((a, b) => a.top - b.top)) if (!tops.length || x.top - tops[tops.length - 1] > fs * k * 0.5) tops.push(x.top);
          const lines = Math.max(1, tops.length), pureText = !nodes.some(n => n.nodeType === 1) || [...el.children].every(ch => consumedBy.has(ch));
          let lh = s.lineHeight === 'normal' ? 1.2 : num(s.lineHeight) / (fs || 16);
          if (s.lineHeight === 'normal' && pureText && !/flex|grid/.test(s.display)) { const m = (r.height - pad('Top') - pad('Bottom')) / lines / (fs * k || 16); if (m >= 1 && m <= 1.6) lh = m; }
          let left = r.left + pad('Left'), right = r.right - pad('Right');
          if (/flex|grid/.test(s.display) || right - left <= 0) { left = u.left; right = u.right + 2 * k; }
          // 文字框以字形中心对齐原位置，高度 = 行数 × 行高，这样换成工作台的行高排法后位置不跑
          const lineBox = lh * fs * k, boxH = Math.max(u.height, lines * lineBox);
          const box2 = { left, top: u.top + u.height / 2 - boxH / 2, width: Math.max(right - left, u.width), height: boxH };
          if (owns({ ...box2, right: box2.left + box2.width, bottom: box2.top + box2.height })) {
            const sh = s.textShadow && s.textShadow !== 'none' ? splitTop(s.textShadow)[0] : null;
            let shadow = null; if (sh) { const cm = /(rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(sh), lens = sh.replace(cm?.[0] || '', '').trim().split(/\s+/).map(num); const sc = color(cm?.[0] || s.color); if (sc && sc.a > 0) shadow = { color: hex(sc), x: round((lens[0] || 0) * k * scale), y: round((lens[1] || 0) * k * scale), blur: round(Math.max(0, lens[2] || 0) * k * scale) }; }
            const sw = num(s.webkitTextStrokeWidth), scol = color(s.webkitTextStrokeColor);
            const heading = el.closest('h1, h2, h3');
            push({ kind: 'text', ...toBox(box2), text, fontSize: round(fs * k * scale), fontWeight: Math.max(100, Math.min(900, Math.round((num(s.fontWeight) || 400) / 100) * 100)), color: hex(c), family: (splitTop(s.fontFamily)[0] || '').replace(/^['"]|['"]$/g, ''), lineHeight: round(Math.max(0.5, Math.min(5, lh)), 3), letterSpacing: s.letterSpacing === 'normal' ? 0 : round(num(s.letterSpacing) * k * scale, 2), align: /center/.test(s.textAlign) ? 'center' : /right|end/.test(s.textAlign) ? 'right' : 'left', shadow, stroke: sw > 0 && scol && scol.a > 0 ? { color: hex(scol), width: round(sw * k * scale, 2) } : null, opacity: op, heading: heading ? Number(heading.tagName[1]) : 0 });
          }
        }
      }
      for (const c of el.children) if (!consumedBy.has(c)) await walk(c, op);
    }
    await walk(root, 1);
    let limited = null;
    if (rest.length) {
      let u = null; for (const el of rest) { const r = el.getBoundingClientRect(); u = u ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }
      const c = clipToBox({ ...u, width: u.right - u.left, height: u.bottom - u.top });
      if (c.width > 0 && c.height > 0) { items.push({ kind: 'shot', own: false, marks: rest.map(mark), ...toBox(c), clip: raw(c), reason: '超出元素上限的剩余部分', name: '[截图] 剩余部分' }); limited = rest.length; }
    }
    return { items, background, bgGradient, clue, limited, box: { width: box.width, height: box.height }, scale, fonts: fontInfo(), doc: { width: Math.max(document.documentElement.scrollWidth, innerWidth), height: Math.max(document.documentElement.scrollHeight, innerHeight) } };
  }

  // ---------- 截图时只显示目标 ----------
  function shotOn({ marks, own, background }) {
    let st = document.getElementById('vw-import-shot');
    if (!st) { st = document.createElement('style'); st.id = 'vw-import-shot'; document.head.append(st); }
    st.textContent = `html.vw-shot body *{visibility:hidden!important;caret-color:transparent!important}html.vw-shot [data-vw-show],html.vw-shot [data-vw-show] *{visibility:visible!important}html.vw-shot [data-vw-own]{visibility:visible!important}${background ? `html.vw-shot,html.vw-shot body{background:${background}!important}` : ''}`;
    for (const m of marks) { const el = document.querySelector(`[data-vw-imp="${m}"]`); if (el) el.setAttribute(own ? 'data-vw-own' : 'data-vw-show', ''); }
    document.documentElement.classList.add('vw-shot');
  }
  function shotOff() { document.documentElement.classList.remove('vw-shot'); for (const el of document.querySelectorAll('[data-vw-show],[data-vw-own]')) { el.removeAttribute('data-vw-show'); el.removeAttribute('data-vw-own'); } }
  window.__vwImport = { detect, isolate, analyze, shotOn, shotOff, scroll: () => ({ x: scrollX, y: scrollY }) };
}
