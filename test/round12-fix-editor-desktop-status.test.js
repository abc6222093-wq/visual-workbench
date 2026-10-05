// 第 12 轮修正（任务 5）：认出旧版桌面应用（docs/round12-contract.md 约定 3）。纯函数，直接在 Node 里测。
import test from 'node:test';import assert from 'node:assert/strict';
import {desktopShellStatus} from '../web/runtime-settings.js';
const electron='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) visual-workbench-desktop/0.1.0 Chrome/138.0.7204.100 Electron/44.0.0 Safari/537.36';
const chrome='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
test('round12 修正 桌面应用版本：Electron 没有标记 = 旧版；带 0.2.0 标记 = 新版；普通浏览器不是桌面应用',()=>{
 assert.deepEqual(desktopShellStatus(electron),{desktop:true,version:null,outdated:true});
 assert.deepEqual(desktopShellStatus(`${electron} VisualWorkbenchDesktop/0.2.0`),{desktop:true,version:'0.2.0',outdated:false});
 assert.deepEqual(desktopShellStatus(`${electron} VisualWorkbenchDesktop/0.10.1`),{desktop:true,version:'0.10.1',outdated:false});
 assert.deepEqual(desktopShellStatus(`${electron} VisualWorkbenchDesktop/0.1.9`),{desktop:true,version:'0.1.9',outdated:true});
 assert.deepEqual(desktopShellStatus(chrome),{desktop:false,version:null,outdated:false});
 assert.deepEqual(desktopShellStatus(''),{desktop:false,version:null,outdated:false});
 assert.deepEqual(desktopShellStatus(undefined),{desktop:false,version:null,outdated:false});
});
