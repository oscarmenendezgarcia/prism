"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs2    = require("fs");
const os     = require("os");
const path   = require("path");
const http   = require("http");

const { createTemplateManager } = require("../src/services/templateManager");
const { startServer }           = require("../server");

function tmpDir() { return fs2.mkdtempSync(path.join(os.tmpdir(),"prism-tmpl-")); }

function req(port,method,urlPath,body) {
  return new Promise((resolve,reject) => {
    const pl=body!==undefined?JSON.stringify(body):undefined;
    const opts={hostname:"localhost",port,path:urlPath,method,
      headers:{"Content-Type":"application/json",...(pl!==undefined&&{"Content-Length":Buffer.byteLength(pl)})}};
    const r=http.request(opts,(res)=>{
      const ch=[];res.on("data",(c)=>ch.push(c));
      res.on("end",()=>{const raw=Buffer.concat(ch).toString("utf8");let p;try{p=JSON.parse(raw);}catch{p=raw;}resolve({status:res.statusCode,body:p});});
    });
    r.on("error",reject);if(pl!==undefined)r.write(pl);r.end();
  });
}

function initDataDir(dir) {
  fs2.mkdirSync(path.join(dir,"spaces"),{recursive:true});
  const sp=[{id:"default",name:"General",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
  fs2.writeFileSync(path.join(dir,"spaces.json"),JSON.stringify(sp),"utf8");
  const dd=path.join(dir,"spaces","default");
  fs2.mkdirSync(dd,{recursive:true});
  ["todo","in-progress","done"].forEach(function(f){fs2.writeFileSync(path.join(dd,f+".json"),"[]","utf8");});
}

function listenPort(srv){return new Promise((r)=>srv.once("listening",()=>r(srv.address().port)));}

// --- Unit tests ---

describe("templateManager unit",()=>{
  test("listTemplates returns [] on fresh dir",()=>{
    const d=tmpDir();const tm=createTemplateManager(d);
    assert.deepEqual(tm.listTemplates(),[]);
    fs2.rmSync(d,{recursive:true,force:true});
  });
  test("createTemplate happy path",()=>{
    const d=tmpDir();const tm=createTemplateManager(d);
    const r=tm.createTemplate({name:"My Pipeline",stages:["developer-agent","qa-engineer-e2e"]});
    assert.equal(r.ok,true);
    assert.ok(typeof r.template.id==="string");
    assert.equal(r.template.name,"My Pipeline");
    assert.deepEqual(r.template.stages,["developer-agent","qa-engineer-e2e"]);
    assert.deepEqual(r.template.checkpoints,[false,false]);
    assert.equal(r.template.useOrchestratorMode,false);
    fs2.rmSync(d,{recursive:true,force:true});
  });
  test("createTemplate duplicate name rejected",()=>{
    const d=tmpDir();const tm=createTemplateManager(d);
    tm.createTemplate({name:"Full Run",stages:["developer-agent"]});
    const r=tm.createTemplate({name:"full run",stages:["qa-engineer-e2e"]});
    assert.equal(r.ok,false);assert.equal(r.code,"DUPLICATE_NAME");
    fs2.rmSync(d,{recursive:true,force:true});
  });
  test("createTemplate invalid checkpoints rejected",()=>{
    const d=tmpDir();const tm=createTemplateManager(d);
    const r=tm.createTemplate({name:"Bad",stages:["developer-agent"],checkpoints:[true,1]});
    assert.equal(r.ok,false);assert.equal(r.code,"VALIDATION_ERROR");
    fs2.rmSync(d,{recursive:true,force:true});
  });
  test("updateTemplate not found",()=>{
    const d=tmpDir();const tm=createTemplateManager(d);
    const r=tm.updateTemplate("no-id",{name:"x"});
    assert.equal(r.ok,false);assert.equal(r.code,"TEMPLATE_NOT_FOUND");
    fs2.rmSync(d,{recursive:true,force:true});
  });
  test("deleteTemplate happy path",()=>{
    const d=tmpDir();const tm=createTemplateManager(d);
    const cr=tm.createTemplate({name:"Del",stages:["developer-agent"]});
    const id=cr.template.id;
    const dr=tm.deleteTemplate(id);
    assert.equal(dr.ok,true);assert.equal(dr.id,id);
    assert.deepEqual(tm.listTemplates(),[]);
    fs2.rmSync(d,{recursive:true,force:true});
  });
});

// --- Integration tests ---

describe("GET /api/v1/pipeline-templates",()=>{
  var sv,pt,dir;
  before(async()=>{dir=tmpDir();initDataDir(dir);sv=startServer({port:0,dataDir:dir,silent:true});pt=await listenPort(sv);});
  after(()=>{sv.close();fs2.rmSync(dir,{recursive:true,force:true});});
  test("returns [] when empty",async()=>{
    const r=await req(pt,"GET","/api/v1/pipeline-templates");
    assert.equal(r.status,200);assert.deepEqual(r.body,[]);
  });
});

describe("POST /api/v1/pipeline-templates",()=>{
  var sv,pt,dir;
  before(async()=>{dir=tmpDir();initDataDir(dir);sv=startServer({port:0,dataDir:dir,silent:true});pt=await listenPort(sv);});
  after(()=>{sv.close();fs2.rmSync(dir,{recursive:true,force:true});});
  test("201 with correct shape",async()=>{
    const r=await req(pt,"POST","/api/v1/pipeline-templates",{name:"Standard",stages:["senior-architect","developer-agent"]});
    assert.equal(r.status,201);
    assert.ok(typeof r.body.id==="string");
    assert.equal(r.body.name,"Standard");
    assert.deepEqual(r.body.stages,["senior-architect","developer-agent"]);
    assert.deepEqual(r.body.checkpoints,[false,false]);
    assert.equal(r.body.useOrchestratorMode,false);
  });
  test("400 missing name",async()=>{
    const r=await req(pt,"POST","/api/v1/pipeline-templates",{stages:["developer-agent"]});
    assert.equal(r.status,400);assert.equal(r.body.error.code,"VALIDATION_ERROR");
  });
  test("400 missing stages",async()=>{
    const r=await req(pt,"POST","/api/v1/pipeline-templates",{name:"No Stages"});
    assert.equal(r.status,400);assert.equal(r.body.error.code,"VALIDATION_ERROR");
  });
  test("400 empty stages array",async()=>{
    const r=await req(pt,"POST","/api/v1/pipeline-templates",{name:"Empty",stages:[]});
    assert.equal(r.status,400);assert.equal(r.body.error.code,"VALIDATION_ERROR");
  });
  test("409 duplicate name case-insensitive",async()=>{
    await req(pt,"POST","/api/v1/pipeline-templates",{name:"Dupe",stages:["developer-agent"]});
    const r=await req(pt,"POST","/api/v1/pipeline-templates",{name:"dupe",stages:["qa-engineer-e2e"]});
    assert.equal(r.status,409);assert.equal(r.body.error.code,"DUPLICATE_NAME");
  });
  test("checkpoints auto-padded",async()=>{
    const r=await req(pt,"POST","/api/v1/pipeline-templates",{name:"ShortCP",stages:["a","b","c"],checkpoints:[true]});
    assert.equal(r.status,201);assert.deepEqual(r.body.checkpoints,[true,false,false]);
  });
});

describe("PUT /api/v1/pipeline-templates/:id",()=>{
  var sv,pt,dir;
  before(async()=>{dir=tmpDir();initDataDir(dir);sv=startServer({port:0,dataDir:dir,silent:true});pt=await listenPort(sv);});
  after(()=>{sv.close();fs2.rmSync(dir,{recursive:true,force:true});});
  test("200 partial update name only",async()=>{
    const cr=await req(pt,"POST","/api/v1/pipeline-templates",{name:"Old",stages:["developer-agent"]});
    const id=cr.body.id;
    const r=await req(pt,"PUT","/api/v1/pipeline-templates/"+id,{name:"New"});
    assert.equal(r.status,200);assert.equal(r.body.name,"New");assert.deepEqual(r.body.stages,["developer-agent"]);
  });
  test("404 unknown id",async()=>{
    const r=await req(pt,"PUT","/api/v1/pipeline-templates/nope",{name:"x"});
    assert.equal(r.status,404);assert.equal(r.body.error.code,"TEMPLATE_NOT_FOUND");
  });
  test("stages update reconciles checkpoints",async()=>{
    const cr=await req(pt,"POST","/api/v1/pipeline-templates",{name:"Rec",stages:["a","b"],checkpoints:[true,false]});
    const id=cr.body.id;
    const r=await req(pt,"PUT","/api/v1/pipeline-templates/"+id,{stages:["a","b","c"]});
    assert.equal(r.status,200);assert.deepEqual(r.body.checkpoints,[true,false,false]);
  });
});

describe("DELETE /api/v1/pipeline-templates/:id",()=>{
  var sv,pt,dir;
  before(async()=>{dir=tmpDir();initDataDir(dir);sv=startServer({port:0,dataDir:dir,silent:true});pt=await listenPort(sv);});
  after(()=>{sv.close();fs2.rmSync(dir,{recursive:true,force:true});});
  test("200 { deleted: true, id }",async()=>{
    const cr=await req(pt,"POST","/api/v1/pipeline-templates",{name:"Del",stages:["developer-agent"]});
    const id=cr.body.id;
    const r=await req(pt,"DELETE","/api/v1/pipeline-templates/"+id);
    assert.equal(r.status,200);assert.equal(r.body.deleted,true);assert.equal(r.body.id,id);
  });
  test("404 unknown id",async()=>{
    const r=await req(pt,"DELETE","/api/v1/pipeline-templates/nope");
    assert.equal(r.status,404);assert.equal(r.body.error.code,"TEMPLATE_NOT_FOUND");
  });
});

describe("persistence across restart",()=>{
  test("templates survive server restart",async()=>{
    const dir=tmpDir();initDataDir(dir);
    const s1=startServer({port:0,dataDir:dir,silent:true});
    const p1=await listenPort(s1);
    const cr=await req(p1,"POST","/api/v1/pipeline-templates",{name:"Persist",stages:["developer-agent"]});
    assert.equal(cr.status,201);
    const id=cr.body.id;
    await new Promise((r)=>s1.close(r));
    const s2=startServer({port:0,dataDir:dir,silent:true});
    const p2=await listenPort(s2);
    const lr=await req(p2,"GET","/api/v1/pipeline-templates");
    assert.equal(lr.status,200);
    assert.ok(lr.body.some(function(t){return t.id===id;}));
    await new Promise((r)=>s2.close(r));
    fs2.rmSync(dir,{recursive:true,force:true});
  });
});
