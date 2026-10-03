const clone = value => structuredClone(value);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function findElement(elements, id) {
  for (const element of elements || []) {
    if (element.id === id) return element;
    const child = findElement(element.children, id);
    if (child) return child;
  }
  return null;
}
function escapeId(id) { return globalThis.CSS?.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'); }
// 有限时长的动画才能 finish()；无限循环的留着继续跑
function finite(animation) {
  const end = animation.effect?.getComputedTiming?.().endTime;
  return Number.isFinite(end);
}
// 快进模式：把 root 里还在跑的有限动画（包括第三方代码直接用 Web Animations 建的）直接跳到结尾
export function finishAnimations(root) {
  if (typeof root?.getAnimations !== 'function') return;
  for (const animation of root.getAnimations({ subtree: true })) {
    if (animation.playState === 'finished' || !finite(animation)) continue;
    try { animation.finish(); } catch {}
  }
}
// options.fast：快进模式（后退到上一页时直接显示该页最后一步的画面）。
// ctx.timer 立即完成，ctx.animate 建好动画后立刻跳到结尾。
export function createMotionContext(project, page, root, signal, assetBase, { fast = false } = {}) {
  const projectSnapshot = freeze(clone(project));
  const pageSnapshot = freeze(clone(page));
  const animations = new Set();
  let currentStep = -1;
  let fastMode = !!fast;
  const abort = () => { for (const animation of animations) animation.cancel(); animations.clear(); };
  signal.addEventListener('abort', abort, { once: true });
  const context = {
    project: projectSnapshot, page: pageSnapshot, root, signal,
    get step() { return currentStep; },
    element(id) {
      const base = findElement(pageSnapshot.elements, id);
      if (!base) throw new Error(`动效引用了不存在的元素：${id}`);
      const node = root?.querySelector(`[data-element-id="${escapeId(id)}"]`);
      if (!node) throw new Error(`放映页面缺少元素节点：${id}`);
      return { node, base };
    },
    animate(node, keyframes, options) {
      if (signal.aborted) return Promise.reject(signal.reason || new DOMException('已取消', 'AbortError'));
      if (!node || typeof node.animate !== 'function') throw new Error('animate 需要可动画的 DOM 节点');
      const animation = node.animate(keyframes, options);
      animations.add(animation);
      if (fastMode) {
        // 无限循环的动画不会结束，快进时不等它
        if (!finite(animation)) return Promise.resolve(animation);
        try { animation.finish(); } catch {}
      }
      return animation.finished;
    },
    timer(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error('timer(ms) 必须是非负有限数');
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason || new DOMException('已取消', 'AbortError'));
        if (fastMode) return resolve();
        const id = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
        function cancel() { clearTimeout(id); reject(signal.reason || new DOMException('已取消', 'AbortError')); }
        signal.addEventListener('abort', cancel, { once: true });
      });
    },
    async importModule(path) {
      if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('importModule 需要本地绝对路径');
      // 导出的单文件放映版：库已打包进文件，按路径从文件内的模块表取
      const exported = globalThis.__VW_EXPORT__;
      if (typeof exported?.importModule === 'function') return exported.importModule(path);
      const url = new URL(path, location.origin);
      if (url.origin !== location.origin) throw new Error('只能导入同源本地模块');
      return import(url.href);
    },
    assetUrl(file) {
      if (typeof file !== 'string' || ![...(projectSnapshot.assets || []), ...(projectSnapshot.fonts || [])].some(item => item.file === file)) throw new Error(`未登记的项目资源：${file}`);
      if (typeof globalThis.__VW_EXPORT__?.resolveAsset === 'function') return globalThis.__VW_EXPORT__.resolveAsset(file);
      const base = String(assetBase || `/data/projects/${encodeURIComponent(projectSnapshot.id)}`).replace(/\/$/, '');
      return new URL(`${base}/${file.split('/').map(encodeURIComponent).join('/')}`, location.href).href;
    }
  };
  return { context, setStep: value => { currentStep = value; }, setFast: value => { fastMode = !!value; }, cleanup: abort };
}
export async function loadMotion(project, page, root, signal, assetBase, options = {}) {
  if (project.formatVersion !== 2) throw new Error('旧版项目格式，请迁移到格式版本 2 后检查动效');
  if (Object.hasOwn(page, 'steps')) throw new Error('页面仍使用旧版 steps 动效，请迁移到 motion');
  if (page.motion !== undefined && (!page.motion || !Number.isInteger(page.motion.steps) || page.motion.steps < 0 || typeof page.motion.source !== 'string' || !page.motion.source.trim())) throw new Error('页面 motion 需要非负整数 steps 和非空 source');
  const { context, setStep, setFast, cleanup } = createMotionContext(project, page, root, signal, assetBase, options);
  if (page.motion === undefined) return { handlers: {}, context, setStep, setFast, cleanup };
  const source = page.motion.source;
  if (typeof source !== 'string') throw new Error('motion.source 必须是 ES module 字符串');
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(source + `\n// instance:${crypto.randomUUID()}`)}`;
  const module = await import(url);
  if (signal.aborted) throw signal.reason || new DOMException('已取消', 'AbortError');
  if (typeof module.default !== 'function') throw new Error('动效模块必须 default export 一个函数');
  const handlers = await module.default(context);
  if (!handlers || typeof handlers !== 'object') throw new Error('动效模块必须返回 handlers 对象');
  for (const name of ['step', 'transition', 'dispose']) if (handlers[name] !== undefined && typeof handlers[name] !== 'function') throw new Error(`${name} 必须是函数`);
  if (page.motion.steps > 0 && typeof handlers.step !== 'function') throw new Error('有步骤的动效必须提供 step(index)');
  return { handlers, context, setStep, setFast, cleanup };
}
