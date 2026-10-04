// 总览「导入旧 HTML」弹窗：选项目类型（课件 / 网页）→ 选单个 .html / 文件夹 / .zip，或（网页）输入网址 →
// 项目名称、画板（课件尽量从 HTML 自动识别；网页固定电脑端 1440×900 / 手机端 390×844 窗口）→ 分块读文件、上传建任务 →
// 轮询进度（可取消）→ 完成摘要与「打开项目」。分析在服务端后台浏览器里做，这里只负责选文件和显示进度，工作台不会卡住。
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 与新建项目的画板类型同一顺序
export const IMPORT_PRESETS = [
  ['slide-16x9', '演示文稿', 1920, 1080],
  ['web-desktop', '桌面网页', 1440, 900],
  ['web-mobile', '手机网页', 390, 844],
  ['poster-a4', 'A4 海报', 2480, 3508],
  ['poster-a3', 'A3 海报', 3508, 4961],
  ['custom', '自定义', 1200, 800],
];
const CHUNK = 3 * 1024 * 1024; // 3 的倍数：每块单独转 base64 后可以直接拼接
const MB = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);

/** 从 HTML 文本猜画板：固定宽高的页面容器 > viewport 宽度 > reveal.js。猜不出返回 null。 */
export function guessArtboard(text) {
  const html = String(text || ''), pairs = new Map();
  for (const m of html.matchAll(/width\s*:\s*(\d{3,4})px\s*;\s*height\s*:\s*(\d{3,4})px|height\s*:\s*(\d{3,4})px\s*;\s*width\s*:\s*(\d{3,4})px/gi)) {
    const w = Number(m[1] || m[4]), h = Number(m[2] || m[3]); if (w < 300 || h < 300) continue;
    const key = `${w}x${h}`; pairs.set(key, (pairs.get(key) || 0) + 1);
  }
  const best = [...pairs].sort((a, b) => b[1] - a[1])[0];
  if (best) {
    const [w, h] = best[0].split('x').map(Number), exact = IMPORT_PRESETS.find(p => p[2] === w && p[3] === h);
    if (exact) return { preset: exact[0], width: w, height: h, reason: `页面容器 ${w} × ${h}` };
    if (Math.abs(w / h - 16 / 9) < 0.02) return { preset: 'slide-16x9', width: 1920, height: 1080, reason: `16:9 的页面容器（${w} × ${h}）` };
    if (Math.abs(h / w - Math.SQRT2) < 0.02) return { preset: 'poster-a4', width: 2480, height: 3508, reason: `A 系列纸张比例的页面容器（${w} × ${h}）` };
    return { preset: 'custom', width: w, height: h, reason: `页面容器 ${w} × ${h}` };
  }
  const vp = /<meta[^>]+name=["']?viewport["']?[^>]*content=["']([^"']*)["']/i.exec(html)?.[1] || /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']?viewport/i.exec(html)?.[1];
  const vw = Number(/width\s*=\s*(\d+)/.exec(vp || '')?.[1]);
  if (vw > 0 && vw <= 600) return { preset: 'web-mobile', width: vw, height: 844, reason: `viewport 宽度 ${vw}` };
  if (vw >= 1000 && vw <= 1700) return { preset: 'web-desktop', width: vw, height: 900, reason: `viewport 宽度 ${vw}` };
  if (/class=["'][^"']*\breveal\b/.test(html) || /application\/json[^>]*deck-data|deck-data[^>]*application\/json/.test(html)) return { preset: 'slide-16x9', width: 1920, height: 1080, reason: '幻灯片课件' };
  return null;
}

function ensureStyle() {
  if (document.querySelector('link[data-import-html-css]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/import-html.css'; link.dataset.importHtmlCss = ''; document.head.append(link);
}
function readChunk(blob) { return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).slice(String(fr.result).indexOf(',') + 1)); fr.onerror = () => reject(fr.error || new Error('读不了这个文件')); fr.readAsDataURL(blob); }); }

/**
 * 打开导入弹窗。api(path, method, body)：工作台的 JSON 请求；modal(html) / closeModal()：工作台弹窗；
 * onDone(projectId)：用户点「打开项目」（弹窗已关闭）；onCreated(projectId)：项目建好时（可用来刷新总览）。
 */
export function openImportDialog({ api, modal, closeModal = () => {}, notice = () => {}, onDone = () => {}, onCreated = () => {}, pollMs = 500, fetchImpl = (...args) => fetch(...args) }) {
  ensureStyle();
  const presetOptions = IMPORT_PRESETS.map(p => `<option value="${p[0]}">${p[1]} · ${p[2]} × ${p[3]}</option>`).join('');
  const host = modal(`<h2>导入旧 HTML</h2><div class="import-html">
    <form class="import-html__form">
      <fieldset class="import-html__kind"><legend>项目类型</legend>
        <label><input type="radio" name="kind" value="deck" checked> 课件 / 海报</label>
        <label><input type="radio" name="kind" value="web"> 网页</label>
      </fieldset>
      <p class="g-sheet__note" data-note-deck>自动拆页，把文字、图片、背景变成可以拖动修改的元素；原来的动画不搬，之后交给 agent 按新格式重写。导入会新建一个项目，原文件不会被修改。</p>
      <p class="g-sheet__note" data-note-web hidden>每个网页导入成「电脑端」「手机端」各一页（整页长度），导航栏、卡片、按钮等组件变成分组。只读取网页，不提交、不登录、不点击，原网站和原文件都不受影响；需要登录才能看的页面会跳过。</p>
      <fieldset class="import-html__kind" data-web-only hidden><legend>来源</legend>
        <label><input type="radio" name="source" value="files" checked> 本地网页文件</label>
        <label><input type="radio" name="source" value="urls"> 网址</label>
      </fieldset>
      <label class="g-area" data-urls hidden>网址（每行一个）<textarea name="urls" rows="4" placeholder="https://example.com/&#10;https://example.com/about"></textarea></label>
      <div class="import-html__pick" data-files>
        <label class="g-btn">选择 HTML 文件<input type="file" name="file" accept=".html,.htm,text/html" hidden></label>
        <label class="g-btn">选择文件夹<input type="file" name="folder" webkitdirectory multiple hidden></label>
        <label class="g-btn">选择 .zip<input type="file" name="zip" accept=".zip,application/zip" hidden></label>
      </div>
      <p class="import-html__chosen" data-chosen>还没有选择文件。素材都内嵌的选单个 .html；图片在旁边文件夹里的，选整个文件夹或 .zip。</p>
      <fieldset class="import-html__kind" data-web-only hidden><legend>抓取哪些窗口</legend>
        <label><input type="checkbox" name="desktop" checked> 电脑端（1440 × 900）</label>
        <label><input type="checkbox" name="mobile" checked> 手机端（390 × 844）</label>
      </fieldset>
      <label class="g-field g-field--stack"><span>项目名称</span><input name="name" required maxlength="200" placeholder="例如：旧版课件"></label>
      <label class="g-field g-field--stack" data-deck-only><span>画板类型</span><select name="preset">${presetOptions}</select></label>
      <div class="g-sheet__pair" data-deck-only><label class="g-field g-field--stack"><span>宽度</span><input name="width" type="number" min="1" max="8000" value="1920" required></label><label class="g-field g-field--stack"><span>高度</span><input name="height" type="number" min="1" max="8000" value="1080" required></label></div>
      <p class="import-html__hint" data-hint></p>
      <div class="g-sheet__actions"><button type="button" class="g-btn" data-close>取消</button><button class="g-btn g-btn--prism" type="submit" data-start disabled>开始导入</button></div>
    </form>
    <div class="import-html__run" hidden>
      <div class="import-html__bar"><div class="import-html__fill" data-fill></div></div>
      <p class="import-html__step" data-step>正在准备…</p>
      <div class="g-sheet__actions"><button type="button" class="g-btn" data-abort>取消导入</button></div>
    </div>
    <div class="import-html__done" hidden>
      <div data-summary></div>
      <div class="g-sheet__actions"><button type="button" class="g-btn" data-close>关闭</button><button type="button" class="g-btn g-btn--prism" data-open hidden>打开项目</button></div>
    </div>
  </div>`);
  const root = host?.querySelector?.('.import-html') || document.querySelector('.import-html');
  if (!root) return null;
  const $ = s => root.querySelector(s), form = $('.import-html__form'), f = form.elements;
  const state = { files: [], phase: 'pick', jobId: null, cancelled: false, abort: null, projectId: null };
  for (const b of root.querySelectorAll('[data-close]')) b.onclick = () => closeModal();
  f.preset.onchange = () => { const p = IMPORT_PRESETS.find(p => p[0] === f.preset.value); f.width.value = p[2]; f.height.value = p[3]; };
  // 项目类型 / 来源切换：网页不用选画板；网址来源不用选文件
  const mode = () => ({ kind: form.querySelector('input[name="kind"]:checked').value, source: form.querySelector('input[name="source"]:checked').value });
  const urlList = () => f.urls.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const devices = () => ['desktop', 'mobile'].filter(d => f[d].checked);
  const refresh = () => {
    const { kind, source } = mode(), web = kind === 'web', urls = web && source === 'urls';
    for (const el of root.querySelectorAll('[data-web-only]')) el.hidden = !web;
    for (const el of root.querySelectorAll('[data-deck-only]')) el.hidden = web;
    $('[data-note-web]').hidden = !web; $('[data-note-deck]').hidden = web;
    $('[data-urls]').hidden = !urls; $('[data-files]').hidden = urls; $('[data-chosen]').hidden = urls;
    if (web) $('[data-hint]').textContent = '';
    f.width.required = f.height.required = !web;
    form.querySelector('[data-start]').disabled = urls ? !urlList().length : !state.files.length;
    if (web && !devices().length) form.querySelector('[data-start]').disabled = true;
  };
  for (const r of form.querySelectorAll('input[name="kind"], input[name="source"], input[name="desktop"], input[name="mobile"]')) r.onchange = refresh;
  f.urls.oninput = () => {
    refresh();
    // 名称默认取第一个网址的域名
    let host = ''; try { host = new URL(/^[a-z]+:/i.test(urlList()[0] || '') ? urlList()[0] : `https://${urlList()[0]}`).hostname; } catch {}
    if (host && (!f.name.value.trim() || f.name.value === state.autoName)) f.name.value = state.autoName = host.slice(0, 200);
  };
  const setPreset = guess => {
    if (mode().kind === 'web') { $('[data-hint]').textContent = ''; return; }
    if (!guess) { $('[data-hint]').textContent = ''; return; } f.preset.value = guess.preset; f.width.value = guess.width; f.height.value = guess.height; $('[data-hint]').textContent = `已按 HTML 自动识别画板：${guess.reason}。可以改。`; };
  async function choose(kind, list) {
    const files = [...list]; if (!files.length) return;
    let entries, label, base;
    if (kind === 'folder') { entries = files.map(file => ({ path: file.webkitRelativePath || file.name, file })); base = (entries[0].path.split('/')[0]) || '文件夹'; label = `文件夹「${base}」，${files.length} 个文件`; }
    else { entries = [{ path: files[0].name, file: files[0] }]; base = files[0].name.replace(/\.(html?|zip)$/i, ''); label = `${kind === 'zip' ? '压缩包' : 'HTML 文件'}「${files[0].name}」`; }
    const html = entries.filter(e => /\.html?$/i.test(e.path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length || (/(^|\/)index\.html?$/i.test(b.path) ? 1 : 0) - (/(^|\/)index\.html?$/i.test(a.path) ? 1 : 0))[0];
    if (kind !== 'zip' && !html) { notice('没有找到 .html 文件'); return; }
    const total = entries.reduce((n, e) => n + e.file.size, 0);
    state.files = entries;
    $('[data-chosen]').textContent = `已选择：${label}（${MB(total)} MB）`;
    if (!f.name.value.trim() || f.name.value === state.autoName) f.name.value = state.autoName = base.slice(0, 200);
    refresh();
    setPreset(html ? guessArtboard(await html.file.slice(0, 2_000_000).text().catch(() => '')) : null);
  }
  for (const kind of ['file', 'folder', 'zip']) f[kind].onchange = () => { choose(kind, f[kind].files); f[kind].value = ''; };
  const show = phase => { state.phase = phase; form.hidden = phase !== 'pick'; $('.import-html__run').hidden = phase !== 'run'; $('.import-html__done').hidden = phase !== 'done'; };
  const progress = (value, text) => { $('[data-fill]').style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`; $('.import-html__bar').setAttribute('aria-valuenow', String(Math.round(value * 100))); if (text) $('[data-step]').textContent = text; };
  $('.import-html__bar').setAttribute('role', 'progressbar'); $('.import-html__bar').setAttribute('aria-valuemin', '0'); $('.import-html__bar').setAttribute('aria-valuemax', '100');
  const finish = (html, projectId) => { show('done'); $('[data-summary]').innerHTML = html; const open = $('[data-open]'); open.hidden = !projectId; open.onclick = () => { closeModal(); onDone(projectId); }; };
  const alive = () => root.isConnected;
  $('[data-abort]').onclick = async () => {
    state.cancelled = true; state.abort?.abort(); $('[data-abort]').disabled = true; progress(0, '正在取消…');
    if (state.jobId) { try { await api(`/api/import-html/jobs/${encodeURIComponent(state.jobId)}/cancel`, 'POST', {}); } catch {} }
    finish('<p class="import-html__msg">已取消导入，没有创建项目。</p>', null);
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const { kind, source } = mode(), web = kind === 'web', byUrl = web && source === 'urls';
    if (byUrl ? !urlList().length : !state.files.length) { notice(byUrl ? '请输入至少一个网址（每行一个）' : '请先选择 HTML 文件、文件夹或 .zip'); return; }
    if (web && !devices().length) { notice('请至少勾选电脑端或手机端中的一个'); return; }
    const name = f.name.value.trim(), width = Number(f.width.value), height = Number(f.height.value);
    if (!name || (!web && (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1))) { notice(web ? '请填写项目名称' : '请填写项目名称和画板尺寸'); return; }
    show('run'); state.cancelled = false;
    try {
      if (byUrl) {
        progress(0.08, '正在提交网址…');
        state.abort = new AbortController();
        const response = await fetchImpl('/api/import-html/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: 'web', urls: urlList(), devices: devices() }), signal: state.abort.signal });
        const created = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(created.error || `提交失败（${response.status}）`);
        state.jobId = created.jobId;
        return await poll();
      }
      // 分块读文件、转 base64，每块之间让出主线程
      const total = state.files.reduce((n, e) => n + e.file.size, 0) || 1; let done = 0;
      const parts = [web ? `{"name":${JSON.stringify(name)},"kind":"web","devices":${JSON.stringify(devices())},"files":[` : `{"name":${JSON.stringify(name)},"preset":${JSON.stringify(f.preset.value)},"width":${width},"height":${height},"files":[`];
      for (const [i, entry] of state.files.entries()) {
        parts.push(`${i ? ',' : ''}{"path":${JSON.stringify(entry.path)},"data":"`);
        for (let at = 0; at < entry.file.size; at += CHUNK) {
          if (state.cancelled || !alive()) return;
          parts.push(await readChunk(entry.file.slice(at, at + CHUNK)));
          done += Math.min(CHUNK, entry.file.size - at);
          progress(0.08 * done / total, `正在读取文件 ${MB(done)} / ${MB(total)} MB`);
        }
        parts.push('"}');
      }
      parts.push(']}');
      if (state.cancelled) return;
      progress(0.08, '正在上传到工作台…');
      state.abort = new AbortController();
      const response = await fetchImpl('/api/import-html/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Blob(parts, { type: 'application/json' }), signal: state.abort.signal });
      const created = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(created.error || `上传失败（${response.status}）`);
      state.jobId = created.jobId;
      await poll();
    } catch (error) {
      if (state.cancelled || error.name === 'AbortError') return;
      finish(`<p class="import-html__msg import-html__msg--error">导入失败：${esc(error.message)}</p>`, null);
    }
  };
  async function poll() {
    if (state.cancelled) { await api(`/api/import-html/jobs/${encodeURIComponent(state.jobId)}/cancel`, 'POST', {}).catch(() => {}); return; }
    // 轮询进度；弹窗被关掉时取消任务
    for (;;) {
      if (!alive()) { await api(`/api/import-html/jobs/${encodeURIComponent(state.jobId)}/cancel`, 'POST', {}).catch(() => {}); return; }
      if (state.cancelled) return;
      const job = await api(`/api/import-html/jobs/${encodeURIComponent(state.jobId)}`);
      if (state.cancelled) return;
      progress(0.1 + 0.9 * (job.progress || 0), job.step);
      if (job.state === 'done') { state.projectId = job.projectId; onCreated(job.projectId); finish(summaryHtml(job.summary), job.projectId); return; }
      if (job.state === 'failed') throw new Error(job.error || '导入失败');
      if (job.state === 'cancelled') { finish('<p class="import-html__msg">已取消导入，没有创建项目。</p>', null); return; }
      await new Promise(r => setTimeout(r, pollMs));
    }
  }
  refresh();
  return { root, state };
}

const DEVICE_NAMES = { desktop: '电脑端', mobile: '手机端' };
function summaryHtml(s) {
  if (s.kind === 'web') {
    const skipped = (s.skipped || []).map(x => `<li>${esc(x.url)}（${esc((x.devices || []).map(d => DEVICE_NAMES[d] || d).join('、'))}）：${esc(x.reason)}</li>`).join('');
    return `<p class="import-html__msg">导入完成，新网页项目已建好。</p><dl class="import-html__summary">
    <dt>页数</dt><dd data-sum="pages">${s.pages}</dd>
    <dt>电脑端 / 手机端</dt><dd data-sum="devices">电脑端 ${s.devices?.desktop || 0} 页，手机端 ${s.devices?.mobile || 0} 页</dd>
    <dt>分组</dt><dd data-sum="groups">${s.groups}</dd>
    <dt>元素</dt><dd data-sum="elements">${s.elements}</dd>
    <dt>截图块</dt><dd data-sum="shots">${s.shots}</dd>
    <dt>跳过的网址</dt><dd data-sum="skipped">${skipped ? `<ul class="import-html__skipped">${skipped}</ul>` : '无'}</dd>
    <dt>缺失字体</dt><dd data-sum="fonts">${s.missingFonts?.length ? esc(s.missingFonts.join('、')) : '无'}</dd>
    <dt>耗时</dt><dd>${s.seconds} 秒</dd>
  </dl>${(s.truncated || []).length ? `<p class="import-html__msg import-html__msg--warn">有网页超过 20000 像素高，下面的部分没有导入（见每页备注）。</p>` : ''}<p class="g-sheet__note">${s.source === 'urls' ? '导入时的网页快照在项目的 import/pages/ 里' : '原文件复制在项目的 import/ 文件夹里'}；import/baseline.json 是导入那一刻的项目，用来对照改动。</p>`;
  }
  const reasons = Object.entries(s.shotReasons || {}).map(([k, v]) => `${k} ×${v}`).join('、');
  return `<p class="import-html__msg">导入完成，新项目已建好。</p><dl class="import-html__summary">
    <dt>页数</dt><dd data-sum="pages">${s.pages}</dd>
    <dt>分页方式</dt><dd>${esc(s.methodLabel)}</dd>
    <dt>元素</dt><dd data-sum="elements">${s.elements}</dd>
    <dt>截图块</dt><dd data-sum="shots">${s.shots}${reasons ? `（${esc(reasons)}）` : ''}</dd>
    <dt>缺失字体</dt><dd data-sum="fonts">${s.missingFonts?.length ? esc(s.missingFonts.join('、')) : '无'}</dd>
    <dt>耗时</dt><dd>${s.seconds} 秒</dd>
  </dl>${s.message ? `<p class="import-html__msg import-html__msg--warn">${esc(s.message)}</p>` : ''}<p class="g-sheet__note">原文件复制在项目的 import/ 文件夹里；每页备注是给 agent 的迁移说明。</p>`;
}
