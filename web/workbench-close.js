export function createWorkbenchClose({api,flush,confirm,notice=()=>{},renderClosed=()=>{document.body.replaceChildren();const message=document.createElement('main');message.className='workbench-closed';message.textContent='工作台已关闭，可以关掉这个窗口了';document.body.append(message);}}){
  let pending=false,closed=false;
  return {async close(){if(pending||closed)return false;pending=true;try{if(confirm&&!await confirm('关闭工作台？','会先保存当前修改，然后停止本机服务。切换电脑前请等文件夹同步完成。'))return false;await flush();await api('/api/shutdown','POST',{});closed=true;renderClosed();return true;}catch(e){notice(e.message);return false;}finally{pending=false;}},get closed(){return closed;}};
}
