// Controls emit patches only; callers own project state, history and persistence.
export function appearanceControls(elements, callbacks = {}) {
  const root=document.createElement('div');root.className='appearance-controls';
  const list=Array.isArray(elements)?elements:[elements];
  const label=document.createElement('label');label.className='g-field g-field--stack';label.textContent='透明度（不透明程度）';
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='1';slider.step='0.01';slider.value=String(list[0]?.opacity??1);slider.setAttribute('aria-label','不透明度');
  const emit=()=>({opacity:Number(slider.value)});
  slider.addEventListener('input',()=>callbacks.change?.(emit()));slider.addEventListener('change',()=>callbacks.commit?.(emit()));label.append(slider);root.append(label);
  for(const [key,title] of [['flipX','水平翻转'],['flipY','垂直翻转']]) {
    const button=document.createElement('button');button.type='button';button.className='g-btn';button.textContent=title;
    let value=list.every(e=>e?.[key]===true);button.setAttribute('aria-pressed',String(value));
    button.addEventListener('click',()=>{value=!value;button.setAttribute('aria-pressed',String(value));const patch={[key]:value};callbacks.change?.(patch);callbacks.commit?.(patch);});root.append(button);
  }
  return root;
}
export const mountAppearanceControls = (container,elements,callbacks) => {const controls=appearanceControls(elements,callbacks);container.append(controls);return controls;};
