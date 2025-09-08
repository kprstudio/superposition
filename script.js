/* KPR Superposition Prototype — ROBUST AUDIO LOADER + HEAD/SLIDER INPUT
   - Automatikusan próbál: left/center/right + (.wav/.mp3) + (gyökér/audio/)
   - Középállás: csak center; szélek felé a választott oldal nő, center halkul
   - Telefon: deviceorientation; MacBook: csúszka + nyilak + egérhúzás
*/

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const sensorText = document.getElementById('sensorText');
const gammaVal = document.getElementById('gammaVal');
const angleSlider = document.getElementById('angleSlider');

const meters = {
  left: document.getElementById('leftMeter'),
  center: document.getElementById('centerMeter'),
  right: document.getElementById('rightMeter'),
};

let ctx, gains = {}, sources = {}, buffers = {};
let running = false;

// ===== ROBUSZTUS BETÖLTŐ =====
const FILE_BASES = ['left','center','right'];
const EXT_PREF = ['wav','mp3'];
const PATHS = ['', 'audio/']; // gyökér és audio mappa

async function tryFetch(url){
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

async function loadOneBuffer(base){
  let lastErr = null;
  for (const p of PATHS){
    for (const ext of EXT_PREF){
      const url = `${p}${base}.${ext}`;
      try {
        return await tryFetch(url);
      } catch(e){
        lastErr = e;
      }
    }
  }
  throw lastErr ?? new Error(`Nem találom a(z) ${base}.* fájlt sem a gyökérben, sem az audio/ mappában`);
}

// ===== Segédek (viselkedés) =====
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
const RANGE = 45, DEADZONE = 3, SMOOTH_ALPHA = 0.15, CENTER_MIN = 0.35;

function normAngle(rawDeg){
  let a = rawDeg;
  if (Math.abs(a) < DEADZONE) a = 0;
  return clamp(a, -RANGE, RANGE);
}

function angleToGains(angleDeg){
  const a = normAngle(angleDeg);
  const x = a / RANGE; // -1..1
  const Lraw = Math.max(0, -x);
  const Rraw = Math.max(0,  x);
  const left  = Math.sin(Lraw * Math.PI * 0.5);
  const right = Math.sin(Rraw * Math.PI * 0.5);
  const center = 1 - (1 - CENTER_MIN) * Math.abs(x);
  return { left, center, right };
}

function updateMeters(g){
  meters.left.style.width   = (g.left*100).toFixed(1)+'%';
  meters.center.style.width = (g.center*100).toFixed(1)+'%';
  meters.right.style.width  = (g.right*100).toFixed(1)+'%';
}

// ===== Szenzor / vezérlés =====
let sensorActive = false, orientationHandler = null, usingSlider = false;
let smoothedGamma = 0, calibratedOffset = 0;

function applyAngle(angle){
  if (!ctx) return;
  gammaVal.textContent = angle.toFixed(1);
  const g = angleToGains(angle);
  const t = ctx.currentTime;
  gains.left.gain.linearRampToValueAtTime(  g.left,   t+0.05);
  gains.center.gain.linearRampToValueAtTime(g.center, t+0.05);
  gains.right.gain.linearRampToValueAtTime( g.right,  t+0.05);
  updateMeters(g);
}

function calibrateCenter(initialGamma){ calibratedOffset = initialGamma || 0; }

function enableOrientation(){
  if (sensorActive) return;
  const getAdjustedGamma = (e)=>{
    let g = (typeof e.gamma === 'number') ? e.gamma : 0;
    g = g - calibratedOffset;
    smoothedGamma = smoothedGamma + SMOOTH_ALPHA * (g - smoothedGamma);
    return smoothedGamma;
  };
  orientationHandler = (e)=>{
    if (usingSlider) return;
    const g = getAdjustedGamma(e);
    applyAngle(g);
  };
  window.addEventListener('deviceorientation', orientationHandler, {passive:true});
  sensorActive = true;
  sensorText.textContent = 'szenzor aktív (fej/telefon forgatás)';
}
function disableOrientation(){
  if (!sensorActive) return;
  window.removeEventListener('deviceorientation', orientationHandler);
  orientationHandler = null;
  sensorActive = false;
  sensorText.textContent = 'kézi vezérlés (csúszka)';
}

async function requestMotionPermissionIfNeeded(){
  try{
    const need = (window.DeviceMotionEvent && typeof window.DeviceMotionEvent.requestPermission === 'function')
              || (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function');
    if(need){
      const fn = window.DeviceOrientationEvent?.requestPermission ?? window.DeviceMotionEvent?.requestPermission;
      const res = await fn();
      return res === 'granted';
    }
    return true;
  }catch{ return false; }
}

// ===== Audio betöltés és indítás =====
async function startAudio(){
  if(running) return;
  running = true;
  statusText.textContent = 'betöltés...';
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  try{
    buffers.left   = await loadOneBuffer('left');
    buffers.center = await loadOneBuffer('center');
    buffers.right  = await loadOneBuffer('right');
  }catch(e){
    statusText.textContent = 'betöltési hiba';
    alert('Audio betöltési hiba: ' + e.message + '\n\nEllenőrizd, hogy a fájlnevek pontosan left/center/right és .wav vagy .mp3, és a gyökérben vagy az audio/ mappában vannak.');
    running = false;
    return;
  }

  const master = ctx.createGain(); master.gain.value = 1.0; master.connect(ctx.destination);
  gains.left = ctx.createGain(); gains.center = ctx.createGain(); gains.right = ctx.createGain();
  gains.left.connect(master); gains.center.connect(master); gains.right.connect(master);

  sources.left = ctx.createBufferSource();  sources.left.buffer  = buffers.left;   sources.left.loop  = true; sources.left.connect(gains.left);
  sources.center = ctx.createBufferSource();sources.center.buffer= buffers.center; sources.center.loop= true; sources.center.connect(gains.center);
  sources.right = ctx.createBufferSource(); sources.right.buffer = buffers.right;  sources.right.loop = true; sources.right.connect(gains.right);

  const now = ctx.currentTime + 0.05;
  sources.left.start(now); sources.center.start(now); sources.right.start(now);

  smoothedGamma = 0; calibrateCenter(0); applyAngle(0);

  statusText.textContent = 'fut';
  startBtn.disabled = true; stopBtn.disabled = false;

  usingSlider = false;
  const granted = await requestMotionPermissionIfNeeded();

  let gotMeaningful = false;
  const probe = (e)=>{ if (typeof e.gamma === 'number' && Math.abs(e.gamma) > 0.5) gotMeaningful = true; };
  window.addEventListener('deviceorientation', probe, {passive:true});

  if (granted) enableOrientation(); else { sensorText.textContent = 'engedély megtagadva → csúszka mód'; usingSlider = true; }

  setTimeout(()=>{
    window.removeEventListener('deviceorientation', probe);
    if (!gotMeaningful) { usingSlider = true; disableOrientation(); }
  }, 2000);
}

function stopAudio(){
  if(!running) return;
  running = false;
  try{ sources.left.stop(); }catch(_){}
  try{ sources.center.stop(); }catch(_){}
  try{ sources.right.stop(); }catch(_){}
  disableOrientation();
  ctx && ctx.close();
  startBtn.disabled = false; stopBtn.disabled = true;
  statusText.textContent = 'leállítva';
}

// ===== Csúszka, nyilak, egér =====
angleSlider.addEventListener('input', ()=>{
  if (!running) return;
  usingSlider = true; disableOrientation();
  const angle = parseFloat(angleSlider.value) || 0;
  applyAngle(angle);
});

window.addEventListener('keydown', (e)=>{
  if (!running) return;
  const step = 2;
  if (e.key === 'ArrowLeft') { angleSlider.value = Math.max(-RANGE, parseFloat(angleSlider.value) - step); angleSlider.dispatchEvent(new Event('input')); }
  if (e.key === 'ArrowRight'){ angleSlider.value = Math.min(RANGE,  parseFloat(angleSlider.value) + step); angleSlider.dispatchEvent(new Event('input')); }
});

let dragging = false, startX = 0, startAngle = 0;
document.body.addEventListener('mousedown', (e)=>{
  if (!running) return; dragging = true; startX = e.clientX; startAngle = parseFloat(angleSlider.value) || 0;
});
document.body.addEventListener('mousemove', (e)=>{
  if (!running || !dragging) return;
  const dx = e.clientX - startX, sensitivity = 0.2;
  let ang = startAngle + dx * sensitivity; ang = Math.max(-RANGE, Math.min(RANGE, ang));
  angleSlider.value = ang; angleSlider.dispatchEvent(new Event('input'));
});
window.addEventListener('mouseup', ()=> dragging = false);

// ===== Gombok =====
startBtn.addEventListener('click', startAudio);
stopBtn.addEventListener('click', stopAudio);
