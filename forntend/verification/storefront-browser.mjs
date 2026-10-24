import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { DEFAULT_TOKENS, PRESETS } from '../../backend/shared/storefront.mjs';
// Reuse the existing isolated CDP runner. Every API request is intercepted;
// external resources are blocked and only an ephemeral browser profile is used.
const generated = new URL(`../tests/.storefront-${process.pid}.mjs`, import.meta.url);
const splashPreviewOnly = process.argv.includes('--splash-preview');
const splashScreenOnly = process.argv.includes('--splash-screen');
// Embedded in the fixture runner so these assertions exercise real layout/CSS.
async function checkSplashGeometry(selector, frameSelector) {
  const result = await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)}), card = root.querySelector('.sf-splash-card');
    const media = card.querySelector('img,video,.sf-media-fallback');
    const rect = element => { const r = element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    const frame = ${frameSelector ? `rect(document.querySelector(${JSON.stringify(frameSelector)}))` : '{x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height}'};
    return { frame, root:rect(root), card:rect(card), media:rect(media), skip:!!root.querySelector('.sf-skip'),
      radius:getComputedStyle(card).borderRadius, fit:getComputedStyle(media).objectFit,
      background:getComputedStyle(root).backgroundColor, copy:!!root.querySelector('.sf-splash-copy,h2') };
  })()`);
  for (const name of ['root', 'card', 'media']) for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(result[name][key] - result.frame[key]) < 1, `${selector}: ${name}.${key} fills the launch screen`);
  }
  assert.equal(result.radius, '0px'); assert.equal(result.fit, 'cover'); assert.equal(result.copy, false);
  assert.match(result.background, /^rgb\(/, 'Launch background is opaque');
  assert.equal(result.skip, false, 'Splash has no Skip button');
}
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const replace = (marker, value) => { assert.ok(source.includes(marker), `Missing browser runner marker: ${marker.slice(0, 60)}`); source = source.replace(marker, value); };
replace("'--headless=new', '--remote-debugging-port=0'", "'--headless=new', '--disable-gpu', '--remote-debugging-port=0'");
replace("const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();", "const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');");
replace("let layoutScenario = '';", `let layoutScenario = ''; let studioSaved = null; let themePhase = 0; const studioTokens = ${JSON.stringify(DEFAULT_TOKENS)};\n${checkSplashGeometry.toString()}`);
replace("if(path!=='/seller/logout')await evaluate(\"try{sessionStorage.removeItem('audit-seller-logout')}catch{}\");", "if(path!=='/seller/logout')await evaluate(\"try{sessionStorage.removeItem('audit-seller-logout');for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k&&k.startsWith('bulkimart:experience:'))sessionStorage.removeItem(k);}}catch{}\");");
replace("  const selectedPaths=process.argv.find", "  await command('Page.addScriptToEvaluateOnNewDocument', { source: `for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k&&k.startsWith('bulkimart:experience:'))sessionStorage.removeItem(k);}` });\n  const selectedPaths=process.argv.find");
replace('  const path = new URL(raw).pathname;', `  const path = new URL(raw).pathname;
  const banner = {id:'507f1f77bcf86cd799439050',title:'Everyday discoveries',subtitle:'Explore the latest products from Bulkimart sellers.',image:'https://fixture.invalid/unavailable.webp',cta:'Browse categories',destination:{type:'NAV',id:'categories'}};
  if(path==='/api/categories/tree')return [{_id:'507f1f77bcf86cd799439055',name:'Fresh category',slug:'grocery--fresh',type:'grocery',isPopular:true,children:[]}];
  if(path==='/api/storefront/experience'){
    if(layoutScenario==='storefront-error')return {success:false,message:'Fixture configuration outage'};
    const now=Date.now();
    return {success:true,data:{version:'fixture-v1',serverTime:new Date(now).toISOString(),validUntil:new Date(now+30000).toISOString(),refreshMs:30000,
      theme:themePhase===1?{id:'published-theme',tokens:{...studioTokens,header:'#116B52',action:'#116B52',navActive:'#116B52'}}:{tokens:studioTokens},banners:layoutScenario==='storefront-default'?[]:[banner,{...banner,id:'507f1f77bcf86cd799439051',title:'Shop the collection'}],
      headerCategories:layoutScenario==='storefront-default'?[]:Array.from({length:8},(_,i)=>({_id:(BigInt('0x507f1f77bcf86cd799439055')+BigInt(i)).toString(16),name:i?'Admin category '+i:'Fresh category',slug:i?'grocery--category-'+i:'grocery--fresh',image:'https://fixture.invalid/category.webp'})),
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
      if(layoutScenario.startsWith('storefront')){
        if(layoutScenario.includes('splash')){
          await waitFor("!!document.querySelector('.sf-splash-card')");
          assert.equal(await evaluate("!!document.querySelector('.unified-header-container,.home-feed-scrollable,.sf-product')"),false,'Home discovery remains unmounted during the launch splash');
          await checkSplashGeometry('.sf-splash');
          assert.ok(await evaluate("document.querySelector('.sf-splash').contains(document.activeElement)"),'Splash owns focus');
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
          assert.ok(await evaluate("document.querySelector('.sf-splash').contains(document.activeElement)"),'Tab remains in splash');
          if(layoutScenario.includes('video'))await waitFor("!!document.querySelector('.sf-splash .sf-media-fallback')");
          if(width===390){const directory=resolve('../test-artifacts/storefront');await mkdir(directory,{recursive:true});await writeFile(join(directory,layoutScenario+'-fullscreen.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
          await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await waitFor("!document.querySelector('.sf-splash')");
          assert.equal(await evaluate("document.activeElement.closest('[inert]')!==null"),false,'Focus is restored outside inert content');
        }
        await waitFor("!!document.querySelector('.unified-header-container')");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.header-primary-row')).backgroundColor"),'rgb(121, 0, 11)','Deep-red header in default mode');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.header-brand-name span')).color"),'rgb(255, 255, 255)','Readable brand');
        assert.equal(await evaluate("getComputedStyle(document.body).backgroundColor"),'rgb(255, 249, 244)','Theme reaches desktop gutters');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.sub-nav-item-btn.active')).color"),'rgb(255, 255, 255)','Readable active category');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.search-bar-pill')).backgroundColor"),'rgb(255, 255, 255)','White search');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.bottom-nav-bar')).backgroundColor"),'rgb(255, 255, 255)','Light navigation');
        if(layoutScenario==='storefront-refresh'){
          await evaluate("document.querySelector('.switcher-tab-btn.shop-all').click()");
          await waitFor("!!document.querySelector('.sf-storefront.mode-shop-all')");
          assert.equal(await evaluate("getComputedStyle(document.querySelector('.header-primary-row')).backgroundColor"),'rgb(121, 0, 11)','ShopAll shares the published header');
          await waitFor("getComputedStyle(document.querySelector('.switcher-tab-btn.active')).backgroundColor==='rgb(255, 240, 179)'");
          await evaluate("document.querySelector('.switcher-tab-btn.quick').click()");
          await waitFor("!!document.querySelector('.sf-storefront.mode-quick')");
          await pause(100);
          themePhase=1; await evaluate("window.dispatchEvent(new Event('online'))");
          await waitFor("getComputedStyle(document.querySelector('.header-primary-row')).backgroundColor==='rgb(17, 107, 82)'");
          await pause(100);
          themePhase=0; await evaluate("window.dispatchEvent(new Event('online'))");
          await waitFor("getComputedStyle(document.querySelector('.header-primary-row')).backgroundColor==='rgb(121, 0, 11)'");
          await evaluate("for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k&&k.startsWith('bulkimart:experience:'))sessionStorage.removeItem(k);}");
        }
      }
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
        await evaluate("[...document.querySelectorAll('.studio-tabs button')].find(b=>b.textContent==='Promotional campaigns').click()");
        await evaluate("document.querySelector('.studio-header button').click()");
        await waitFor("!!document.querySelector('.studio-editor')");
        assert.equal(await evaluate("document.querySelector('.studio-editor fieldset > label').querySelector('span').textContent"),'Placement');
        await evaluate("const placement=document.querySelector('.studio-editor fieldset > label select');placement.value='splash';placement.dispatchEvent(new Event('change',{bubbles:true}))");
        await waitFor("!!document.querySelector('.studio-splash-preview')");
        await waitFor("[...document.querySelectorAll('.studio-banner-section select option')].some(o=>o.value==='507f1f77bcf86cd799439050')");
        await evaluate("const artwork=document.querySelector('.studio-banner-section select');artwork.value='507f1f77bcf86cd799439050';artwork.dispatchEvent(new Event('change',{bubbles:true}))");
        await waitFor("!!document.querySelector('.studio-splash-stage .sf-splash-card')");
        await checkSplashGeometry('.studio-splash-stage .sf-splash', '.studio-splash-stage');
        assert.equal(await evaluate("!!document.querySelector('.studio-preview-collection')"),false,'Splash preview omits homepage collections');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.studio-editor footer .sa-btn-primary')).backgroundColor"),'rgb(8, 126, 164)','Publish label has a contrasting background');
        await evaluate("document.querySelector('.studio-splash-stage').focus()");
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await waitFor("!document.querySelector('.studio-splash-stage .sf-splash')");
        await evaluate("[...document.querySelectorAll('.studio-splash-controls button')].find(b=>b.textContent==='Replay splash').click()");
        await waitFor("!!document.querySelector('.studio-splash-stage .sf-splash')");
        await evaluate("[...document.querySelectorAll('.studio-field')].find(l=>l.textContent.includes('Auto-close after')).querySelector('input').focus()");
        await evaluate("document.activeElement.select()");await command('Input.insertText',{text:'2'});
        await waitFor("!document.querySelector('.studio-splash-stage .sf-splash')");
        await evaluate("document.querySelector('.studio-splash-controls button').click();document.querySelector('.studio-splash-stage').focus()");
        await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await waitFor("!document.querySelector('.studio-splash-stage .sf-splash')");
        assert.ok(await evaluate("!!document.querySelector('.studio-editor')"),'Preview Escape keeps campaign editor open');
        assert.equal(studioSaved.kind,'theme','Preview does not save or publish the campaign');
        await evaluate("document.querySelector('.studio-splash-controls button').click();document.querySelector('.studio-preview-pane').scrollIntoView({block:'start'})");
      } else if(layoutScenario.startsWith('storefront')){
        if(layoutScenario==='storefront-error'){
          await waitFor("!!document.querySelector('.sf-product')");
          await waitFor("!!document.querySelector('.sf-hero-default')");
          assert.equal(await evaluate("!!document.querySelector('.header-category-tab')"),false,'No fallback categories on outage');
          assert.equal(await evaluate("!!document.querySelector('.sf-splash')"),false);
          assert.equal(await evaluate("getComputedStyle(document.querySelector('.sf-storefront')).getPropertyValue('--sf-primary').trim()"),'#B50918');
        }else if(layoutScenario==='storefront-default'){
          await waitFor("!!document.querySelector('.sf-hero-default')");
          assert.equal(await evaluate("!!document.querySelector('.header-category-tab')"),false,'No default header categories');
          assert.equal(await evaluate("!!document.querySelector('.sf-carousel-controls')"),false,'Only the default banner');
        }else{
          await waitFor("!!document.querySelector('.sf-hero') && !!document.querySelector('.sf-product')");
          assert.equal(await evaluate("document.querySelectorAll('.header-sub-nav-scroll .header-category-tab').length"),8,'All configured categories are header tabs');
          assert.equal(await evaluate("!!document.querySelector('.sf-hero-default')"),false,'Admin banner replaces the default');
          assert.ok(await evaluate("(()=>{const tabs=[...document.querySelectorAll('.header-category-tab')];return tabs.every(tab=>tab.offsetTop===tabs[0].offsetTop);})()"),'Categories share one header row');
          assert.ok(await evaluate("document.querySelector('.sf-section').textContent.includes('Fresh picks for you')"));
          await evaluate("document.querySelector('[aria-label=\\\"Pause promotions\\\"]').click()");
          await evaluate("document.querySelector('[aria-label=\\\"Next promotion\\\"]').click()");
          assert.ok(await evaluate("document.querySelector('.sf-hero').textContent.includes('Shop the collection')"));
          if(layoutScenario.includes('splash'))assert.equal(await evaluate("!!document.querySelector('.sf-splash')"),false,'Rerender does not reopen splash');
          if(layoutScenario==='storefront-category'){
            await evaluate("document.querySelector('.header-category-tab').click()");
            await waitFor("location.pathname==='/grocery--fresh' && !!document.querySelector('.section-products-grid .grid-product-card')");
            assert.ok(await evaluate("document.querySelector('.header-category-tab[aria-current=page]').textContent.includes('Fresh category')"));
          }
        }
      }
      if(width===390||width===1440){const directory=resolve('../test-artifacts/storefront');await mkdir(directory,{recursive:true});await writeFile(join(directory,(layoutScenario||'studio')+'-'+width+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));}
      if (startupOnly) {`);
source = source.replaceAll('../test-artifacts/mobile-native', '../test-artifacts/storefront/geometry').replaceAll('../test-artifacts/mobile-layout', '../test-artifacts/storefront/layout');
try {
  await writeFile(generated, source);
  const code = await new Promise((resolve, reject) => {
    const paths = splashPreviewOnly ? '/admin/storefront-studio' : splashScreenOnly ? '/?layout=storefront-splash,/?layout=storefront-splash-video,/admin/storefront-studio' : '/?layout=storefront,/?layout=storefront-default,/?layout=storefront-splash,/?layout=storefront-splash-video,/?layout=storefront-error,/?layout=storefront-category,/?layout=storefront-refresh,/search,/cart,/checkout,/wholesale,/admin/storefront-studio';
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--full', '--paths='+paths, splashPreviewOnly ? '--widths=390,1440' : splashScreenOnly ? '--widths=320,390,430,1440' : '--widths=320,360,390,430,768,1440', '--label=storefront', '--cart-checkout'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0, 'Storefront browser assertions failed');
} finally { await rm(generated, { force: true }); }
