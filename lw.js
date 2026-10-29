/* liteya workflow: client-side decryption. Data is AES-256-GCM encrypted; key = PBKDF2-SHA256(login:password). */
(function(){
"use strict";
var SALT="63zn5yb+sR5FaiwBWKORpw==", ITER=600000, LS="lw_key_v1";
try{ window.EventSource=undefined; }catch(e){}
var origFetch=window.fetch.bind(window), te=new TextEncoder();
var resolveKey, keyP=new Promise(function(r){resolveKey=r;});
function b64(s){ return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0);}); }
function ub64(a){ var s=""; a=new Uint8Array(a); for(var i=0;i<a.length;i++) s+=String.fromCharCode(a[i]); return btoa(s); }
async function derive(u,p){
  var base=await crypto.subtle.importKey("raw",te.encode(u+":"+p),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:b64(SALT),iterations:ITER},base,{name:"AES-GCM",length:256},true,["decrypt"]);
}
async function load(key){
  var r=await origFetch("/data.enc?t="+Date.now(),{cache:"no-store"});
  if(!r.ok) throw new Error("net");
  var j=await r.json(), pt;
  try{ pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64(j.iv)},key,b64(j.ct)); }catch(e){ throw new Error("key"); }
  var ds=new Blob([pt]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(ds).text();
}
window.fetch=async function(u,o){
  var s=(typeof u==="string")?u:(u&&u.url)||"";
  if(s.split("?")[0]==="/api/state"){
    var key=await keyP, txt=await load(key);
    return new Response(txt,{status:200,headers:{"content-type":"application/json; charset=utf-8"}});
  }
  return origFetch(u,o);
};
function gate(){
  var d=document.createElement("div"); d.id="lwGate";
  d.style.cssText="position:fixed;inset:0;z-index:99999;background:#0b0f17;display:flex;align-items:center;justify-content:center;font:16px system-ui,sans-serif;color:#e6e9ef";
  d.innerHTML='<form style="display:flex;flex-direction:column;gap:10px;min-width:260px"><b style="font-size:18px">liteya · вход</b>'+
   '<input name="u" autocomplete="username" placeholder="логин" required style="padding:10px;border-radius:8px;border:1px solid #334;background:#111827;color:#fff">'+
   '<input name="p" type="password" autocomplete="current-password" placeholder="пароль" required style="padding:10px;border-radius:8px;border:1px solid #334;background:#111827;color:#fff">'+
   '<button style="padding:10px;border-radius:8px;border:0;background:#3b82f6;color:#fff;font-weight:600">Войти</button><span id="lwMsg" style="min-height:1.2em;color:#f87171"></span></form>';
  document.body.appendChild(d);
  var f=d.querySelector("form"), m=d.querySelector("#lwMsg");
  f.addEventListener("submit",async function(ev){
    ev.preventDefault(); m.style.color="#9ca3af"; m.textContent="проверяю…";
    try{
      var key=await derive(f.u.value,f.p.value); await load(key);
      try{ localStorage.setItem(LS,ub64(await crypto.subtle.exportKey("raw",key))); }catch(e){}
      d.remove(); resolveKey(key);
    }catch(e){ m.style.color="#f87171"; m.textContent=e.message==="key"?"неверный логин или пароль":"нет связи, попробуй ещё раз"; }
  });
}
async function start(){
  var saved=null; try{ saved=localStorage.getItem(LS); }catch(e){}
  if(saved){
    var key=null;
    try{ key=await crypto.subtle.importKey("raw",b64(saved),{name:"AES-GCM"},false,["decrypt"]); }catch(e){ key=null; }
    if(key){
      try{ await load(key); resolveKey(key); return; }
      catch(e){ if(e.message!=="key"){ resolveKey(key); return; } }
    }
    try{ localStorage.removeItem(LS); }catch(_){}
  }
  gate();
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start); else start();
})();
