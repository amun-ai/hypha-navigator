import { readFileSync } from "node:fs"; import { Window } from "happy-dom"; import vm from "node:vm";
for (const f of ["background.js","content.js","offscreen.js"]) {
  const win=new Window({url:"https://x/"}); const s=win; s.self=s;s.globalThis=s;s.window=s;
  s.chrome={runtime:{onMessage:{addListener:()=>{}},sendMessage:()=>Promise.resolve(),getContexts:async()=>[],onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}},storage:{local:{get:async()=>({}),set:async()=>{}}},tabs:{onRemoved:{addListener:()=>{}}},sidePanel:{setPanelBehavior:async()=>{}},alarms:{create:()=>{},onAlarm:{addListener:()=>{}}},debugger:{onDetach:{addListener:()=>{}}}};
  s.WebSocket=class{}; s.eval=()=>{throw new EvalError("CSP")}; const RF=s.Function; function BF(){throw new EvalError("CSP")} BF.prototype=RF.prototype; s.Function=BF;
  let t=null; try{ vm.runInContext(readFileSync("../extension/dist/"+f,"utf8"), vm.createContext(s), {filename:f}); }catch(e){ t=e; }
  console.log(f.padEnd(14), t? "THREW: "+t.message.slice(0,40) : "loads clean ✓");
}
