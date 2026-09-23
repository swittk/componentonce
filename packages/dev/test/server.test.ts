import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { expect, it } from "vitest";
import { createComponentOnceDevServer } from "../dist/index.js";

async function waitFor(url: string, predicate: (state: {source: {ok:boolean;revision:number}}) => boolean) {
  const end=Date.now()+10000;
  while (Date.now()<end) {
    const state=await (await fetch(url+"/status")).json() as {source:{ok:boolean;revision:number}};
    if(predicate(state))return state;
    await new Promise((r)=>setTimeout(r,40));
  }
  throw new Error("Timed out waiting for dev server status");
}

it("serves only generated assets on loopback; rejects cross-origin/write requests; retains a last good build", async () => {
  const dir=await mkdtemp(join(tmpdir(),"componentonce-server-"));
  const entry=join(dir,"entry.tsx");
  await writeFile(entry,'export const definition={manifest:{id:"test/card",version:"1"},implementation:()=>null};');
  const server=await createComponentOnceDevServer({entry,cwd:resolve('.'),port:0});
  try {
    await waitFor(server.url,s=>s.source.ok);
    expect((await fetch(server.url)).status).toBe(200);
    expect((await fetch(server.url+'/ui.js')).headers.get('Content-Type')).toContain('javascript');
    expect((await fetch(server.url+'/preview.js')).status).toBe(200);
    for(const path of ['/.npmrc','/package.json','/src/entry.tsx','/..%2f..%2fetc/passwd'])expect((await fetch(server.url+path)).status).toBe(404);
    expect((await fetch(server.url+'/artifact',{headers:{Origin:'https://unrelated.invalid'}})).status).toBe(403);
    expect((await fetch(server.url+'/artifact',{method:'POST'})).status).toBe(405);
    const badHost=await new Promise<number|undefined>((done,reject)=>{const r=request(server.url,{headers:{Host:'unrelated.invalid'}},res=>{res.resume();done(res.statusCode)});r.on('error',reject);r.end();});
    expect(badHost).toBe(403);
    const previous=await (await fetch(server.url+'/artifact')).text();
    await writeFile(entry,'export const = broken');
    await waitFor(server.url,s=>!s.source.ok);
    expect(await (await fetch(server.url+'/artifact')).text()).toBe(previous);
    await writeFile(entry,'export const definition={manifest:{id:"test/fixed",version:"1"},implementation:()=>null};');
    await waitFor(server.url,s=>s.source.ok&&s.source.revision>1);
    expect(await (await fetch(server.url+'/artifact')).text()).toContain('test/fixed');
    expect((await fetch(server.url+'/artifact')).headers.get('Cache-Control')).toBe('no-store');
  }finally{await server.close();await server.close();await rm(dir,{recursive:true,force:true});}
},20000);


it("can bind all interfaces explicitly while retaining Host validation", async () => {
  const dir=await mkdtemp(join(tmpdir(),"componentonce-server-bind-"));
  const entry=join(dir,"entry.tsx");
  await writeFile(entry,'export const definition={manifest:{id:"test/card",version:"1"},implementation:()=>null};');
  const server=await createComponentOnceDevServer({
    entry,
    cwd:resolve("."),
    port:0,
    bind:"0.0.0.0",
    allowedHosts:["devbox.local"],
  });
  try {
    expect(server.bind).toBe("0.0.0.0");
    expect(server.port).toBeGreaterThan(0);
    expect(server.urls.some((url)=>url.startsWith("http://127.0.0.1:"))).toBe(true);
    await waitFor(server.url,s=>s.source.ok);

    const accepted=await new Promise<number|undefined>((done,reject)=>{
      const r=request(server.url,{headers:{Host:"devbox.local:"+server.port}},res=>{res.resume();done(res.statusCode)});
      r.on("error",reject);r.end();
    });
    expect(accepted).toBe(200);

    const rejected=await new Promise<number|undefined>((done,reject)=>{
      const r=request(server.url,{headers:{Host:"attacker.invalid:"+server.port}},res=>{res.resume();done(res.statusCode)});
      r.on("error",reject);r.end();
    });
    expect(rejected).toBe(403);
  } finally {
    await server.close();
    await rm(dir,{recursive:true,force:true});
  }
},20000);
