const cache = new Map();

// The editor only renders static JSON. Motion checks run in a disposable iframe.
export function mountMotionStatus(project, assetBase, toolbar) {
  if (!toolbar) return;
  const chip = document.createElement('span');
  chip.className = 'g-chip';
  chip.setAttribute('role', 'status');
  chip.textContent = '正在检查动效…';
  toolbar.append(chip);
  const key = JSON.stringify(project);
  if (!cache.has(key)) {
    const promise = new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.style.cssText = `position:fixed;left:0;top:0;transform:scale(0.001);transform-origin:0 0;opacity:0.01;z-index:-1;width:${project.artboard.width}px;height:${project.artboard.height}px;border:0;pointer-events:none`;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.src = '/motion-check.html';
      const token = crypto.randomUUID();
      const done = result => {
        clearTimeout(timer);
        window.removeEventListener('message', receive);
        frame.remove();
        resolve(result);
      };
      const receive = event => {
        // Safari 里 event.source 与 frame.contentWindow 不是同一个对象，靠同源 + 一次性 token 识别
        if (event.origin !== location.origin || event.data?.type !== 'check-motion-result' || event.data?.id !== token) return;
        done(event.data.result || {ok:false,errors:[{message:event.data.error || '检查失败'}]});
      };
      const timer = setTimeout(() => done({ ok: false, errors: [{ message: '动效检查超时，请运行 check-motion 查看详情' }] }), Math.max(30000, project.pages.reduce((n, p) => n + (p.motion?.steps || 0) + 4, 0) * 10000));
      window.addEventListener('message', receive);
      frame.onload = () => frame.contentWindow.postMessage({ type: 'check-motion', id: token, project, options: { assetBase } }, location.origin);
      document.body.append(frame);
    });
    cache.set(key, promise);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
  }
  cache.get(key).then(result => {
    if (!chip.isConnected) return;
    chip.textContent = result.ok ? '动效检查通过' : '动效检查未通过';
    chip.classList.toggle('g-chip--pink', !result.ok);
    chip.title = (result.results || result.errors || []).filter(e => e.ok !== true).map(e => `${e.page || ''} ${e.variant || ''} ${e.error || e.message}`).join('\n');
    if (!result.ok) {
      const detail = document.createElement('span');
      detail.className = 'ed-note';
      detail.textContent = [...new Set((result.results || result.errors || []).filter(e => e.ok !== true).map(e => `${e.page || ''}: ${String(e.error || e.message).split('\n')[0]}`))].join('; ');
      chip.after(detail);
    }
  });
}
