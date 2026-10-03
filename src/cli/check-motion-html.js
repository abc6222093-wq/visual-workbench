// 检查导出的放映版单文件：用 file:// 直接打开，调用文件里内嵌的 vwCheckMotion()（与工作台同一套检查逻辑）。
// 每页用独立浏览器并设总时限，卡死的页面会被强制结束；除 file: / data: / blob: 外的请求一律拦下，确认离线可用。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchBrowserServer } from '../browser.js';

/** 从导出的 .html 里取出项目数据 */
export function readExportedProject(file) {
  const html = readFileSync(file, 'utf8');
  const match = /<script type="application\/json" id="vw-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('这个文件不是视觉工作台导出的放映版');
  const project = JSON.parse(match[1]).project;
  if (!project || !Array.isArray(project.pages)) throw new Error('放映文件里的项目数据不完整');
  return project;
}

export async function checkExportedHtml({ input, timeout, totalTimeout }) {
  let project;
  try { project = readExportedProject(input); }
  catch (error) { console.error(`无法读取放映文件：${error.message}`); process.exitCode = 1; return; }
  const url = `${pathToFileURL(input).href}#vw-check`;
  let failures = 0, successes = 0, announced = false, noBrowser = null;
  for (const item of project.pages) {
    const pageId = item.id;
    const total = totalTimeout || Math.max(10000, 2 * ((item.motion?.steps || 0) + 4) * timeout);
    let browser, browserServer, timer, timedOut = false;
    const errors = [];
    try {
      ({ server: browserServer, browser } = await launchBrowserServer());
      if (!announced) { console.log(`用 ${browser.vwName} 检查`); announced = true; }
      const page = await browser.newPage();
      await page.route('**/*', route => /^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const result = await Promise.race([
        (async () => {
          await page.goto(url);
          await page.waitForFunction(() => typeof window.vwCheckMotion === 'function' && window.vwReady, null, { timeout: total });
          return page.evaluate(async ({ pageId, timeout }) => window.vwCheckMotion({ pageId, timeout }), { pageId, timeout });
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`总时限 ${total} ms 已到`)); }, total); })
      ]).finally(() => clearTimeout(timer));
      for (const row of result.results) { console.log(`${row.ok ? '✓' : '✗'} ${row.page} [${row.variant}]${row.ok ? '' : `: ${row.error}`}`); if (row.ok) successes++; else failures++; }
      for (const error of errors) { console.error(`✗ ${pageId} 浏览器错误: ${error}`); failures++; }
    } catch (error) {
      if (error.code === 'NO_BROWSER') { noBrowser = error; break; }
      console.error(`✗ ${pageId}: ${error.message}`); failures++;
    } finally {
      clearTimeout(timer);
      if (browser && !timedOut) await Promise.race([browser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
      if (browserServer) {
        if (timedOut) await browserServer.kill().catch(() => {});
        await Promise.race([browserServer.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
      }
    }
  }
  if (noBrowser) { console.error(noBrowser.message); process.exitCode = 1; }
  else if (failures) process.exitCode = 1;
  else console.log(`动效检查通过：${successes} 项（放映文件）`);
}
