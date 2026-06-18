import { chromium } from 'playwright'
const b = await chromium.launch(); const p = await b.newPage()
const errs=[],pe=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>pe.push(e.message))
await p.goto('http://localhost:8085/index.html',{waitUntil:'networkidle'}); await p.waitForTimeout(1500)
const box=await p.locator('#chart-container').boundingBox()
await p.mouse.move(box.x+box.width*0.6, box.y+box.height*0.5); await p.waitForTimeout(200)
const snap=()=>p.evaluate(()=>{const r=window.chart.range;const m=window.chart.layout.main;return {w:Math.round(r[1]-r[0]), A:m?+m.A.toFixed(1):null}})
// fire 3 notches ~80ms apart, sample width+A every ~16ms throughout
const samples=[]
let t0=Date.now()
const sampler = setInterval(async()=>{}, 0) // noop
for (let n=0;n<3;n++){
  await p.mouse.wheel(0,-120)
  for(let i=0;i<6;i++){ samples.push(await snap()); await p.waitForTimeout(18) }
}
// let it settle
for(let i=0;i<6;i++){ samples.push(await snap()); await p.waitForTimeout(18) }
console.log('width over time:', samples.map(s=>s.w).join(' '))
console.log('A (y-scale) over time:', samples.map(s=>s.A).join(' '))
// max single-step jump in A (smaller = smoother)
let maxAjump=0; for(let i=1;i<samples.length;i++){const d=Math.abs(samples[i].A-samples[i-1].A); if(d>maxAjump)maxAjump=d}
console.log('max single-step A jump:', maxAjump.toFixed(1))
console.log('errors:', errs.slice(0,3), pe.slice(0,3))
await b.close()
