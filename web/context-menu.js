let activeClose = null;
export function closeContextMenu() { activeClose?.(); }
export function showContextMenu({x=0,y=0,items=[],onAction=()=>{},document:doc=globalThis.document}) {
  closeContextMenu(); const menu=doc.createElement('div'); menu.className='g-context-menu'; menu.setAttribute('role','menu'); menu.style.cssText=`position:fixed;left:${x}px;top:${y}px;z-index:10000`;
  for(const item of items) { if(item.separator) { const hr=doc.createElement('hr'); menu.append(hr); continue; } const button=doc.createElement('button'); button.type='button'; button.className='g-btn g-context-menu__item'; button.setAttribute('role','menuitem'); button.textContent=item.label; button.disabled=!!item.disabled; button.onclick=()=>{close();onAction(item.action,item);}; menu.append(button); }
  doc.body.append(menu); const box=menu.getBoundingClientRect(), win=doc.defaultView; menu.style.left=Math.max(4,Math.min(x,win.innerWidth-box.width-4))+'px'; menu.style.top=Math.max(4,Math.min(y,win.innerHeight-box.height-4))+'px';
  function outside(e) { if(!menu.contains(e.target))close(); } function key(e) { if(e.key==='Escape'){e.preventDefault();close();return;} if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(menu.querySelectorAll('button:not(:disabled)'));if(!buttons.length)return;let index=buttons.indexOf(doc.activeElement);if(e.key==='Home')index=0;else if(e.key==='End')index=buttons.length-1;else index=(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();} }
  function close(){menu.remove();doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',key,true);win.removeEventListener('blur',close); if(activeClose===close)activeClose=null;}
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',key,true);win.addEventListener('blur',close);activeClose=close;menu.querySelector('button:not(:disabled)')?.focus(); return close;
}
