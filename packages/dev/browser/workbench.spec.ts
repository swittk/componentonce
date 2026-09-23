import { test, expect } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createComponentOnceDevServer } from "../dist/index.js";
import { parseTrustedComponentPackage, prepareTrustedComponentPackageAssets, instantiateTrustedComponentPackage } from "@componentonce/runtime";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ComponentOnceReact from "@componentonce/react";

test("workbench loads real host; edits/rebuilds recover; assets clean up; export is a production package", async ({ page }) => {
  const dir=await mkdtemp(join(tmpdir(),'componentonce-browser-'));
  await cp(resolve('examples'),dir,{recursive:true});
  const entry=join(dir,'card.tsx');
  const original=await readFile(entry,'utf8');
  const componentMarker='  component({ props, payload, context }) {\n    const [approved, setApproved] = React.useState(0);';
  if(!original.includes(componentMarker))throw new Error('Example component changed; update browser regression setup');
  const host=join(dir,'host.ts');
  let hostSource=await readFile(host,'utf8');
  const exportMarker='export default defineReactDevHost({';
  const firstFixtureMarker='      props: {\n        title: "Build something worth sharing",';
  const resultMarker='        return { accepted: true, approved };';
  if(!hostSource.includes(exportMarker)||!hostSource.includes(firstFixtureMarker)||!hostSource.includes(resultMarker))throw new Error('Example host changed; update browser regression setup');
  hostSource=hostSource
    .replace('import { defineReactDevHost } from "@componentonce/dev/host";','import { defineReactDevHost } from "@componentonce/dev/host";\nimport * as React from "react";')
    .replace(exportMarker,'const sharedFixtureValue = { marker: "shared-fixture" };\n\n'+exportMarker+'\n  wrap(element) { return React.createElement(React.StrictMode, null, element); },')
    .replace(firstFixtureMarker,'      props: {\n        sharedFixtureA: sharedFixtureValue,\n        sharedFixtureB: sharedFixtureValue,\n        title: "Build something worth sharing",')
    .replace(resultMarker,'        const sharedResult = { marker: "shared-result" };\n        return { accepted: true, approved, metadataHasOwnProto: Object.prototype.hasOwnProperty.call(metadata, "__proto__"), first: sharedResult, second: sharedResult };');
  const browserHostSource=hostSource+'\nif (typeof window === "undefined") throw new Error("Host must never run in Node");\n';
  await writeFile(host,browserHostSource);
  const server=await createComponentOnceDevServer({entry,host,cwd:resolve('.'),port:0});
  const pageErrors:string[]=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  try {
    const response=await page.goto(server.url,{waitUntil:'domcontentloaded'});
    expect(response?.status()).toBe(200);
    await expect(page.locator('#status')).toContainText('Live · revision',{timeout:15000});
    const preview=page.frameLocator('#preview');
    await expect(preview.locator('h1')).toHaveText('Build something worth sharing');
    await expect(preview.locator('body')).toContainText('$4,200');
    await expect(preview.locator('img')).toHaveJSProperty('naturalWidth',34);
    await expect(page.locator('#theme')).toBeVisible();
    await page.locator('#theme').selectOption('dark');
    await expect(preview.locator('html')).toHaveAttribute('data-theme','dark');
    await preview.getByRole('button',{name:'Approve milestone'}).click();
    await expect(preview.getByTestId('approved')).toHaveText('1');
    await expect(page.locator('#function-catalog')).toContainText('recordApproval');
    await expect(page.locator('#function-catalog')).toContainText('mock');
    await expect(page.locator('#function-calls')).toContainText('recordApproval');
    await expect(page.locator('#function-calls .function-call')).toHaveCount(1);
    await expect(page.locator('#function-calls')).toContainText('brand-fixture');
    await expect(page.locator('#function-calls')).toContainText('Studio North · Brand refresh');
    await expect(page.locator('#function-calls')).toContainText('returned');
    await expect(page.locator('#function-calls')).toContainText('"first":{"marker":"shared-result"}');
    await expect(page.locator('#function-calls')).toContainText('"second":{"marker":"shared-result"}');
    await expect(page.locator('#function-calls')).not.toContainText('[Circular]');

    await writeFile(host,browserHostSource+'\n// Force one host rebuild to reset the preview call-id namespace.\n');
    await expect(page.locator('#function-calls')).toHaveText('No calls yet.',{timeout:15000});
    await expect(preview.locator('h1')).toHaveText('Build something worth sharing');
    await preview.getByRole('button',{name:'Approve milestone'}).click();
    await expect(page.locator('#function-calls .function-call')).toHaveCount(1);
    await expect(page.locator('#function-calls')).toContainText('recordApproval');

    await page.evaluate(()=>{
      const frame=document.querySelector<HTMLIFrameElement>('#preview');
      if(!frame?.contentWindow)throw new Error('Missing preview frame');
      const shared={marker:'shared-input'};
      frame.contentWindow.postMessage({
        componentonce:true,
        type:'inputs',
        value:{
          props:{
            title:'Shared reference input',
            actionLabel:'Approve milestone',
            onApprove:{$componentonceFunction:'recordApproval'},
            sharedInputA:shared,
            sharedInputB:shared,
          },
          payload:{project:'Studio North · Brand refresh',amount:4200},
          context:{locale:'en-US',currency:'USD'},
        },
      },window.location.origin);
    });
    await expect(preview.locator('h1')).toHaveText('Shared reference input');
    await expect(page.locator('#error-overlay')).toBeHidden();
    await page.evaluate(()=>{ document.documentElement.dataset.testSentinel='stays'; });
    await page.locator('#props').fill(JSON.stringify({
      title:'My live component',
      actionLabel:'Approve milestone',
      onApprove:{$componentonceFunction:'recordApproval',bind:[{source:'edited-fixture'}]},
    }));
    await page.getByRole('button',{name:'Apply inputs'}).click();
    await expect(preview.locator('h1')).toHaveText('My live component');

    await preview.getByRole('button',{name:'Approve milestone'}).evaluate((button)=>{
      button.addEventListener('click',()=>{throw new Error('event handler boom');},{once:true});
    });
    await preview.getByRole('button',{name:'Approve milestone'}).click();
    await expect(page.locator('#error-overlay')).toBeVisible();
    await expect(page.locator('#error-overlay-text')).toContainText('event handler boom');
    await page.getByRole('button',{name:'Apply inputs'}).click();
    await expect(page.locator('#error-overlay')).toBeHidden();

    await page.locator('#props').fill(JSON.stringify({
      title:'Broken function reference',
      actionLabel:'Approve milestone',
      onApprove:{$componentonceFunction:'missingAction'},
    }));
    await page.getByRole('button',{name:'Apply inputs'}).click();
    await expect(page.locator('#error-overlay')).toBeVisible();
    await expect(page.locator('#error-overlay-text')).toContainText('unknown host function "missingAction"');
    await expect(preview.locator('h1')).toHaveText('My live component');

    await page.locator('#props').fill(JSON.stringify({
      title:'My live component',
      actionLabel:'Approve milestone',
      onApprove:{$componentonceFunction:'recordApproval',bind:[{source:'edited-fixture'}]},
    }));
    await page.getByRole('button',{name:'Apply inputs'}).click();
    await expect(page.locator('#error-overlay')).toBeHidden();

    await page.locator('#props').fill('{"title":"Own proto fixture","actionLabel":"Approve milestone","onApprove":{"$componentonceFunction":"recordApproval","bind":[{"source":"proto-fixture","__proto__":{"marker":"fixture-data"}}]}}');
    await page.getByRole('button',{name:'Apply inputs'}).click();
    await expect(preview.locator('h1')).toHaveText('Own proto fixture');
    await preview.getByRole('button',{name:'Approve milestone'}).click();
    await expect(page.locator('#function-calls')).toContainText('\"metadataHasOwnProto\":true');

    await page.locator('#props').fill(JSON.stringify({
      title:'My live component',
      actionLabel:'Approve milestone',
      onApprove:{$componentonceFunction:'recordApproval',bind:[{source:'edited-fixture'}]},
    }));
    await page.getByRole('button',{name:'Apply inputs'}).click();
    await expect(preview.locator('h1')).toHaveText('My live component');

    await writeFile(entry,original.replace('Interactive React state','Source save is live'));
    await expect(preview.locator('body')).toContainText('Source save is live');
    await expect(preview.locator('h1')).toHaveText('My live component');
    await expect(preview.getByTestId('approved')).toHaveText('0');
    expect(await page.evaluate(()=>document.documentElement.dataset.testSentinel)).toBe('stays');
    await writeFile(entry,original.replace(componentMarker,componentMarker.replace('    const [approved, setApproved] = React.useState(0);','    throw new Error("candidate render boom");\n    const [approved, setApproved] = React.useState(0);')));
    await expect(page.locator('#error-overlay')).toBeVisible();
    await expect(page.locator('#error-overlay-text')).toContainText('candidate render boom');
    await expect(preview.locator('h1')).toHaveText('My live component');
    await writeFile(entry,original.replace('Interactive React state','Source save is live'));
    await expect(page.locator('#error-overlay')).toBeHidden();
    await expect(preview.locator('body')).toContainText('Source save is live');
    const goodRevision=await page.locator('#revision').innerText();

    await writeFile(entry,'export const = bad syntax');
    await expect(page.locator('#diagnostics')).not.toHaveText('No diagnostics.');
    await expect(page.locator('#error-overlay')).toBeVisible();
    await expect(page.locator('#error-overlay-text')).not.toBeEmpty();
    await expect(preview.locator('h1')).toHaveText('My live component');
    expect(await page.locator('#revision').innerText()).toBe(goodRevision);
    await writeFile(entry,original);
    await expect(page.locator('#diagnostics')).toHaveText('No diagnostics.');
    await expect(page.locator('#error-overlay')).toBeHidden();
    await expect(preview.locator('body')).toContainText('Interactive React state');
    const oldUrl=await preview.locator('img').getAttribute('src');
    const cssPath=join(dir,'card.module.css');
    await writeFile(cssPath,(await readFile(cssPath,'utf8'))+'\n.card h1{color:rgb(11, 72, 91)}\n');
    await expect(preview.locator('h1')).toHaveCSS('color','rgb(11, 72, 91)');
    const imagePath=join(dir,'logo.svg');
    await writeFile(imagePath,(await readFile(imagePath,'utf8')).replace('#e5f3f3','#ddeeff'));
    await expect(preview.locator('img')).not.toHaveAttribute('src',oldUrl!);
    await expect(preview.locator('img')).toHaveJSProperty('naturalWidth',34);
    const countBefore=await preview.locator('style').count();
    for(let i=0;i<3;i++) {
      const revision=await page.locator('#revision').innerText();
      await writeFile(entry,original.replace('Interactive React state','Update '+i));
      await expect(page.locator('#revision')).not.toHaveText(revision);
    }
    expect(await preview.locator('style').count()).toBe(countBefore);
    await page.locator('#viewport').selectOption('375px');
    await expect(page.locator('#preview-shell')).toHaveCSS('width','375px');
    const shellBefore=await page.locator('#preview-shell').boundingBox();
    const handle=await page.locator('#resize-handle').boundingBox();
    if(!shellBefore||!handle)throw new Error('Missing resize geometry');
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
    await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2+90,handle.y+handle.height/2+70,{steps:5});
    await page.mouse.up();
    await expect(page.locator('#viewport')).toHaveValue('custom');
    const shellAfter=await page.locator('#preview-shell').boundingBox();
    expect(shellAfter?.width ?? 0).toBeGreaterThan(shellBefore.width+50);
    expect(shellAfter?.height ?? 0).toBeGreaterThan(shellBefore.height+40);
    await expect(page.locator('#dimensions')).toContainText('×');
    await page.locator('#fixtures').selectOption('1');
    await expect(preview.locator('h1')).toHaveText('A different host, same component');
    await expect(preview.locator('body')).toContainText('48,000');
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export package'}).click();
    const download=await downloaded;
    const file=await download.path();
    expect(file).toBeTruthy();
    const pkg=parseTrustedComponentPackage(await readFile(file!));
    expect(pkg.manifest.id).toBe('example/project-card');
    if(pkg.format!=='componentonce.trusted-package.v2')throw new Error('Expected v2');
    const assets=await prepareTrustedComponentPackageAssets(pkg,{resolveAssetUrl:asset=>'https://example.test/'+asset.sha256});
    const definition=await instantiateTrustedComponentPackage(pkg,{preparedAssets:assets,externals:{react:React,'react/jsx-runtime':JsxRuntime,'@componentonce/react':ComponentOnceReact}});
    expect(definition.manifest).toEqual(pkg.manifest);assets.dispose();
    await page.locator('#viewport').selectOption('100%');
    await page.locator('#fixtures').selectOption('0');
    await mkdir(resolve('../../.artifacts/dev'),{recursive:true});
    await page.screenshot({path:resolve('../../.artifacts/dev/workbench.png')});
    expect(pageErrors.filter((message)=>!message.includes('event handler boom'))).toEqual([]);
  } finally {await server.close();await rm(dir,{recursive:true,force:true});}
});
