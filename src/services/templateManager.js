'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATE_NAME_MAX = 100;

function createTemplateManager(dataDir) {
  const filePath = path.join(dataDir, 'pipeline-templates.json');
  function readTemplates() {
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw=fs.readFileSync(filePath,'utf8');const p=JSON.parse(raw);return Array.isArray(p)?p:[];
    } catch(e){return [];}
  }
  function writeTemplates(ts) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir,{recursive:true});
    const tmp=filePath+'.tmp';fs.writeFileSync(tmp,JSON.stringify(ts,null,2),'utf8');fs.renameSync(tmp,filePath);
  }
  function valFields(f,opts,list,excl) {
    excl=excl||null;
    var n=f.name,s=f.stages,cp=f.checkpoints,uom=f.useOrchestratorMode;
    if(opts.requireName||n!==undefined){
      if(!n||typeof n!=='string'||n.trim().length===0) return{ok:false,code:'VALIDATION_ERROR',message:'name is required and must be a non-empty string'};
      if(n.trim().length>TEMPLATE_NAME_MAX) return{ok:false,code:'VALIDATION_ERROR',message:'name must not exceed '+TEMPLATE_NAME_MAX+' characters'};
      var lc=n.trim().toLowerCase();
      var dup=list.find(function(t){return t.name.toLowerCase()===lc&&t.id!==excl;});
      if(dup) return{ok:false,code:'DUPLICATE_NAME',message:'A template named '+n.trim()+' already exists'};
    }
    if(opts.requireStages||s!==undefined){
      if(!Array.isArray(s)||s.length===0) return{ok:false,code:'VALIDATION_ERROR',message:'stages must be a non-empty array'};
      for(var i=0;i<s.length;i++) if(typeof s[i]!=='string'||s[i].trim().length===0) return{ok:false,code:'VALIDATION_ERROR',message:'stages['+i+'] must be a non-empty string'};
    }
    if(cp!==undefined){
      if(!Array.isArray(cp)) return{ok:false,code:'VALIDATION_ERROR',message:'checkpoints must be a boolean array when provided'};
      for(var j=0;j<cp.length;j++) if(typeof cp[j]!=='boolean') return{ok:false,code:'VALIDATION_ERROR',message:'checkpoints['+j+'] must be a boolean'};
    }
    if(uom!==undefined&&typeof uom!=='boolean') return{ok:false,code:'VALIDATION_ERROR',message:'useOrchestratorMode must be a boolean when provided'};
    return{ok:true};
  }
  function reconcileCp(cp,stages) {
    var len=stages.length;
    if(!cp) return new Array(len).fill(false);
    if(cp.length===len) return cp;
    if(cp.length<len) return cp.concat(new Array(len-cp.length).fill(false));
    return cp.slice(0,len);
  }
  function listTemplates(){return readTemplates();}
  function getTemplate(id) {
    var list=readTemplates();var t=list.find(function(x){return x.id===id;});
    if(!t) return{ok:false,code:'TEMPLATE_NOT_FOUND',message:'Template '+id+' not found'};
    return{ok:true,template:t};
  }
  function createTemplate(payload) {
    if(!payload||typeof payload!=='object') return{ok:false,code:'VALIDATION_ERROR',message:'Request body must be a JSON object'};
    var list=readTemplates();
    var v=valFields(payload,{requireName:true,requireStages:true},list,null);
    if(!v.ok) return v;
    var ns=payload.stages.map(function(s){return s.trim();});
    var nc=reconcileCp(payload.checkpoints,ns);
    var now=new Date().toISOString();
    var uom=payload.useOrchestratorMode!==undefined?Boolean(payload.useOrchestratorMode):false;
    var tmpl={id:crypto.randomUUID(),name:payload.name.trim(),stages:ns,checkpoints:nc,useOrchestratorMode:uom,createdAt:now,updatedAt:now};
    list.push(tmpl);writeTemplates(list);
    return{ok:true,template:tmpl};
  }
  function updateTemplate(id,payload) {
    if(!payload||typeof payload!=='object') return{ok:false,code:'VALIDATION_ERROR',message:'Request body must be a JSON object'};
    var list=readTemplates();
    var idx=list.findIndex(function(t){return t.id===id;});
    if(idx===-1) return{ok:false,code:'TEMPLATE_NOT_FOUND',message:'Template '+id+' not found'};
    var v=valFields(payload,{requireName:false,requireStages:false},list,id);
    if(!v.ok) return v;
    var ex=list[idx];
    var ns=payload.stages!==undefined?payload.stages.map(function(s){return s.trim();}):ex.stages;
    var nc;
    if(payload.stages!==undefined||payload.checkpoints!==undefined){
      nc=reconcileCp(payload.checkpoints!==undefined?payload.checkpoints:ex.checkpoints,ns);
    } else{nc=ex.checkpoints;}
    var upd=Object.assign({},ex,{stages:ns,checkpoints:nc,updatedAt:new Date().toISOString()});
    if(payload.name!==undefined) upd.name=payload.name.trim();
    if(payload.useOrchestratorMode!==undefined) upd.useOrchestratorMode=Boolean(payload.useOrchestratorMode);
    list[idx]=upd;writeTemplates(list);
    return{ok:true,template:upd};
  }
  function deleteTemplate(id) {
    var list=readTemplates();
    var idx=list.findIndex(function(t){return t.id===id;});
    if(idx===-1) return{ok:false,code:'TEMPLATE_NOT_FOUND',message:'Template '+id+' not found'};
    list.splice(idx,1);writeTemplates(list);
    return{ok:true,id:id};
  }
  return{listTemplates,getTemplate,createTemplate,updateTemplate,deleteTemplate};
}

module.exports={createTemplateManager};
