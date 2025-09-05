/* KPR Superposition Prototype — HEAD + SLIDER + KEYBOARD + MOUSE
   - Telefon: deviceorientation (gamma) vezérli a bal/jobb gaineket
   - MacBook: automatikus fallback → csúszka, + nyilak + egérhúzás
   - Equal-power crossfade, smoothing, deadzone
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

// --- Audio fájlok (írj át mp3-ra, ha úgy exportálsz) ---
const FILES = {
  left:  'left.wav',
  center:'center.wav',
  right: 'right.wav'
};

// ===== Segédek =====
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

const RANGE = 45;          // max döntés (±45°)
const DEADZONE = 3;        // középen ennyi fokig halott zóna
const SMOOTH_ALPHA = 0.15; // smoothing (0..1)

function mapAngle(rawDeg){
  let a = rawDeg;
  if (Math.abs(a) < DEADZONE) a = 0;
  a = clamp(a, -RANGE, RANGE);
  return a;
}

function angleToGains(angleDeg){
  const a = mapAngle(angleDeg);
  const t = (a + RANGE) / (2*RANGE); // 0..1
  const left = Math.cos(t * Math.PI * 0.5);
  const right = Math.sin(t * Math.PI * 0.5);
  const center = 1.0;
  return {left, center, right};
}

function updateMeters(g){
  meters.left.style.width = (g.left*100).toFixed(1)+'%';
  meters.center.style.width = (g.center*100).toFixed(1)+'%';
  meters.right.style.width = (g.right*100).toFixed(1)+'%';
}

// ===== Szenzor kezelés =====
let sensorActive = false;
let orientationHandler = null;
let usingSlider = false;

let smoothedGamma = 0;
let calibratedOffset = 0;

function applyAngle(angle){
  if (!ctx) return;
  gammaVal.textContent = angle.toFixed(1);
  const g = angleToGains(angle);
  const t = ctx.currentTime;
  gains.left.gain.linearRampToValueAtTime(g.left,   t+0.05);
  gains.center.gain.linearRampToValueAtTime(g.center,t+0.05);
  gains.right.gain.linearRampToValueAtTime(g.right, t+0.05);
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
      const permFn = window.DeviceOrientationEvent?.requestPermission ?? window.DeviceMotionEvent?.requestPermission;
      const res = await permFn();
      return res === 'granted';
    }
    return true;
  }catch{ return false; }
}

// ===== Audio betöltés =====
async function loadBuffer(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('Hiba: '+url);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

async function startAudio(){
  if(running) return;
  running = true;
  statusText.textContent = 'betöltés...';
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  buffers.left   = await loadBuffer(FILES.left);
  buffers.center = await loadBuffer(FILES.center);
  buffers.right  = await loadBuffer(FILES.right);

  const master = ctx.createGain(); master.gain.value = 1.0; master.connect(ctx.destination);
  gains.left = ctx.createGain(); gains.left.connect(master);
  gains.center = ctx.createGain(); gains.center.connect(master);
  gains.right = ctx.createGain(); gains.right.connect(master);

  sources.left = ctx.createBufferSource(); sources.left.buffer = buffers.left; sources.left.loop = true; sources.left.connect(gains.left);
  sources.center = ctx.createBufferSource(); sources.center.buffer = buffers.center; sources.center.loop = true; sources.center.connect(gains.center);
  sources.right = ctx.createBufferSource(); sources.right.buffer = buffers.right; sources.right.loop = true; sources.right.connect(gains.right);

  const now = ctx.currentTime + 0.05;
  sources.left.start(now); sources.center.start(now); sources.right.start(now);

  smoothedGamma = 0;
  calibrateCenter(0);
  applyAngle(0);

  statusText.textContent = 'fut';
  startBtn.disabled = true; stopBtn.disabled = false;

  usingSlider = false;
  const granted = await requestMotionPermissionIfNeeded();

  let gotMeaningful = false;
  const probe = (e)=>{
    if (typeof e.gamma === 'number' && Math.abs(e.gamma) > 0.5) gotMeaningful = true;
  };
  window.addEventListener('deviceorientation', probe, {passive:true});

  if (granted) {
    enableOrientation();
  } else {
    sensorText.textContent = 'engedély megtagadva → csúszka mód';
    usingSlider = true;
  }

  setTimeout(()=>{
    window.removeEventListener('deviceorientation', probe);
    if (!gotMeaningful) {
      usingSlider = true;
      disableOrientation();
    }
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

// ===== Csúszka fallback =====
angleSlider.addEventListener('input', ()=>{
  if (!running) return;
  usingSlider = true;
  disableOrientation();
  const angle = parseFloat(angleSlider.value) || 0;
  applyAngle(angle);
});

// ===== Billentyű: bal/jobbra nyíl =====
window.addEventListener('keydown', (e)=>{
  if (!running) return;
  const step = 2;
  if (e.key === 'ArrowLeft') {
    angleSlider.value = Math.max(-45, parseFloat(angleSlider.value) - step);
    angleSlider.dispatchEvent(new Event('input'));
  }
  if (e.key === 'ArrowRight') {
    angleSlider.value = Math.min(45, parseFloat(angleSlider.value) + step);
    angleSlider.dispatchEvent(new Event('input'));
  }
});

// ===== Egér/trackpad húzás =====
let dragging = false, startX = 0, startAngle = 0;
document.body.addEventListener('mousedown', (e)=>{
  if (!running) return;
  dragging = true;
  startX = e.clientX;
  startAngle = parseFloat(angleSlider.value) || 0;
});
document.body.addEventListener('mousemove', (e)=>{
  if (!running || !dragging) return;
  const dx = e.clientX - startX;
  const sensitivity = 0.2; // px → fok
  let ang = startAngle + dx * sensitivity;
  ang = Math.max(-45, Math.min(45, ang));
  angleSlider.value = ang;
  angleSlider.dispatchEvent(new Event('input'));
});
window.addEventListener('mouseup', ()=> dragging = false);

// ===== Gombok =====
startBtn.addEventListener('click', startAudio);
stopBtn.addEventListener('click', stopAudio);
