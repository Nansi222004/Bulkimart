import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Editor;
before(async()=>{vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Editor=(await vite.ssrLoadModule('/src/modules/Delivery/components/ServiceAreaEditor.jsx')).default;});
after(async()=>await vite?.close());
const profile={zones:['456001','452015'],__v:3};
const edit=(h,value)=>{h.find(n=>n.type==='textarea').props.onChange({target:{value}});h.rerender();};
const submit=h=>h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
test('edit preloads saved pincodes and saves additions without dropping existing coverage',async()=>{
  let sent;const h=hookHarness(Editor,{profile,onSave:async(...args)=>{sent=args;return {ok:true};}});
  try{h.click('Edit service area');assert.equal(h.find(n=>n.type==='textarea').props.value,'456001, 452015');edit(h,'456001, 452015, 452001, 452006, 452001');await submit(h);await h.settle();assert.deepEqual(sent,[['456001','452015','452001','452006'],3]);assert.ok(h.find(n=>n.props?.role==='status'));assert.equal(h.find(n=>n.type==='form'),undefined);}finally{h.close();}
});
test('invalid pincodes stay editable with no request; Cancel makes no change',async()=>{
  let calls=0;const h=hookHarness(Editor,{profile,onSave:async()=>{calls++;return {ok:true};}});
  try{h.click('Edit service area');edit(h,'45200');await submit(h);await h.settle();assert.equal(calls,0);assert.ok(h.find(n=>n.props?.role==='alert'));h.click('Cancel');h.click('Edit service area');assert.equal(h.find(n=>n.type==='textarea').props.value,'456001, 452015');}finally{h.close();}
});
test('double submit is locked and network failures retain edits for retry',async()=>{
  let finish,calls=0;const h=hookHarness(Editor,{profile,onSave:()=>{calls++;return new Promise(r=>finish=r);}});
  try{h.click('Edit service area');edit(h,'452001,452006');const first=submit(h);await submit(h);assert.equal(calls,1);h.rerender();assert.equal(h.find(n=>n.type==='textarea').props.disabled,true);finish({ok:false,message:'Network failed'});await first;await h.settle();assert.equal(h.find(n=>n.type==='textarea').props.value,'452001,452006');assert.ok(h.find(n=>n.props?.role==='alert'));}finally{h.close();}
});
test('conflicts require reload and a failed reload preserves the unsaved draft',async()=>{
  const h=hookHarness(Editor,{profile,onSave:async()=>({ok:false,status:409,message:'Profile changed'}),onReload:async()=>({ok:false,message:'Offline'})});
  try{h.click('Edit service area');edit(h,'452001');await submit(h);await h.settle();assert.equal(h.find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);await h.find(n=>n.props?.children==='Reload saved service area').props.onClick();await h.settle();assert.equal(h.find(n=>n.type==='textarea').props.value,'452001');assert.equal(h.find(n=>n.props?.role==='alert').props.children,'Offline');}finally{h.close();}
});
