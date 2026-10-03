// Runtime settings and cross-device gate use the existing glass dialog components.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const SOURCE_LABELS = {cli:'命令行 --data-dir',env:'环境变量 VW_DATA_DIR',local:'本机设置',config:'仓库 workbench.config.json',explicit:'启动时指定'};
export function mountRuntimeSettings({api, app, modal, closeModal, notice, glass}) {
  let settings, gate, pending, timer;
  async function check() {
    const state = await api('/api/session');
    if (!state.blocked) { if(gate){gate.remove();gate=null;app.inert=false;} return state; }
    if(!gate){gate=document.createElement('div');gate.className='modal-backdrop g-backdrop';gate.style.zIndex='10000';document.body.append(gate);app.inert=true;}
    gate.innerHTML=`<div class="g-sheet" role="alertdialog" aria-modal="true" aria-label="另一台电脑正在使用"><h2>另一台电脑正在使用</h2><p class="g-sheet__note">${state.fresh.map(s=>`${esc(s.computer)} 上的工作台还开着`).join('<br>')}。请先在那台电脑关闭工作台，并等 Google Drive 同步完成。</p><p class="g-sheet__note">如果已经确认那边停止使用，可以继续。不要在两台电脑上同时修改项目。</p><div class="g-sheet__actions"><button class="g-btn" data-recheck>重新检查</button><button class="g-btn g-btn--prism" data-confirm>我已确认，继续使用</button></div><p data-error role="status"></p></div>`;
    glass?.(gate.querySelector('.g-sheet'));
    gate.querySelector('[data-recheck]').onclick=()=>check().catch(showError);
    gate.querySelector('[data-confirm]').onclick=async()=>{try{await api('/api/session/confirm','POST',{tokens:state.fresh.map(s=>s.token)});await check();}catch(e){showError(e);}};
    function showError(e){if(gate)gate.querySelector('[data-error]').textContent=e.message;}
    return state;
  }
  async function ready() {
    settings=await api('/api/settings');
    const state=await check();
    if(state.warning)notice(state.warning);
    if(state.blocked) await new Promise(resolve=>{pending=setInterval(()=>{if(!gate){clearInterval(pending);resolve();}},200);});
    timer=setInterval(()=>check().catch(()=>{}),5000);
    return settings;
  }
  async function showSettings() {
    settings=await api('/api/settings');
    modal(`<h2>数据文件夹</h2><p class="g-sheet__note">当前使用：<br><span style="overflow-wrap:anywhere">${esc(settings.dataDir)}</span><br>来自：${esc(SOURCE_LABELS[settings.source]||settings.source)}</p><form data-folder-form><label class="g-field g-field--stack"><span>粘贴这台电脑上的数据文件夹完整路径</span><input name="dataDir" required value="${esc(settings.dataDir)}"></label><p class="g-sheet__note">文件夹必须已有 projects、library/assets、library/fonts。这里只保存位置，不搬动文件。保存后需关闭工作台，再双击启动。<br>本机配置：${esc(settings.localConfigPath)}</p><p data-folder-result role="status"></p><div class="g-sheet__actions"><button type="button" class="g-btn" data-folder-close>关闭</button><button class="g-btn g-btn--prism">保存本机设置</button></div></form>`);
    document.querySelector('[data-folder-close]').onclick=closeModal;
    document.querySelector('[data-folder-form]').onsubmit=async e=>{e.preventDefault();const output=e.currentTarget.querySelector('[data-folder-result]');try{const result=await api('/api/settings','PUT',{dataDir:new FormData(e.currentTarget).get('dataDir')});output.textContent=result.message;}catch(error){output.textContent=error.message;}};
  }
  window.addEventListener('vw-session-blocked',()=>check().catch(()=>{}));
  window.addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(pending);});
  return {ready,showSettings,get revealLabel(){return settings?.revealLabel||'在文件管理器中显示';}};
}
