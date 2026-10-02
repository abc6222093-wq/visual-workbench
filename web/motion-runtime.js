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
export function createMotionContext(project, page, root, signal, assetBase) {
  const projectSnapshot = freeze(clone(project));
  const pageSnapshot = freeze(clone(page));
  const animations = new Set();
  let currentStep = -1;
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
      return animation.finished;
    },
    timer(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error('timer(ms) 必须是非负有限数');
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason || new DOMException('已取消', 'AbortError'));
        const id = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
        function cancel() { clearTimeout(id); reject(signal.reason || new DOMException('已取消', 'AbortError')); }
        signal.addEventListener('abort', cancel, { once: true });
      });
    },
    async importModule(path) {
      if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('importModule 需要本地绝对路径');
      const url = new URL(path, location.origin);
      if (url.origin !== location.origin) throw new Error('只能导入同源本地模块');
      return import(url.href);
    },
    assetUrl(file) {
      if (typeof file !== 'string' || ![...(projectSnapshot.assets || []), ...(projectSnapshot.fonts || [])].some(item => item.file === file)) throw new Error(`未登记的项目资源：${file}`);
      const base = String(assetBase || `/data/projects/${encodeURIComponent(projectSnapshot.id)}`).replace(/\/$/, '');
      return new URL(`${base}/${file.split('/').map(encodeURIComponent).join('/')}`, location.href).href;
    }
  };
  return { context, setStep: value => { currentStep = value; }, cleanup: abort };
}
export async function loadMotion(project, page, root, signal, assetBase) {
  if (project.formatVersion !== 2) throw new Error('旧版项目格式，请迁移到格式版本 2 后检查动效');
  if (Object.hasOwn(page, 'steps')) throw new Error('页面仍使用旧版 steps 动效，请迁移到 motion');
  if (page.motion !== undefined && (!page.motion || !Number.isInteger(page.motion.steps) || page.motion.steps < 0 || typeof page.motion.source !== 'string' || !page.motion.source.trim())) throw new Error('页面 motion 需要非负整数 steps 和非空 source');
  const { context, setStep, cleanup } = createMotionContext(project, page, root, signal, assetBase);
  if (page.motion === undefined) return { handlers: {}, context, setStep, cleanup };
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
  return { handlers, context, setStep, cleanup };
}
