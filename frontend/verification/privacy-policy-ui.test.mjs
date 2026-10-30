import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Page;
before(async()=>{vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Page=(await vite.ssrLoadModule('/src/modules/Admin/components/PrivacyPolicyTab.jsx')).default;});
after(async()=>vite?.close());
const policy=role=>({role,slug:role+'-policy',roleTitle:role+' document',summary:'Summary',version:'1.0.0',effectiveDate:'2026-01-01',sections:[{title:'Section',content:'Content',points:[]}]});
const text=node=>node==null?'':typeof node!=='object'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');
function fixture(){const notices=[];const h=hookHarness(Page,{},'/admin',{triggerToast:(...args)=>notices.push(args)});return {h,notices};}
const save=h=>h.find(n=>n.type==='button'&&text(n).includes('Save & Publish'));
test('admin policy load uses the admin route and server failures block saving until retry',async()=>{
  const {h}=fixture();try{assert.match(h.requests[0].url,/\/api\/admin\/privacy-policy\/user-policy$/);
    h.requests[0].resolve({success:false,message:'Temporary database failure'},500);await h.settle();
    assert.equal(save(h).props.disabled,true);assert.match(text(h.tree),/Temporary database failure/);
    const pending=h.click('Retry loading policy');h.requests[1].resolve({success:true,data:policy('user')});await pending;await h.settle();assert.equal(save(h).props.disabled,false);
  }finally{h.close();}
});
test('late customer response cannot overwrite a selected seller policy',async()=>{
  const {h}=fixture();try{const old=h.requests[0];h.find(n=>n.type==='button'&&n.key==='seller').props.onClick();h.flush();
    h.requests[1].resolve({success:true,data:policy('seller')});await h.settle();old.resolve({success:true,data:policy('user')});await h.settle();
    assert.ok(h.find(n=>n.type==='input'&&n.props.value==='seller document'));assert.equal(h.find(n=>n.type==='input'&&n.props.value==='user document'),undefined);
  }finally{h.close();}
});
test('blank section content is explained before any save request',async()=>{
  const {h,notices}=fixture();try{const p=policy('user');p.sections[0].content='';h.requests[0].resolve({success:true,data:p});await h.settle();
    await save(h).props.onClick({preventDefault(){}});assert.equal(h.requests.length,1);assert.match(notices.at(-1)[0],/Section 1: content is required/);
  }finally{h.close();}
});
test('publish uses the selected role, prevents duplicate saves and keeps server errors visible',async()=>{
  const {h,notices}=fixture();try{h.requests[0].resolve({success:true,data:policy('user')});await h.settle();
    const first=save(h).props.onClick({preventDefault(){}});await save(h).props.onClick({preventDefault(){}});assert.equal(h.requests.length,2);
    assert.equal(JSON.parse(h.requests[1].options.body).isPublished,true);h.requests[1].resolve({success:false,message:'Section 1: content is required'},400);await first;await h.settle();assert.match(notices.at(-1)[0],/Section 1: content is required/);
  }finally{h.close();}
});
