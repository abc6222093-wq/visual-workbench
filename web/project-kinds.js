// 项目类型与网页窗口（第 11 轮）。纯常量与纯函数，浏览器端与 Node 端共用（不要引入 DOM 或 node 模块）。
// 课件 / 海报项目：kind 不写或 "deck"，所有页面共用 artboard 尺寸，行为与以前完全一样。
// 网页项目：kind "web"，每页写 device 与 size；窗口（视口）比例固定，整页高度 = 内容长度，在窗口里滚动浏览。
export const WEB_DEVICES = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900, label: '电脑端', preset: 'web-desktop' }), // 常见笔记本 / 显示器窗口
  mobile: Object.freeze({ width: 390, height: 844, label: '手机端', preset: 'web-mobile' }), // iPhone 14 / 15 逻辑像素
});
export const WEB_DEFAULT_ARTBOARD = Object.freeze({ preset: 'web-desktop', width: 1440, height: 900 });
export function projectKind(project) { return project?.kind === 'web' ? 'web' : 'deck'; }
export const isWebProject = (project) => projectKind(project) === 'web';
/** 页面自己的尺寸：网页页面用 size，其余用画板。 */
export function pageSize(project, page) {
  if (page?.size && Number.isFinite(page.size.width) && Number.isFinite(page.size.height)) return { width: page.size.width, height: page.size.height };
  return { width: project.artboard.width, height: project.artboard.height };
}
/** 页面的窗口（视口）尺寸：网页页面按设备；课件页面就是整页。 */
export function pageViewport(project, page) {
  const device = isWebProject(project) ? WEB_DEVICES[page?.device] : null;
  return device ? { width: device.width, height: device.height } : pageSize(project, page);
}
/** 新建网页页面的默认字段。 */
export function webPageDefaults(device = 'desktop', height = WEB_DEVICES[device]?.height ?? WEB_DEVICES.desktop.height) {
  const d = WEB_DEVICES[device] || WEB_DEVICES.desktop;
  return { device: d === WEB_DEVICES.mobile ? 'mobile' : 'desktop', size: { width: d.width, height: Math.max(1, Math.round(height)) } };
}
