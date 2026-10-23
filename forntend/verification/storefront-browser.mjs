import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DEFAULT_TOKENS, PRESETS } from '../../backend/shared/storefront.mjs';
// Reuse the existing isolated CDP runner. Every API request is intercepted;
// external resources are blocked and only an ephemeral browser profile is used.
const generated = new URL(`../tests/.storefront-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const replace = (marker, value) => { assert.ok(source.includes(marker), `Missing browser runner marker: ${marker.slice(0, 60)}`); source = source.replace(marker, value); };
replace("'--headless=new', '--remote-debugging-port=0'", "'--headless=new', '--disable-gpu', '--remote-debugging-port=0'");
replace("const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();", "const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');");
replace("let layoutScenario = '';", `let layoutScenario = ''; let studioSaved = null; const studioTokens = ${JSON.stringify(DEFAULT_TOKENS)};`);
replace("  const selectedPaths=process.argv.find", "  await command('Page.addScriptToEvaluateOnNewDocument', { source: `for(const key of Object.keys(sessionStorage)) if(key.startsWith('bulkimart:experience:'))sessionStorage.removeItem(key);` });\n  const selectedPaths=process.argv.find");
replace('  const path = new URL(raw).pathname;', `  const path = new URL(raw).pathname;
  const banner = {id:'507f1f77bcf86cd799439050',title:'Everyday discoveries',subtitle:'Explore the latest products from Bulkimart sellers.',image:'https://fixture.invalid/unavailable.webp',cta:'Browse categories',destination:{type:'NAV',id:'categories'}};
  if(path==='/api/categories/tree')return [{_id:'507f1f77bcf86cd799439055',name:'Fresh category',slug:'grocery--fresh',type:'grocery',isPopular:true,children:[]}];
  if(path==='/api/storefront/experience'){
    if(layoutScenario==='storefront-error')return {success:false,message:'Fixture configuration outage'};
    const now=Date.now();
    return {success:true,data:{version:'fixture-v1',serverTime:new Date(now).toISOString(),validUntil:new Date(now+30000).toISOString(),refreshMs:30000,
      theme:{tokens:studioTokens},banners:[banner,{...banner,id:'507f1f77bcf86cd799439051',title:'Shop the collection'}],
      splash:layoutScenario.includes('splash')?{id:'507f1f77bcf86cd799439052',revision:1,config:{frequency:'launch',duration:15,countdown:true},endAt:new Date(now+60000).toISOString(),banner:{...banner,video:layoutScenario.includes('video')?'https://fixture.invalid/unavailable.mp4':''}}:null,
      sections:[{id:'507f1f77bcf86cd799439053',revision:1,name:'Fresh picks',config:{title:'Fresh picks for you',source:'recent',limit:8,variant:'plain'}}]}};
  }
  if(path==='/api/admin/storefront'&&requestBody){const body=JSON.parse(requestBody);studioSaved={...body,_id:'507f1f77bcf86cd799439054',revision:1,status:'draft',lifecycle:'draft'};return {success:true,data:studioSaved};}
  if(path.includes('/api/admin/storefront/')&&path.includes('/actions/'))return {success:true,data:{...studioSaved,revision:2,status:'published',lifecycle:'active'}};
  if(path==='/api/admin/storefront')return {success:true,data:studioSaved?[studioSaved]:[],meta:{page:1,pages:1,total:studioSaved?1:0}};
  if(path==='/api/banners')return [{...banner,_id:banner.id,type:'general',isActive:true}];
  if(path==='/api/admin/campaigns')return {success:true,data:[]};
`);
replace('      if (startupOnly) {', `
      if(path.startsWith('/admin/storefront-studio')){
        await waitFor("!!document.querySelector('.studio-workspace') && !document.querySelector('.studio-workspace [role=status]')");
        await evaluate("document.querySelector('.studio-header button').click()");
        await waitFor("!!document.querySelector('.studio-editor')");
        assert.ok(await evaluate("document.querySelector('.studio-editor').contains(document.activeElement)"),'Editor traps initial focus');
        await evaluate("document.querySelector('.studio-editor input').focus()");await command('Input.insertText',{text:'Browser seasonal theme'});
        await evaluate("[...document.querySelectorAll('.studio-preview-toggle button')].find(b=>b.textContent==='Desktop').click()");
        assert.ok(await evaluate("!!document.querySelector('.studio-preview--desktop')"));
        await evaluate("[...document.querySelectorAll('.studio-preview-toggle button')].find(b=>b.textContent==='Mobile').click()");
        assert.ok(await evaluate("!!document.querySelector('.studio-preview--mobile')"));
        await evaluate("document.querySelector('.studio-editor footer .sa-btn-primary').click()");
        await waitFor("!document.querySelector('.studio-editor')");
        assert.equal(studioSaved.name,'Browser seasonal theme');assert.equal(studioSaved.kind,'theme');
      } else if(layoutScenario.startsWith('storefront')){
        if(layoutScenario==='storefront-error'){
          await waitFor("!!document.querySelector('.sf-product')");
          assert.equal(await evaluate("!!document.querySelector('.sf-splash')"),false);
          assert.equal(await evaluate("getComputedStyle(document.querySelector('.sf-storefront')).getPropertyValue('--sf-primary').trim()"),'#087ea4');
        }else{
          if(layoutScenario.includes('splash')){
            await waitFor("!!document.querySelector('.sf-splash')");
            assert.ok(await evaluate("document.querySelector('.sf-splash').contains(document.activeElement)"),'Splash owns focus');
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
            assert.ok(await evaluate("document.querySelector('.sf-splash').contains(document.activeElement)"),'Tab remains in splash');
            if(layoutScenario.includes('video'))await waitFor("!!document.querySelector('.sf-splash .sf-media-fallback')");
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
            await waitFor("!document.querySelector('.sf-splash')");
            assert.equal(await evaluate("document.activeElement.closest('[inert]')!==null"),false,'Focus is restored outside inert content');
          }
          await waitFor("!!document.querySelector('.sf-hero') && !!document.querySelector('.sf-product')");
          assert.ok(await evaluate("document.querySelector('.sf-section').textContent.includes('Fresh picks for you')"));
          await evaluate("document.querySelector('[aria-label=\\\"Pause promotions\\\"]').click()");
          await evaluate("document.querySelector('[aria-label=\\\"Next promotion\\\"]').click()");
          assert.ok(await evaluate("document.querySelector('.sf-hero').textContent.includes('Shop the collection')"));
          if(layoutScenario.includes('splash'))assert.equal(await evaluate("!!document.querySelector('.sf-splash')"),false,'Rerender does not reopen splash');
          if(layoutScenario==='storefront-category'){
            await evaluate("document.querySelector('.category-scroll-item').click()");
            await waitFor("location.pathname==='/categories/grocery--fresh' && !!document.querySelector('.category-results-section') && !!document.querySelector('.category-result-card:not(.skeleton)')");
            assert.ok(await evaluate("document.querySelector('.category-results-heading').textContent.includes('Fresh category')"));
          }
        }
      }
      if(width===390||width===1440){const directory=resolve('../test-artifacts/storefront');await mkdir(directory,{recursive:true});await writeFile(join(directory,(layoutScenario||'studio')+'-'+width+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));}
      if (startupOnly) {`);
source = source.replaceAll('../test-artifacts/mobile-native', '../test-artifacts/storefront/geometry').replaceAll('../test-artifacts/mobile-layout', '../test-artifacts/storefront/layout');
try {
  await writeFile(generated, source);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--full', '--paths=/?layout=storefront,/?layout=storefront-splash,/?layout=storefront-splash-video,/?layout=storefront-error,/?layout=storefront-category,/admin/storefront-studio', '--widths=320,390,1440', '--label=storefront'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0, 'Storefront browser assertions failed');
} finally { await rm(generated, { force: true }); }
