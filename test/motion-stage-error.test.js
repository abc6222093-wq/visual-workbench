import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('failed initialization can leave the page forward and backward', async t => {
  const dir=mkdtempSync(join(tmpdir(),'vw-stage-error-'));
  const server=createServer({dataDir:dir});
  t.after(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await launchBrowser();t.after(()=>browser.close());
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result=await page.evaluate(async()=>{
    const {showMotionPage}=await import('/motion-stage.js');
    const project={formatVersion:2,artboard:{width:800,height:600},assets:[],fonts:[],pages:[
      {id:'page_before',background:'#fff',elements:[]},
      {id:'page_failed',background:'#fff',elements:[],motion:{steps:0,source:'export default () => {throw new Error("bad initialization")}' }},
      {id:'page_after',background:'#fff',elements:[]}
    ]};
    const states=[];
    for(const destination of ['page_after','page_before']) {
      const stage=document.createElement('div'),label=document.createElement('span');document.body.append(stage,label);
      const state={view:'play',project,pageId:'page_failed',playback:null};
      const errors=[];const options={stage,label,assetBase:'',onError:error=>errors.push(error.message)};
      await showMotionPage(state,'page_failed',options);
      await showMotionPage(state,destination,options);
      states.push({id:state.pageId,count:stage.querySelectorAll('[data-page-id]').length,visible:stage.querySelector('[data-page-id]')?.style.visibility,changing:state.motionChanging,errors});
      await state.playback?.destroy();stage.remove();label.remove();
    }
    return states;
  });
  for(const [i,state] of result.entries()) {
    assert.equal(state.id,i?'page_before':'page_after');assert.equal(state.count,1);assert.equal(state.visible,'visible');assert.equal(state.changing,false);
    assert.equal(state.errors.filter(message=>message.includes('bad initialization')).length,1);
  }
});
