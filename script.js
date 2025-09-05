/* KPR Superposition Prototype — slider-first fix
   - Három sáv (left, center, right)
   - Web Audio API + DeviceOrientation
   - Ha megmozdítod a csúszkát → kézi (slider) módra vált és letiltja a szenzort
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

// --- ÁLLÍTSD BE MP3/WAV szerint ---
const FILES = {
  left:  'audio/left.wav',   // ha mp3-at használsz, írd át .mp3-ra
  center:'audio/center.wav',
  right: 'audio/right.wav'
};

// ===== Segédek =====
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function angleToGains(angleDeg){
  const a = clamp(angleDeg, -45, 45);
  const t = (a + 45) / 90; // 0..1
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
let usingSlider = false; // ha true, csak a csúszka irányít

function applyAngle(angle){
  gammaVal.textContent = angle.toFixed(1);
  const g = angleToGains(angle);
  const t = ctx.currentTime;
  gains.left.gain.linearRampToValueAtTime(g.left, t+0.05);
  gains.center.gain.linearRampToValueAtTime(g.center, t+0.05);
  gains.right.gain.linearRampToValueAtTime(g.right, t+0.05);
  updateMeters(g);
}

function enableOrientation(){
  if (sensorActive) return;
  orientationHandler = (e)=>{
    if (usingSlider) return;         // csúszka mód felülír mindent
    if (e && typeof e.gamma === 'number') {
      applyAngle(e.gamma);
    }
  };
  window.addEventListener('deviceorientation', orientationHandler, {passive:true});
  sensorActive = true;
  sensorText.textContent = 'szenzor aktív';
}
function disableOrientation(){
  if (!sensorActive) return;
  window.removeEventListener('deviceorientation', orientationHandler);
  orientationHandler = null;
  sensorActive = false;
  sensorText.textContent = 'kézi vezérlés (csúszka)';
}

// A csúszka MOSTANTÓL MINDIG él: első mozdítás → vált csúszka módra
angleSlider.addEventListener('input', ()=>{
  usingSlider = true;
  if (sensorActive) disableOrientation();
  const angle = parseFloat(angleSlider.value);
  if (ctx) applyAngle(angle);
});

// iOS permission (ha kell)
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

  // fájlok betöltése
  buffers.left = await loadBuffer(FILES.left);
  buffers.center = await loadBuffer(FILES.center);
  buffers.right = await loadBuffer(FILES.right);

  const master = ctx.createGain(); master.gain.value = 1.0; master.connect(ctx.destination);
  gains.left = ctx.createGain(); gains.left.connect(master);
  gains.center = ctx.createGain(); gains.center.connect(master);
  gains.right = ctx.createGain(); gains.right.connect(master);

  sources.left = ctx.createBufferSource(); sources.left.buffer = buffers.left; sources.left.loop = true; sources.left.connect(gains.left);
  sources.center = ctx.createBufferSource(); sources.center.buffer = buffers.center; sources.center.loop = true; sources.center.connect(gains.center);
  sources.right = ctx.createBufferSource(); sources.right.buffer = buffers.right; sources.right.loop = true; sources.right.connect(gains.right);

  const now = ctx.currentTime + 0.05;
  sources.left.start(now); sources.center.start(now); sources.right.start(now);

  // kezdeti állapot
  const g0 = angleToGains(parseFloat(angleSlider.value) || 0);
  gains.left.gain.setValueAtTime(g0.left, ctx.currentTime);
  gains.center.gain.setValueAtTime(g0.center, ctx.currentTime);
  gains.right.gain.setValueAtTime(g0.right, ctx.currentTime);
  updateMeters(g0);

  statusText.textContent = 'fut';
  startBtn.disabled = true; stopBtn.disabled = false;

  // szenzor próbálkozás — ha nem jön érdemi adat 2s alatt, marad a csúszka
  let gotMeaningful = false;
  const probeHandler = (e)=>{
    if (typeof e.gamma === 'number' && Math.abs(e.gamma) > 0.5) { // ténylegesen változik
      gotMeaningful = true;
    }
  };
  window.addEventListener('deviceorientation', probeHandler, {passive:true});
  const granted = await requestMotionPermissionIfNeeded();
  if (granted) enableOrientation();

  setTimeout(()=>{
    window.removeEventListener('deviceorientation', probeHandler);
    if (!gotMeaningful) { // nem jön érdemi adat → maradjon csúszka
      usingSlider = true;
      disableOrientation();
    }
    // ha jött adat, akkor sensorActive marad; ha megmozdítod a csúszkát, akkor bármikor átvált kézire
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

startBtn.addEventListener('click', startAudio);
stopBtn.addEventListener('click', stopAudio);
