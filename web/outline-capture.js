import { renderPage } from './render.js';
import { applyStepView } from './step-view.js';

export function nodeIsVisible(node, root) {
  const visibility = getComputedStyle(node).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (let current = node; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (current === root) return true;
  }
  return false;
}
function flatten(elements) {
  return elements.flatMap(element => element.type === 'group' ? flatten(element.children || []) : [element]);
}
/** Run actual motion in an isolated offscreen DOM, including initialization (screen 1). */
export async function captureOutlinePage(project, page, assetBase) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
  document.body.append(holder);
  const frames = [];
  try {
    for (let count = 0; count <= (page.motion?.steps || 0); count++) {
      const root = renderPage(project, page, { assetBase });
      holder.replaceChildren(root);
      const run = applyStepView({ project, page, root, assetBase, count });
      try {
        let timeout;
        try { await Promise.race([run.ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('动效提取超时，请检查本页动效')),10000);})]); } finally {clearTimeout(timeout);}
        frames.push(flatten(page.elements || []).filter(e => e.type === 'text' || e.type === 'image').map(element => {
          const node = root.querySelector(`[data-element-id="${element.id}"]`);
          return { ...element, text: node?.textContent || '', visible: !!node && nodeIsVisible(node, root) };
        }));
      } finally { run.dispose(); }
    }
    return frames;
  } finally { holder.remove(); }
}
