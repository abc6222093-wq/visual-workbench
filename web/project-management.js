const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createProjectManagement({api,confirm,notice=()=>{},refresh=async()=>{},onDeleted=async()=>{},onOpen=async()=>{},modal,closeModal=()=>{},flush=async()=>{}}){
  const path=id=>'/api/projects/'+encodeURIComponent(id);
  const report=async task=>{try{return await task();}catch(e){notice(e.message);return null;}};
  async function rename(project){
    const host=modal(`<h2>重命名项目</h2><form class="project-management-form"><label>项目名称<input name="name" required maxlength="500" value="${esc(project.name)}"></label><div class="g-sheet__actions"><button type="button" class="g-btn" data-cancel>取消</button><button class="g-btn g-btn--prism" type="submit">保存名称</button></div></form>`);
    const el=host?.querySelector?host:document.querySelector('.project-management-form')?.parentElement;
    const form=el?.querySelector('.project-management-form');if(!form)return;
    form.querySelector('[data-cancel]').onclick=closeModal;
    form.onsubmit=event=>{event.preventDefault();report(async()=>{await flush(project.id);await api(path(project.id),'PATCH',{name:form.elements.name.value});closeModal();await refresh();notice('项目名称已更新');});};form.elements.name.focus();form.elements.name.select();
  }
  const remove=project=>report(async()=>{if(!await confirm('删除项目？',`「${project.name}」会移到回收站，7 天内可以恢复。`))return false;await flush(project.id);const out=await api(path(project.id),'DELETE',{});await onDeleted(project.id);await refresh();notice('项目已移到回收站');return out;});
  const duplicate=project=>report(async()=>{await flush(project.id);const out=await api(path(project.id)+'/duplicate','POST',{});await refresh();await onOpen(out.project.id);notice('已复制整个项目');return out;});
  const restore=id=>report(async()=>{const out=await api('/api/trash/'+encodeURIComponent(id)+'/restore','POST',{});await refresh();await openTrash();notice('项目已恢复');return out;});
  const purge=row=>report(async()=>{if(!await confirm('永久删除项目？',`「${row.name}」及其全部文件会永久删除，无法恢复。`))return false;const out=await api('/api/trash/'+encodeURIComponent(row.trashId),'DELETE',{});await openTrash();notice('项目已永久删除');return out;});
  async function openTrash(){return report(async()=>{const rows=await api('/api/trash');const host=modal(`<h2>回收站</h2><p class="g-sheet__note">项目删除后保留 7 天；超过 7 天会在下次启动时自动清理。</p><div class="project-trash">${rows.length?rows.map(row=>`<div class="project-trash__row"><div><strong>${esc(row.name)}</strong><small>删除于 ${esc(new Date(row.deletedAt).toLocaleString())}</small></div><button class="g-btn" data-restore="${esc(row.trashId)}">恢复</button><button class="g-btn" data-purge="${esc(row.trashId)}">永久删除</button></div>`).join(''):'<p>回收站是空的</p>'}</div><div class="g-sheet__actions"><button class="g-btn" data-trash-close>关闭</button></div>`);const el=host?.querySelector?host:document.querySelector('.project-trash')?.parentElement;if(!el)return rows;const close=el.querySelector('[data-trash-close]');if(close)close.onclick=closeModal;for(const button of el.querySelectorAll?.('[data-restore]')||[])button.onclick=()=>restore(button.dataset.restore);for(const button of el.querySelectorAll?.('[data-purge]')||[])button.onclick=()=>purge(rows.find(row=>row.trashId===button.dataset.purge));return rows;});}
  return {rename,remove,duplicate,openTrash,restore,purge};
}
