/* liteya workflow: route mapping only; login + decrypt are /assets/crypto_gate.js (packages/crypto_gate, shared). */
(function(){
"use strict";
var ROUTES={"/api/state":"/data.enc"}, LS="lw_key_v1", origFetch=window.fetch.bind(window);
try{ window.EventSource=undefined; }catch(e){}
var gateP=new Promise(function(ok,bad){ var s=document.createElement("script"); s.src="/assets/crypto_gate.js";
  s.onload=function(){ ok(window.CryptoGate); }; s.onerror=function(){ bad(new Error("net")); }; document.head.appendChild(s); });
var ready=new Promise(function(r){ if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",r); else r(); });
var keyP=Promise.all([gateP,ready]).then(function(a){ return a[0].open({url:ROUTES["/api/state"],store:LS,fetch:origFetch}); });
window.fetch=async function(u,o){
  var s=(typeof u==="string")?u:(u&&u.url)||"", file=ROUTES[s.split("?")[0]];
  if(file){
    var g=await gateP, txt=await g.load(await keyP,file,origFetch);
    return new Response(txt,{status:200,headers:{"content-type":"application/json; charset=utf-8"}});
  }
  return origFetch(u,o);
};
})();
