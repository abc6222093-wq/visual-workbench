// 工作台与磁盘之间的同步逻辑：三方合并 + 同步控制器。
// 纯 JS 模块，浏览器和 Node 测试都能直接 import，不引用 window / document。

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// 深度比较；对象键顺序无关，值为 undefined 的键视为不存在（与 JSON 一致）
export function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every(k => b[k] !== undefined && deepEqual(a[k], b[k]));
  }
  return false;
}

// 数组里每一项都是带唯一字符串 id 的对象（空数组也算）
function isIdArray(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const item of value) {
    if (!isObj(item) || typeof item.id !== 'string' || seen.has(item.id)) return false;
    seen.add(item.id);
  }
  return true;
}

function conflict(ctx, path, local, remote) {
  ctx.conflicts.push({ path: [...path], local, remote });
  return ctx.prefer === 'remote' ? remote : local;
}

// 页面的 motion（steps + source）整体当成一个值：source 是一段完整的代码，绝不能逐字合并或截断，
// steps 与 source 也必须配套。动效只归 agent 写，所以双方都改了时整体取磁盘（agent）的那份并记冲突。
const isMotionPath = path => path.length === 3 && path[0] === 'pages' && path[2] === 'motion';

function mergeValue(base, local, remote, path, ctx) {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(local, base)) return remote;
  if (deepEqual(remote, base)) return local;
  if (isMotionPath(path)) {
    ctx.conflicts.push({ path: [...path], local, remote });
    return remote;
  }
  // base 不是同类容器（例如双方都新增了这个键）时，按空容器逐项合并，冲突粒度更细
  if (isObj(local) && isObj(remote)) return mergeObject(isObj(base) ? base : {}, local, remote, path, ctx);
  if (isIdArray(local) && isIdArray(remote)) return mergeIdArray(isIdArray(base) ? base : [], local, remote, path, ctx);
  return conflict(ctx, path, local, remote);
}

function mergeObject(base, local, remote, path, ctx) {
  const out = {};
  // 键顺序以 local 为主，减少保存回磁盘时的无谓差异
  const keys = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  for (const key of keys) {
    const value = path.length === 0 && key === 'updatedAt'
      ? remote.updatedAt // 顶层 updatedAt 永远取磁盘的，不算冲突
      : mergeValue(base[key], local[key], remote[key], [...path, key], ctx);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// 只看双方都有的项，local 的相对顺序是否和 base 一致
function sameRelativeOrder(base, local) {
  const inBase = new Set(base.map(item => item.id));
  const inLocal = new Set(local.map(item => item.id));
  const a = base.map(item => item.id).filter(id => inLocal.has(id));
  const b = local.map(item => item.id).filter(id => inBase.has(id));
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function mergeIdArray(base, local, remote, path, ctx) {
  const B = new Map(base.map(item => [item.id, item]));
  const L = new Map(local.map(item => [item.id, item]));
  const R = new Map(remote.map(item => [item.id, item]));
  const ids = new Set([...L.keys(), ...R.keys(), ...B.keys()]);
  const merged = new Map();
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), r = R.get(id), p = [...path, id];
    let value;
    if (l && r) value = mergeValue(b, l, r, p, ctx);
    else if (l) value = !b ? l : deepEqual(l, b) ? undefined : conflict(ctx, p, l, undefined); // agent 删除
    else if (r) value = !b ? r : deepEqual(r, b) ? undefined : conflict(ctx, p, undefined, r); // エイ 删除
    if (value !== undefined) merged.set(id, value);
  }
  // 顺序：エイ 没调过顺序就用 agent 的顺序，否则用 エイ 的；另一方独有的项按它在自己那边的前一个兄弟插入
  const localKept = sameRelativeOrder(base, local);
  const primary = localKept ? remote : local;
  const secondary = localKept ? local : remote;
  const order = primary.map(item => item.id).filter(id => merged.has(id));
  const placed = new Set(order);
  secondary.forEach((item, index) => {
    if (!merged.has(item.id) || placed.has(item.id)) return;
    let at = 0;
    for (let j = index - 1; j >= 0; j--) {
      const prev = secondary[j].id;
      if (placed.has(prev)) { at = order.indexOf(prev) + 1; break; }
    }
    order.splice(at, 0, item.id);
    placed.add(item.id);
  });
  return order.map(id => merged.get(id));
}

const PROP_NAMES = {
  x: '位置', y: '位置', width: '大小', height: '大小', rotation: '旋转', opacity: '透明度',
  zIndex: '层级', text: '文字', color: '颜色', fill: '填充', font: '字体', fontSize: '字号',
  fontWeight: '字重', background: '背景', name: '名称', motion: '动效代码',
};
const COLLECTION_NAMES = { steps: '动效', assets: '素材', fonts: '字体' };

// 生成给 エイ 看的冲突位置描述
function conflictLabel(conflict, trees) {
  const { path } = conflict;
  const parts = path[0] === 'pages' ? [] : ['项目'];
  let cursors = trees;
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const lists = cursors.map(node => (isObj(node) ? node[key] : undefined));
    if (i + 1 < path.length && lists.some(Array.isArray)) {
      const id = path[i + 1];
      const items = lists.map(list => (Array.isArray(list) ? list.find(item => item?.id === id) : undefined));
      const item = items.find(Boolean) || {};
      if (key === 'pages') {
        // 页码按 merged 的页序；merged 里没有（被删）就看其他版本
        let n = 0;
        for (const list of lists) {
          if (!Array.isArray(list)) continue;
          const index = list.findIndex(page => page?.id === id);
          if (index >= 0) { n = index + 1; break; }
        }
        parts.push(`第 ${n} 页`);
      } else if (key === 'elements' || key === 'children') {
        parts.push(item.name || id);
      } else if (key === 'fonts') {
        parts.push(`字体 ${item.family || item.name || id}`);
      } else {
        parts.push(`${COLLECTION_NAMES[key] || PROP_NAMES[key] || key} ${item.name || id}`);
      }
      cursors = items;
      i++;
    } else {
      parts.push(PROP_NAMES[key] || key);
      cursors = lists;
    }
  }
  const deletion = (conflict.local === undefined) !== (conflict.remote === undefined);
  return parts.join(' · ') + (deletion ? '（一方删除）' : '');
}

/**
 * 三方合并项目。
 * base：上次与磁盘一致时的项目；local：エイ 界面里的项目；remote：磁盘上的项目。
 * 不修改入参，返回 { merged, conflicts }。
 */
export function mergeProjects(base, local, remote, { prefer = 'local' } = {}) {
  const ctx = { prefer, conflicts: [] };
  let merged = mergeValue(base, local, remote, [], ctx);
  // 合并结果与入参共享引用，统一深拷贝一次
  merged = structuredClone(merged);
  const trees = [merged, local, remote, base];
  const conflicts = ctx.conflicts.map(item => ({
    path: item.path,
    label: conflictLabel(item, trees),
    local: structuredClone(item.local),
    remote: structuredClone(item.remote),
  }));
  return { merged, conflicts };
}

// 冲突位置去重（保持首次出现顺序），用于提示 エイ
export function summarizeConflicts(conflicts) {
  return [...new Set(conflicts.map(item => item.label))];
}

const withoutUpdatedAt = project => {
  if (!isObj(project)) return project;
  const { updatedAt, ...rest } = project;
  return rest;
};

/**
 * 同步控制器：收到「磁盘变了」后，在 エイ 不忙的时候取回磁盘版本、三方合并、交给界面应用。
 */
export function createSyncController({
  isBusy,
  getLocal,
  fetchRemote,
  apply,
  onError = () => {},
  retryMs = 300,
  maxRetries = 5,
  // 默认定时器必须包一层：浏览器里 setTimeout 不能当成别的对象的方法来调用（会报 Illegal invocation）
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
} = {}) {
  let disposed = false;
  let pending = false;
  let running = false;
  let kicked = false; // 已排进微任务、马上要跑
  let timer = null;
  let requested = 0; // 每次 notify 加一，用来判断尝试期间有没有新的通知
  let failures = 0;
  let waiters = [];

  const idle = () => !running && !pending;
  function release() {
    if (!idle() && !disposed) return;
    const list = waiters;
    waiters = [];
    list.forEach(resolve => resolve());
  }
  function later() {
    if (disposed) return;
    timers.clear(timer);
    timer = timers.set(() => { timer = null; attempt(); }, retryMs);
  }
  function kick() {
    if (disposed || kicked || running || timer != null) return;
    kicked = true;
    queueMicrotask(() => { kicked = false; attempt(); });
  }

  async function attempt() {
    if (disposed || running || !pending) return;
    if (isBusy()) { later(); return; } // エイ 正忙：不取数据，稍后再看
    running = true;
    const seen = requested;
    let retry = false;
    try {
      let remote;
      try {
        remote = await fetchRemote();
      } catch (error) {
        failures++;
        onError(error);
        if (failures <= maxRetries) retry = true;
        else { failures = 0; pending = false; } // 连续失败太多次，放弃，等下一次 notify
        return;
      }
      failures = 0;
      if (disposed) return;
      if (isBusy()) { retry = true; return; } // 等待期间 エイ 开始拖动/输入了：整个重来
      const { project, base, revision } = getLocal();
      if (remote.revision !== revision) {
        const { merged, conflicts } = mergeProjects(base, project, remote.project);
        try {
          apply({
            project: merged,
            base: remote.project,
            revision: remote.revision,
            remoteChanged: !deepEqual(merged, project),
            needsSave: !deepEqual(withoutUpdatedAt(merged), withoutUpdatedAt(remote.project)),
            conflicts,
          });
        } catch (error) {
          onError(error);
        }
      }
      if (requested === seen) pending = false;
    } finally {
      running = false;
      if (!disposed) {
        if (retry) later();
        else if (pending) kick(); // 尝试期间又来了 notify，再跑一次
      }
      release();
    }
  }

  return {
    notify() {
      if (disposed) return;
      if (!pending) failures = 0;
      pending = true;
      requested++;
      kick();
    },
    get pending() { return pending; },
    settle() {
      return new Promise(resolve => {
        waiters.push(resolve);
        release();
      });
    },
    dispose() {
      disposed = true;
      pending = false;
      timers.clear(timer);
      timer = null;
      release();
    },
  };
}
