/* Minimal UI + Matrix background + ECG + Audio superposition
   - Start/Stop only, slider fallback
   - Matrix "code rain" background
   - ECG: left (alive) = green heartbeat, right (dead) = red flatline
   - Smooth gain changes
*/

const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const sensorText = document.getElementById('sensorText');
const gammaVal   = document.getElementById('gammaVal');
const angleSlider= document.getElementById('angleSlider');

const meters = {
  left:   document.getElementById('leftMeter'),
  center: document.getElementById('centerMeter'),
  right:  document.getElementById('rightMeter')
};

let ctx, gains = {}, sources = {}, buffers = {};
let running = false;

// ===== Audio loader (tries root/audio × wav/mp3) =====
const EXT_PREF = ['wav','mp3'];
const PATHS = ['', 'audio/'];

async function tryFetchDecode(url){
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}
async function loadOneBuffer(base){
  for (const p of PATHS){
    for (const ext of EXT_PREF){
      const url = `${p}${base}.${ext}`;
      try { return await tryFetchDecode(url); } catch(e){}
    }
  }
  throw new Error(`Missing ${base}.* at root or audio/`);
}

// ===== Mix behaviour =====
const RANGE = 45, DEADZONE = 3, CENTER_MIN = 0.35;
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function normAngle(d){ if(Math.abs(d)<DEADZONE) d=0; return clamp(d,-RANGE,RANGE); }
function angleToGains(deg){
  const a = normAngle(deg);
  const x = a / RANGE; // -1..1
  const Lraw = Math.max(0, -x);
  const Rraw = Math.max(0,  x);
  const left  = Math.sin(Lraw * Math.PI * 0.5);
  const right = Math.sin(Rraw * Math.PI * 0.5);
  const center= 1 - (1 - CENTER_MIN) * Math.abs(x);
  return {left, center, right};
}
function smoothGain(node, target, tau=0.05){
  const now = ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.setTargetAtTime(target, now, tau);
}
function updateMeters(g){
  meters.left.style.width = (g.left*100).toFixed(1)+'%';
  meters.center.style.width = (g.center*100).toFixed(1)+'%';
  meters.right.style.width = (g.right*100).toFixed(1)+'%';
}

// ===== Sensor / control =====
let sensorActive=false, usingSlider=false, orientationHandler=null;
let smoothedGamma=0, calibratedOffset=0, SMOOTH_ALPHA=0.15;

function applyAngle(angle){
  if(!ctx) return;
  gammaVal.textContent = angle.toFixed(1);
  const g = angleToGains(angle);
  smoothGain(gains.left, g.left);
  smoothGain(gains.center, g.center);
  smoothGain(gains.right, g.right);
  updateMeters(g);
  // drive ECG mood (alive on left, dead on right)
  modeAlive = (angle <= 0); // <=0 left or center -> alive
}

function enableOrientation(){
  if (sensorActive) return;
  orientationHandler = (e)=>{
    if (usingSlider) return;
    let g = (typeof e.gamma === 'number') ? e.gamma : 0;
    g -= calibratedOffset;
    smoothedGamma = smoothedGamma + SMOOTH_ALPHA*(g - smoothedGamma);
    applyAngle(smoothedGamma);
  };
  window.addEventListener('deviceorientation', orientationHandler, {passive:true});
  sensorActive = true;
  sensorText.textContent = 'sensor active';
}
function disableOrientation(){
  if (!sensorActive) return;
  window.removeEventListener('deviceorientation', orientationHandler);
  orientationHandler=null; sensorActive=false;
  sensorText.textContent = 'manual (slider)';
}

async function requestMotionPermissionIfNeeded(){
  try{
    const need = (window.DeviceMotionEvent && typeof window.DeviceMotionEvent.requestPermission==='function')
              || (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission==='function');
    if(need){
      const fn = window.DeviceOrientationEvent?.requestPermission ?? window.DeviceMotionEvent?.requestPermission;
      const res = await fn(); return res==='granted';
    }
    return true;
  }catch{ return false; }
}

// ===== Audio start/stop =====
async function startAudio(){
  if(running) return; running=true;
  statusText.textContent='loading…';
  ctx = new (window.AudioContext||window.webkitAudioContext)({latencyHint:'playback'});

  // load
  try{
    buffers.left   = await loadOneBuffer('left');
    buffers.center = await loadOneBuffer('center');
    buffers.right  = await loadOneBuffer('right');
  }catch(e){
    statusText.textContent='load error'; alert(e.message); running=false; return;
  }

  // graph: gains -> master -> comp -> out
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value=-12; comp.knee.value=20; comp.ratio.value=2.5; comp.attack.value=0.005; comp.release.value=0.2;
  gains.left=ctx.createGain(); gains.center=ctx.createGain(); gains.right=ctx.createGain();
  gains.left.connect(master); gains.center.connect(master); gains.right.connect(master);
  master.connect(comp); comp.connect(ctx.destination);

  sources.left=ctx.createBufferSource(); sources.left.buffer=buffers.left; sources.left.loop=true; sources.left.connect(gains.left);
  sources.center=ctx.createBufferSource(); sources.center.buffer=buffers.center; sources.center.loop=true; sources.center.connect(gains.center);
  sources.right=ctx.createBufferSource(); sources.right.buffer=buffers.right; sources.right.loop=true; sources.right.connect(gains.right);

  const t0 = ctx.currentTime+0.05;
  sources.left.start(t0); sources.center.start(t0); sources.right.start(t0);

  applyAngle(0);
  statusText.textContent='playing';
  startBtn.disabled=true; stopBtn.disabled=false;

  usingSlider=false;
  const granted = await requestMotionPermissionIfNeeded();
  let got=false;
  const probe=(e)=>{ if(typeof e.gamma==='number' && Math.abs(e.gamma)>0.5) got=true; };
  window.addEventListener('deviceorientation',probe,{passive:true});
  if (granted) enableOrientation(); else { usingSlider=true; sensorText.textContent='manual (slider)'; }
  setTimeout(()=>{ window.removeEventListener('deviceorientation',probe); if(!got){ usingSlider=true; disableOrientation(); } },2000);

  // start visuals
  startMatrix(); startECG();
}
function stopAudio(){
  if(!running) return; running=false;
  try{ sources.left.stop(); }catch(_){}
  try{ sources.center.stop(); }catch(_){}
  try{ sources.right.stop(); }catch(_){}
  disableOrientation();
  ctx && ctx.close();
  startBtn.disabled=false; stopBtn.disabled=true;
  statusText.textContent='stopped';
}

// Slider (throttled), arrows, mouse drag
let rafId=null;
angleSlider.addEventListener('input', ()=>{
  if(!running) return;
  usingSlider=true; disableOrientation();
  if(rafId) cancelAnimationFrame(rafId);
  rafId=requestAnimationFrame(()=>{ applyAngle(parseFloat(angleSlider.value)||0); rafId=null; });
});
window.addEventListener('keydown',(e)=>{
  if(!running) return;
  const step=2;
  if(e.key==='ArrowLeft'){ angleSlider.value=Math.max(-RANGE,parseFloat(angleSlider.value)-step); angleSlider.dispatchEvent(new Event('input')); }
  if(e.key==='ArrowRight'){ angleSlider.value=Math.min( RANGE,parseFloat(angleSlider.value)+step); angleSlider.dispatchEvent(new Event('input')); }
});
let dragging=false,startX=0,startAngle=0;
document.body.addEventListener('mousedown',e=>{ if(!running) return; dragging=true; startX=e.clientX; startAngle=parseFloat(angleSlider.value)||0; });
document.body.addEventListener('mousemove',e=>{
  if(!running||!dragging) return;
  const dx=e.clientX-startX, sens=0.2; let ang=startAngle+dx*sens; ang=Math.max(-RANGE,Math.min(RANGE,ang));
  angleSlider.value=ang; angleSlider.dispatchEvent(new Event('input'));
});
window.addEventListener('mouseup',()=> dragging=false);

// Buttons
startBtn.addEventListener('click', startAudio);
stopBtn .addEventListener('click', stopAudio);

// ===== Matrix "code rain" =====
const mCanvas=document.getElementById('matrix');
const mCtx=mCanvas.getContext('2d');
let mCols=0, mDrops=[], mW=0, mH=0;
function resizeMatrix(){
  mW= mCanvas.width = window.innerWidth;
  mH= mCanvas.height= window.innerHeight;
  const fontSize=16;
  mCols = Math.floor(mW / fontSize);
  mDrops = new Array(mCols).fill(0).map(()=> Math.random()*mH);
  mCtx.font = fontSize+'px monospace';
}
window.addEventListener('resize', resizeMatrix); resizeMatrix();

function drawMatrix(){
  // fade
  mCtx.fillStyle='rgba(5,6,7,0.08)';
  mCtx.fillRect(0,0,mW,mH);
  // glyphs
  for(let i=0;i<mCols;i++){
    const ch = String.fromCharCode(0x30A0 + Math.random()*96|0); // katakana-ish
    mCtx.fillStyle = 'rgba(0,255,128,0.75)'; // matrix green
    mCtx.fillText(ch, i*16, mDrops[i]);
    mDrops[i] = (mDrops[i] > mH || Math.random()>0.975) ? 0 : (mDrops[i]+16);
  }
}
let matrixAnim;
function startMatrix(){
  cancelAnimationFrame(matrixAnim);
  (function loop(){ drawMatrix(); matrixAnim=requestAnimationFrame(loop); })();
}

// ===== ECG visual =====
const ecgCanvas = document.getElementById('ecg');
const eCtx = ecgCanvas.getContext('2d');
let eW=0,eH=0, ecgX=0, modeAlive=true; // toggled by applyAngle()

function resizeECG(){
  eW = ecgCanvas.width = window.innerWidth;
  eH = ecgCanvas.height= Math.floor(window.innerHeight*0.28);
}
window.addEventListener('resize', resizeECG); resizeECG();

function drawECG(){
  // fade trail
  eCtx.fillStyle='rgba(0,0,0,0.35)';
  eCtx.fillRect(0,0,eW,eH);

  // grid
  eCtx.strokeStyle='rgba(113,167,255,0.12)';
  eCtx.lineWidth=1;
  eCtx.beginPath();
  for(let x=0;x<eW;x+=20){ eCtx.moveTo(x,0); eCtx.lineTo(x,eH); }
  for(let y=0;y<eH;y+=20){ eCtx.moveTo(0,y); eCtx.lineTo(eW,y); }
  eCtx.stroke();

  // baseline
  const mid = Math.floor(eH*0.6);
  eCtx.strokeStyle='rgba(200,220,255,0.15)';
  eCtx.beginPath(); eCtx.moveTo(0,mid); eCtx.lineTo(eW,mid); eCtx.stroke();

  // waveform
  const color = modeAlive ? 'rgba(0,255,136,0.95)' : 'rgba(255,59,59,0.95)';
  eCtx.strokeStyle=color; eCtx.lineWidth=2;

  eCtx.beginPath();
  let x=0;
  const speed = 4; // px/frame
  ecgX = (ecgX + speed) % eW;

  // draw across screen
  function sample(i){
    if(!modeAlive) return mid; // flatline
    // heartbeat shape: quick spike + damped sine
    const t = ((i+ecgX)%eW)/eW; // 0..1
    const phase = (t*4)%1;      // 4 beats/width
    let y=mid;
    if(phase<0.04){ // sharp QRS spike
      const k=phase/0.04; y = mid - (50*(1-Math.abs(2*k-1))); 
    } else {
      const tt = (phase-0.04)*10;
      y = mid - 18*Math.exp(-tt)*Math.sin(tt*6.0);
    }
    return Math.max(0,Math.min(eH,y));
  }

  eCtx.moveTo(0, sample(0));
  for(x=1;x<eW;x++){ eCtx.lineTo(x, sample(x)); }
  eCtx.stroke();
}
let ecgAnim;
function startECG(){
  cancelAnimationFrame(ecgAnim);
  (function loop(){ drawECG(); ecgAnim=requestAnimationFrame(loop); })();
}
