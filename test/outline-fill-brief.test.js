import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {copyBrief} from '../web/outline-model.js';
const project=JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json',import.meta.url)));
test('填大纲说明限制只填不排，提供文档入口、数据路径和指定页',()=>{
 const text=copyBrief(project,[project.pages[1].id],'/data/projects/deck/project.json','/repo','fill','/data');
 for(const word of ['只填不排','文档的完整路径','不移动、缩放或改样式','不写或修改 motion','页数不够','elementId','UTF-16','caption','notes','/data','validate','check-motion'])assert.ok(text.includes(word),word);
 assert.ok(text.includes(project.pages[1].id));assert.ok(!text.includes(project.pages[0].id));
 assert.ok(!text.includes('N 屏写 motion.steps'));
 assert.ok(!text.includes('尚无大纲，请保留此页并说明'));
});
test('排版说明仍覆盖全部页、动效与映射，两个模式不混淆',()=>{
 const text=copyBrief(project,undefined,'project.json','/repo','layout','/data');
 for(const page of project.pages)assert.ok(text.includes(page.id));
 assert.match(text,/请按大纲排版/);assert.match(text,/motion.steps = N−1/);assert.doesNotMatch(text,/只填不排/);
 assert.throws(()=>copyBrief(project,undefined,undefined,undefined,'unknown'));
});
