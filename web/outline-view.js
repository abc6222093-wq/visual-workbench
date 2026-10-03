import { renderPage } from './render.js';
import { captureOutlinePage } from './outline-capture.js';
import * as model from './outline-model.js';
const roles = { title: '大标题', subtitle: '小标题', english: '英文副标题', body: '正文', note: '注释' };
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
export function adjustEmphasis(before, after, ranges = []) {
  let start=0;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let end=before.length, nextEnd=after.length;
  while(end>start&&nextEnd>start&&before[end-1]===after[nextEnd-1]){end--;nextEnd--;}
  const delta=nextEnd-end;
  return ranges.map(r=>({start:r.start>=end?r.start+delta:r.start>start?start:r.start,end:r.end>=end?r.end+delta:r.end>start?nextEnd:r.end})).filter(r=>r.end>r.start&&r.start>=0&&r.end<=after.length).sort((a,b)=>a.start-b.start).reduce((merged,range)=>{const last=merged.at(-1);if(last&&last.end>=range.start)last.end=Math.max(last.end,range.end);else merged.push(range);return merged;},[]);
}
export function markedText(row) {
  const text = row.text || '';
  const spans = (row.emphasis || []).flatMap(range => [range.start, range.end]);
  let output = '';
  for (let i = 0; i < text.length; i++) {
    if (spans.includes(i) && (row.emphasis || []).some(r => r.start === i)) output += '<mark>';
    output += esc(text[i]);
    if ((row.emphasis || []).some(r => r.end === i + 1)) output += '</mark>';
  }
  return output;
}
// A quiet page-shaped sketch shows content weight; editing controls live below it.
function composition(project, page, screen, assetUrl) {
  const outline = page.outline;
  if (!outline?.rows.length && !outline?.images.length) return '<p class="ed-note">从这里写下这一页的文案</p>';
  return (outline.rows || []).filter(row => model.isVisible(row, screen) || row.until === screen).map(row =>
    `<div class="outline-sketch-${esc(row.role)} ${model.isVisible(row,screen) ? '' : 'outline-row-hidden'}">${row.until===screen ? '<small>本屏消失 · </small>' : row.from===screen && screen>1 ? '<small>本屏新增 · </small>' : ''}${markedText(row)}</div>`
  ).join('') + (outline.images || []).filter(image => model.isVisible(image, screen)).map(image => {
    const asset = project.assets.find(a => a.id === image.asset);
    return `<div class="outline-sketch-image">${asset ? `<img src="${esc(assetUrl?.(asset.file) || '')}" alt="">` : ''}<span>${esc(image.caption)}</span></div>`;
  }).join('');
}
export function mountOutlineView(options) {
  const { host, getProject, mutate, notice = () => {} } = options;
  let disposed = false, busy = false, unapplied = [];
  const screens = new Map(), checked = new Set();
  const controller = new AbortController();
  const current = page => Math.min(screens.get(page.id) || 1, page.outline?.screens || 1);
  function edit(pageId, change, redraw = true) {
    mutate(project => {
      const page = project.pages.find(p => p.id === pageId);
      page.outline ||= { screens: 1, rows: [], images: [], notes: '' };
      change(page.outline, page, project);
    });
    if (redraw) refresh();
  }
  function button(action, label, extras = '') { return `<button class="g-btn" data-outline-action="${action}" ${extras}>${label}</button>`; }
  function refresh() {
    if (disposed) return;
    const project = getProject();
    // Autosave/external updates must not replace an active textarea or its selection.
    if (host.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) return;
    host.innerHTML = `<div class="outline-toolbar">${button('add-page','添加页面')}${button('extract','从画布提取大纲')}${button('apply','把文字改动应用到画布')}${button('copy-all','复制全部给 agent')}${button('copy-selected','复制选中页给 agent')}<span data-outline-status role="status"></span></div><div class="outline-report" role="status">${unapplied.length?`<p>以下改动需要 agent 排版：</p><ul>${unapplied.map(change=>`<li>${esc(change.pageId)} · ${esc(change.id||'页面')} · ${esc(({new:'新增内容',deleted:'删除内容',role:'文字角色',emphasis:'强调',from:'出现屏',until:'消失屏',visibleOn:'显示屏',image:'图片与说明',screens:'屏数','missing-element':'对应元素已删除','text-conflict':'画布文字另有修改，已保留','unmapped-baseline':'缺少排版基准'})[change.type]||change.type)}</li>`).join('')}</ul>${button('copy-all','复制修改说明给 agent')}`:''}</div><div class="outline-pages">${project.pages.map((page, index) => {
      const outline = page.outline, screen = current(page);
      return `<article class="outline-page" data-outline-page="${page.id}"><header><input type="checkbox" data-outline-check ${checked.has(page.id)?'checked':''} aria-label="选择 ${esc(page.name)}"><input data-outline-field="page-name" value="${esc(page.name)}" aria-label="页面名称"><span>${index + 1}</span>${button('up','↑', index ? '' : 'disabled')}${button('down','↓', index < project.pages.length - 1 ? '' : 'disabled')}${button('delete-page','删除页', project.pages.length > 1 ? '' : 'disabled')}</header><div class="outline-pair"><div class="outline-column"><div class="outline-composition" data-outline-composition style="aspect-ratio:${project.artboard.width}/${project.artboard.height}">${composition(project,page,screen,options.assetUrl)}</div><section class="outline-card"><div class="outline-screens"><label>第 <select data-outline-screen>${Array.from({length:outline?.screens || 1},(_,i)=>`<option value="${i+1}" ${i+1===screen?'selected':''}>${i+1}</option>`).join('')}</select> 屏</label>${button('screen-add','添加下一屏')}</div>${!outline ? '<p class="ed-note">尚无大纲。可添加文字，或从排版提取。</p>' : ''}<div class="outline-rows">${(outline?.rows || []).filter(row=>model.isVisible(row,screen)||row.until===screen).map(row => {
        const visible = model.isVisible(row, screen);
        return `<div class="outline-row outline-role-${esc(row.role)} ${visible?'':'outline-row-hidden'}" data-outline-row="${row.id}"><div class="outline-row-tools"><select data-outline-field="role" aria-label="文字角色">${Object.entries(roles).map(([key,label])=>`<option value="${key}" ${row.role===key?'selected':''}>${label}</option>`).join('')}</select><span>${row.from===screen?'新出现':''}${row.until===screen?'本屏消失':''}${!visible?' · 当前不显示':''}</span>${button('emphasis','强调选中文字')}${button('disappear',row.until===screen?'恢复显示':'从本屏消失')}${button('delete-row','删除')}</div><div class="outline-text-editor"><textarea data-outline-field="text" aria-label="${roles[row.role]}文字">${esc(row.text)}</textarea><div class="outline-marked" aria-hidden="true">${markedText(row)}</div></div></div>`;
      }).join('')}</div>${button('add-row','添加文字')}<div class="outline-images">${(outline?.images || []).filter(image=>model.isVisible(image,screen)||image.until===screen).map(image => {
        const asset = project.assets.find(a=>a.id===image.asset);
        return `<div data-outline-image="${image.id}" class="outline-image ${model.isVisible(image,screen)?'':'outline-row-hidden'}">${asset?`<img src="${esc(options.assetUrl?.(asset.file) || '')}" alt="">`:''}<input data-outline-field="caption" aria-label="图片说明" value="${esc(image.caption)}">${button('image-disappear',image.until===screen?'恢复显示':'从本屏消失')}${button('delete-image','删除图片')}</div>`;
      }).join('')}</div>${button('add-image','从素材库添加图片')}<label class="outline-notes">给 agent 的页面备注<textarea data-outline-field="notes">${esc(outline?.notes || '')}</textarea></label></section></div>${page.elements?.length?'<aside class="outline-layout"><span>实际排版</span><div data-outline-thumbnail></div></aside>':''}</div></article>`;
    }).join('')}</div>`;
    for (const card of host.querySelectorAll('[data-outline-page]')) {
      const page = project.pages.find(p=>p.id===card.dataset.outlinePage);
      const thumbnail = card.querySelector('[data-outline-thumbnail]');
      if (thumbnail) {
        const root = renderPage(project,page,{assetBase:options.assetBase});
        root.style.transformOrigin = 'top left';
        root.style.transform = `scale(${240/project.artboard.width})`;
        thumbnail.style.height = `${240*project.artboard.height/project.artboard.width}px`;
        thumbnail.append(root);
      }
    }
  }
  function locate(target) {
    const card = target.closest('[data-outline-page]');
    const page = getProject().pages.find(p=>p.id===card?.dataset.outlinePage);
    return { page, rowId:target.closest('[data-outline-row]')?.dataset.outlineRow, imageId:target.closest('[data-outline-image]')?.dataset.outlineImage };
  }
  host.addEventListener('input', event => {
    const field = event.target.dataset.outlineField;
    if (!field) return;
    const {page,rowId,imageId}=locate(event.target);
    if (!page) return;
    edit(page.id,(outline,p)=>{
      if (field==='page-name') p.name=event.target.value;
      else if(field==='notes') outline.notes=event.target.value;
      else if(field==='caption') outline.images.find(r=>r.id===imageId).caption=event.target.value;
      else { const row=outline.rows.find(r=>r.id===rowId); if(field==='text'){row.emphasis=adjustEmphasis(row.text,event.target.value,row.emphasis);}row[field]=event.target.value; }
    },false);
    if(field==='text') event.target.nextElementSibling.innerHTML=markedText(getProject().pages.find(p=>p.id===page.id).outline.rows.find(r=>r.id===rowId));
    const sketch=event.target.closest('[data-outline-page]').querySelector('[data-outline-composition]');
    sketch.innerHTML=composition(getProject(),getProject().pages.find(p=>p.id===page.id),current(page),options.assetUrl);
  },{signal:controller.signal});
  host.addEventListener('change',event=>{
    if(event.target.dataset.outlineField==='role') refresh();
    if(event.target.matches('[data-outline-check]')){const {page}=locate(event.target);if(event.target.checked)checked.add(page.id);else checked.delete(page.id);}
    if(event.target.matches('[data-outline-screen]')) { const {page}=locate(event.target); screens.set(page.id,Number(event.target.value)); refresh(); }
  },{signal:controller.signal});
  host.addEventListener('click',async event=>{
    const target=event.target.closest('[data-outline-action]');
    if(!target || busy) return;
    const action=target.dataset.outlineAction, {page,rowId,imageId}=locate(target);
    try {
      if(action==='emphasis') {
        const textarea=target.closest('[data-outline-row]').querySelector('textarea');
        const start=textarea.selectionStart,end=textarea.selectionEnd;
        if(start===end) { notice('先在这一行中选中文字'); return; }
        edit(page.id,o=>model.toggleEmphasis(o.rows.find(r=>r.id===rowId),start,end),false);
        textarea.nextElementSibling.innerHTML=markedText(getProject().pages.find(p=>p.id===page.id).outline.rows.find(r=>r.id===rowId));
        target.closest('[data-outline-page]').querySelector('[data-outline-composition]').innerHTML=composition(getProject(),getProject().pages.find(p=>p.id===page.id),current(page),options.assetUrl);
        textarea.focus();textarea.setSelectionRange(start,end);return;
      }
      if(action==='add-page') mutate(project=>project.pages.push({id:id('page'),name:'新页面',background:'#ffffff',elements:[],outline:{screens:1,rows:[],images:[],notes:''}}));
      else if(action==='delete-page') mutate(project=>{if(project.pages.length>1)project.pages=project.pages.filter(p=>p.id!==page.id);});
      else if(action==='up'||action==='down') mutate(project=>{const i=project.pages.findIndex(p=>p.id===page.id),j=i+(action==='up'?-1:1);if(j>=0&&j<project.pages.length)[project.pages[i],project.pages[j]]=[project.pages[j],project.pages[i]];});
      else if(action==='add-row') edit(page.id,o=>o.rows.push({id:id('row'),role:'body',text:'',emphasis:[],from:current(page),until:null}));
      else if(action==='delete-row') edit(page.id,o=>o.rows=o.rows.filter(r=>r.id!==rowId));
      else if(action==='screen-add') edit(page.id,o=>{const previous=o.screens; o.screens++;for(const item of [...o.rows,...o.images])if(item.visibleOn?.includes(previous))item.visibleOn.push(o.screens);screens.set(page.id,o.screens);});
      else if(action==='disappear') edit(page.id,o=>{const row=o.rows.find(r=>r.id===rowId); if(row.until===current(page)){row.until=null;delete row.visibleOn;return;}if(current(page)<=row.from){notice('文字须先在前一屏出现');return;}row.until=current(page);delete row.visibleOn;});
      else if(action==='image-disappear') edit(page.id,o=>{const image=o.images.find(r=>r.id===imageId);if(image.until===current(page)){image.until=null;delete image.visibleOn;}else if(current(page)>image.from){image.until=current(page);delete image.visibleOn;}else notice('图片须先在前一屏出现');});
      else if(action==='delete-image') edit(page.id,o=>o.images=o.images.filter(r=>r.id!==imageId));
      else if(action==='add-image') { const asset=await options.openLibrary?.(); if(asset)edit(page.id,o=>o.images.push({id:id('image'),asset:asset.id,caption:asset.name||'',from:current(page),until:null})); }
      else if(action.startsWith('copy-')) {
        const ids=action==='copy-all'?getProject().pages.map(p=>p.id):getProject().pages.filter(p=>checked.has(p.id)).map(p=>p.id);
        if(!ids.length){notice('请先选择页面');return;}await options.flush();
        const result=await options.request(`/outline/brief?pageIds=${ids.map(encodeURIComponent).join(',')}`);
        await navigator.clipboard.writeText(result.text);notice('已复制给 agent');return;
      } else if(action==='extract'||action==='apply') {
        busy=true;options.setBusy?.(true); host.inert=true;host.setAttribute('aria-busy','true');const status=host.querySelector('[data-outline-status]');if(status)status.textContent=action==='extract'?'正在逐屏提取…':'正在应用文字…'; await options.flush();
        let body={revision:options.getRevision()};
        if(action==='extract') {
          const project=structuredClone(getProject()),outlines={};
          for(const p of project.pages)outlines[p.id]=model.extractOutline(project,p,Object.fromEntries((await captureOutlinePage(project,p,options.assetBase)).map((frame,i)=>[i+1,Object.fromEntries(frame.map(e=>[e.id,e.visible]))])));
          body.outlines=outlines;
        }else body.pageIds=getProject().pages.filter(p=>p.outline).map(p=>p.id);
        const result=await options.request(`/outline/${action}`,'POST',body);
        unapplied=result.unapplied||[];
        await options.acceptResult(result);
        notice(action==='extract'?'已存版并提取大纲':'已应用可对应的文字；结构变化请交给 agent');
      }
      refresh();
    }catch(error){notice(error.message);}finally{busy=false;options.setBusy?.(false);host.inert=false;host.removeAttribute('aria-busy');const status=host.querySelector('[data-outline-status]');if(status)status.textContent='';}
  },{signal:controller.signal});
  refresh();
  return {refresh,dispose(){disposed=true;controller.abort();host.replaceChildren();}};
}
