import test from 'node:test';
import assert from 'node:assert/strict';
import {fileBaseName} from '../src/export/index.js';
test('导出文件名保留中文日文，避开 Windows 设备名与非法字符',()=>{
 for(const name of ['CON','nul','COM1','LPT9','AUX.txt'])assert.equal(fileBaseName(name),'_'+name);
 assert.equal(fileBaseName('中文 日本'),'中文 日本');assert.equal(fileBaseName('题目<>:"/\\|?*.'),'题目---------');
});
