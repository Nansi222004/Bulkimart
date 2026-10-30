import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const generated = new URL(`../tests/.admin-navigation-${process.pid}.mjs`, import.meta.url);
let source = await readFile(new URL('../tests/mobile-layout.test.mjs', import.meta.url), 'utf8');
const replace = (marker, value) => { assert.ok(source.includes(marker), `Missing browser marker: ${marker}`); source = source.replace(marker, value); };
replace("'--headless=new', '--remote-debugging-port=0'", "'--headless=new', '--disable-gpu', '--remote-debugging-port=0'");
replace("const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();", "const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');");
replace('      if (startupOnly) {', `
      if(path.startsWith('/admin')){
        await waitFor("!!document.querySelector('.sa-header-title') && !!document.querySelector('.sa-sidebar')");
        const expected = path==='/admin'?'Dashboard':path.includes('reports')?'Reports':path.includes('delivery')?'Delivery Partners':path.includes('storefront')?'Storefront Studio':path.includes('user-dashboard')?'Consumer Users':'Sellers / Vendors';
        await waitFor("document.querySelector('.sa-header-title').textContent==="+JSON.stringify(expected));
        if(path.includes('delivery'))assert.equal(await evaluate('location.pathname'),'/admin/deliverypartner');
        if(await evaluate("document.querySelector('.sa-sidebar').classList.contains('collapsed')"))await evaluate("document.querySelector('.sa-collapse-btn').click()");
        const verifyNavigation = async()=>{
          assert.deepEqual(await evaluate("[...document.querySelectorAll('.sa-nav-group-title')].map(n=>n.textContent)"),['Platform','User Management','Vendor Management','Product Management','Order Management','Delivery Management','Marketing & CMS','Returns & Refunds','Settings','FINANCE']);
          assert.equal(await evaluate("document.querySelector('.sa-sidebar').textContent.includes('Show All Sidebar Groups')"),false);
          for(const title of ['Reports','Users','Sellers / Vendors','Delivery Partners','Storefront Studio','Banners','Finance Center'])assert.ok(await evaluate("Array.from(document.querySelectorAll('.sa-nav-link')).some(n=>n.title==="+JSON.stringify(title)+")"),title);
        };
        await verifyNavigation();
        await evaluate("document.querySelector('.sa-nav-link[title=\\"Reports\\"]').click()");await waitFor("location.pathname==='/admin/reports'&&document.querySelector('.sa-header-title').textContent==='Reports'");await verifyNavigation();
        await evaluate("document.querySelector('.sa-nav-link[title=\\"Delivery Partners\\"]').click()");await waitFor("location.pathname==='/admin/deliverypartner'&&document.querySelector('.sa-header-title').textContent==='Delivery Partners'");await verifyNavigation();
        assert.ok(await evaluate("!!document.querySelector('.sa-nav-link[title=\\"Delivery Tracking\\"]')"));
        await evaluate('history.back()');await waitFor("location.pathname==='/admin/reports'&&document.querySelector('.sa-header-title').textContent==='Reports'");
        await evaluate('history.forward()');await waitFor("location.pathname==='/admin/deliverypartner'&&document.querySelector('.sa-header-title').textContent==='Delivery Partners'");
        await command('Page.reload');await waitFor("document.querySelector('.sa-header-title')?.textContent==='Delivery Partners'");await verifyNavigation();
        const directory=resolve('../test-artifacts/admin-navigation');await mkdir(directory,{recursive:true});
        if(path==='/admin/deliverypartner')await writeFile(join(directory,'delivery-partners-'+width+'.png'),Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
      }
      if (startupOnly) {`);
source = source.replaceAll('../test-artifacts/mobile-native', '../test-artifacts/admin-navigation/geometry').replaceAll('../test-artifacts/mobile-layout', '../test-artifacts/admin-navigation/layout');
try {
  await writeFile(generated, source);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [generated.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--full', '--paths=/admin,/admin/reports,/admin/deliverypartner,/admin/delivery-dashboard,/admin/storefront-studio,/admin/user-dashboard,/admin/vendor-dashboard', '--widths=390,1280', '--label=admin-navigation'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0, 'Admin navigation application assertions failed');
} finally { await rm(generated, { force: true }); }
