import { documentText, documentParagraphs, updateDocument, setDocumentRole, addDocumentScreen, deleteDocumentScreen, setDocumentVisibility } from './outline-document.js';
import { ROLES, isVisible, toggleEmphasis } from './outline-model.js';
const roles = {title:'大标题',subtitle:'小标题',english:'英文副标题',body:'正文',note:'注释'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function normalizeDocumentText(text) { return String(text).replace(/\r\n?/g,'\n'); }
export function markedText(row) {
  let output='';
  for(let i=0;i<(row.text||'').length;i++) {
    if((row.emphasis||[]).some(r=>r.start===i)) output+='<mark>';
    output+=esc(row.text[i]);
    if((row.emphasis||[]).some(r=>r.end===i+1)) output+='</mark>';
  }
  return output;
}
export function mountOutlinePanel(options) {
  const {host,getProject,getPage,getScreen,setScreen,mutate,notice=()=>{}}=options;
  const controller=new AbortController(), signal=controller.signal;
  let disposed=false, composing=false, pageId=null, screen=null, savedSelection={start:0,end:0}, currentRowId=null, pendingRole='body', screensSignature='';
  host.classList.add('outline-panel');
  host.innerHTML=`<div class="outline-document-box"><div class="outline-document-overlay" aria-hidden="true"></div><textarea data-outline-document aria-label="当前页大纲文稿" placeholder="写下这一页的文案，空行分隔段落" spellcheck="false"></textarea></div><div class="outline-panel-controls"><div class="outline-paragraph-controls"><label>当前段落<select data-outline-role aria-label="当前段落角色">${ROLES.map(r=>`<option value="${r}">${roles[r]}</option>`).join('')}</select></label><button class="g-btn" data-outline-action="emphasis">强调选中文字</button><button class="g-btn" data-outline-action="disappear">从本屏消失</button></div><div class="outline-screens" aria-label="页面屏幕"></div><p class="outline-motion-warning" role="status"></p><div class="outline-images"></div><button class="g-btn" data-outline-action="add-image">从素材库添加图片</button><label class="outline-notes">页面备注<textarea data-outline-notes aria-label="页面备注"></textarea></label><div class="outline-copy"><label class="g-field">交给 agent<select data-outline-brief-mode aria-label="给 agent 的任务"><option value="layout">请排版</option><option value="fill">请填大纲</option></select></label><button class="g-btn" data-outline-action="copy-current">复制当前页给 agent</button><button class="g-btn" data-outline-action="copy-all">复制全部给 agent</button></div></div>`;
  const editor=host.querySelector('[data-outline-document]'),overlay=host.querySelector('.outline-document-overlay'),roleSelect=host.querySelector('[data-outline-role]'),notes=host.querySelector('[data-outline-notes]');
  const page=()=>getPage();
  const selectedRow=()=>page()?.outline?.rows.find(r=>r.id===currentRowId);
  function editorParagraphs(){const rows=documentParagraphs(page(),getScreen());let offset=0,index=0;return editor.value.split(/(\n[\t ]*\n+)/).flatMap((text,i)=>{const start=offset;offset+=text.length;if(i%2||!text)return [];return [{row:rows[index++]?.row,start,end:offset,text}];});}
  function rowAtCaret(){return editorParagraphs().find(p=>savedSelection.start>=p.start&&savedSelection.start<=p.end+1)?.row||null;}
  function edit(fn,kind='metadata') { return mutate((project,p)=>fn(project,p||page()),{kind}); }
  function size() { editor.style.height='0px'; editor.style.height=`${Math.max(164,editor.scrollHeight)}px`; overlay.style.height=editor.style.height; }
  function updateSelection() {
    savedSelection={start:editor.selectionStart,end:editor.selectionEnd};
    const entry=rowAtCaret();
    currentRowId=(entry?.row||entry)?.id||null;
    updateControls();
  }
  function updateControls() {
    const row=selectedRow();
    roleSelect.disabled=false; roleSelect.value=row?.role||pendingRole;
    host.querySelector('[data-outline-action="emphasis"]').disabled=!row||savedSelection.start===savedSelection.end;
    host.querySelector('[data-outline-action="disappear"]').disabled=!row||getScreen()==null;
  }
  function paint() {
    const paragraphs=documentParagraphs(page(),getScreen());let index=0;
    overlay.innerHTML=editor.value.split(/(\n[\t ]*\n+)/).map((part,i)=>{if(i%2||!part)return esc(part);const row=paragraphs[index++]?.row;return row?.text===part?markedText(row):esc(part);}).join('')+'\n';
    size(); updateControls();
  }
  function refresh({force=false}={}) {
    if(disposed||!page())return;
    const changedPage=pageId!==page().id,changedScreen=screen!==getScreen();
    pageId=page().id; screen=getScreen();
    const modelText=documentText(page(),screen);
    const canonicalEditor=normalizeDocumentText(editor.value).split(/\n[\t ]*\n+/).filter(t=>t.length).join('\n\n');
    if(changedPage||changedScreen||(canonicalEditor!==modelText&&(force||document.activeElement!==editor))) {
      editor.value=modelText;
      if(changedPage||changedScreen){pendingRole='body';savedSelection={start:0,end:0};currentRowId=documentParagraphs(page(),screen)[0]?.row.id||null;}
      else {savedSelection.start=Math.min(savedSelection.start,editor.value.length);savedSelection.end=Math.min(savedSelection.end,editor.value.length);editor.setSelectionRange(savedSelection.start,savedSelection.end);currentRowId=rowAtCaret()?.id||null;}
    }
    if(changedPage||document.activeElement!==notes) notes.value=page().outline?.notes||'';
    paint();
    const o=page().outline;
    const nextScreensSignature=JSON.stringify([pageId,o.screens,screen]);
    if(nextScreensSignature!==screensSignature) host.querySelector('.outline-screens').innerHTML=`<button class="g-btn ${screen==null?'is-active':''}" data-outline-action="screen" data-screen="all" aria-pressed="${screen==null}">全部显示</button>${Array.from({length:o.screens},(_,i)=>`<span class="outline-screen"><button class="g-btn ${screen===i+1?'is-active':''}" data-outline-action="screen" data-screen="${i+1}" aria-pressed="${screen===i+1}">第${i+1}屏</button><button class="outline-screen-delete" data-outline-action="screen-delete" data-screen="${i+1}" aria-label="删除第${i+1}屏">×</button></span>`).join('')}<button class="g-btn" data-outline-action="screen-add" aria-label="添加下一屏">＋</button>`;
    screensSignature=nextScreensSignature;
    const warning=host.querySelector('.outline-motion-warning');warning.textContent=(page().motion?.steps||0)!==o.screens-1?`大纲有 ${o.screens} 屏，动效应为 ${o.screens-1} 步；请交给 agent 调整。`:''; warning.hidden=!warning.textContent;
    const images=host.querySelector('.outline-images');
    if(!images.contains(document.activeElement)||changedPage||changedScreen) images.innerHTML=(o.images||[]).filter(r=>screen==null||isVisible(r,screen)).map(r=>`<label class="outline-image" data-outline-image="${esc(r.id)}"><span>${esc(getProject().assets?.find(a=>a.id===r.asset)?.name||'图片')}</span><input data-outline-caption value="${esc(r.caption)}" aria-label="图片说明"><button class="g-btn" data-outline-action="image-delete">删除图片</button></label>`).join('');
  }
  function inputDocument() {
    if(composing)return;
    const text=normalizeDocumentText(editor.value);
    const result=edit((project,p)=>updateDocument(project,p,getScreen(),text,{role:pendingRole}), 'text');
    if(result?.overflow?.length)notice('文案已保留；部分新增内容超出画板，请交给 agent 排版。');
    updateSelection();paint();
  }
  editor.addEventListener('input',inputDocument,{signal});
  editor.addEventListener('blur',()=>{queueMicrotask(()=>{if(!disposed&&!composing)refresh();});},{signal});
  editor.addEventListener('compositionstart',()=>{composing=true;},{signal});
  editor.addEventListener('compositionend',()=>{composing=false;inputDocument();},{signal});
  for(const type of ['select','keyup','click','focus'])editor.addEventListener(type,()=>{if(!composing)updateSelection();},{signal});
  editor.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.isComposing||composing||event.keyCode===229)return;
    pendingRole='body';
    if(selectedRow()?.role==='body'||!selectedRow())return;
    event.preventDefault();editor.setRangeText('\n\n',editor.selectionStart,editor.selectionEnd,'end');inputDocument();
  },{signal});
  roleSelect.addEventListener('change',()=>{if(currentRowId)edit((project,p)=>setDocumentRole(p,currentRowId,roleSelect.value,project),'structure');else pendingRole=roleSelect.value;paint();},{signal});
  notes.addEventListener('input',()=>edit((_,p)=>{p.outline.notes=notes.value;}),{signal});
  host.addEventListener('input',event=>{if(event.target.matches('[data-outline-caption]')){const id=event.target.closest('[data-outline-image]').dataset.outlineImage;edit((_,p)=>{p.outline.images.find(r=>r.id===id).caption=event.target.value;});}},{signal});
  host.addEventListener('pointerdown',event=>{if(event.target.closest('[data-outline-action="emphasis"]')){updateSelection();event.preventDefault();}},{signal});
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-outline-action]');if(!button||button.disabled)return;
    const action=button.dataset.outlineAction,originPage=pageId;
    try {
      if(action==='emphasis') {
        const selected={...savedSelection},paragraphs=editorParagraphs().filter(p=>p.row);
        edit((_,p)=>{for(const entry of paragraphs){const start=Math.max(0,selected.start-entry.start),end=Math.min(entry.row.text.length,selected.end-entry.start);if(end>start)toggleEmphasis(p.outline.rows.find(r=>r.id===entry.row.id),start,end);}});
        editor.focus();editor.setSelectionRange(selected.start,selected.end);savedSelection=selected;paint();return;
      }
      if(action==='disappear')edit((_,p)=>{const row=p.outline.rows.find(r=>r.id===currentRowId);setDocumentVisibility(p,row.id,Array.from({length:p.outline.screens},(_,i)=>i+1).filter(s=>s<getScreen()&&isVisible(row,s)));},'structure');
      else if(action==='screen')setScreen(button.dataset.screen==='all'?null:Number(button.dataset.screen));
      else if(action==='screen-add'){let next;edit((_,p)=>{next=addDocumentScreen(p);},'structure');setScreen(typeof next==='number'?next:page().outline.screens);}
      else if(action==='screen-delete'){const removing=Number(button.dataset.screen);edit((_,p)=>deleteDocumentScreen(p,removing),'structure');if(getScreen()!=null)setScreen(Math.max(1,Math.min(getScreen()-(removing<getScreen()?1:0),page().outline.screens)));}
      else if(action==='image-delete'){const id=button.closest('[data-outline-image]').dataset.outlineImage;edit((_,p)=>{p.outline.images=p.outline.images.filter(r=>r.id!==id);},'structure');}
      else if(action==='add-image') {const asset=await options.openLibrary?.();if(asset&&!disposed&&pageId===originPage)edit((_,p)=>{p.outline.images.push({id:`image_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`,asset:asset.id,caption:asset.name||'',from:getScreen()||1,until:null});},'structure');}
      else if(action.startsWith('copy-')) {await options.flush?.();const ids=action==='copy-all'?getProject().pages.map(p=>p.id):[originPage];const result=await options.request(`/outline/brief?pageIds=${ids.map(encodeURIComponent).join(',')}&mode=${host.querySelector('[data-outline-brief-mode]').value}`);await navigator.clipboard.writeText(result.text);notice('已复制给 agent');return;}
      refresh({force:true});
    } catch(error){notice(error.message);}
  },{signal});
  refresh();
  return {refresh,dispose(){disposed=true;controller.abort();host.replaceChildren();host.classList.remove('outline-panel');}};
}
