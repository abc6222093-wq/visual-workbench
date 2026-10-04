export function motionStatusText(project,result) {
  if(project.formatVersion!==2)return {text:'这是旧格式的项目，暂时检查不了动效',detail:'请交给 agent 升级格式后再检查。'};
  const failures=(result.results||result.errors||[]).filter(e=>e.ok!==true);
  return {text:result.ok?'动效检查通过':'动效检查未通过',detail:failures.map(e=>`${e.page||'页面'}：${String(e.error||e.message||'检查失败').split('\n')[0]}`).join('；')};
}
