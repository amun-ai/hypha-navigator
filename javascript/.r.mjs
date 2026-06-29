import { readFileSync } from "node:fs"; import { Window } from "happy-dom"; import vm from "node:vm";
const D="../extension/dist/"; const dialed=[]; const ui=[]; const local={hyphaConnected:true,hyphaConfig:{server_url:"https://hypha.aicell.io"}};
function store(o){return{get:async(k)=>{if(Array.isArray(k)){const r={};for(const x of k)r[x]=o[x];return r;}if(typeof k==="string")return{[k]:o[k]};return{...o};},set:async(x)=>Object.assign(o,x),remove:async(k)=>delete o[k]};}
const win=new Window({url:"https://x/"}); const s=win; s.self=s;s.globalThis=s;s.window=s;
s.WebSocket=class{constructor(u){dialed.push(u);setTimeout(()=>this._e&&this._e(new Event("error")),100);}send(){}close(){}addEventListener(){}removeEventListener(){}set onopen(f){}set onmessage(f){}set onclose(f){}set onerror(f){this._e=f;}get onerror(){return this._e;}};
s.chrome={runtime:{onMessage:{addListener:()=>{},removeListener:()=>{}},sendMessage:(m)=>{if(m&&m.__ui)ui.push(m);return Promise.resolve();}},storage:{local:store(local),session:store({})}};
vm.createContext(s); vm.runInContext(readFileSync(D+"offscreen.js","utf8"),s,{filename:"offscreen.js"});
await new Promise(r=>setTimeout(r,600));
console.log("dialed:",JSON.stringify(dialed));
console.log(dialed.includes("wss://hypha.aicell.io/ws")?"RESOLUTION OK ✓":"NOT DIALED ✗");
