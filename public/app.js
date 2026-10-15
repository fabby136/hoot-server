// ---------- storage: alarm metadata in localStorage, audio blobs in IndexedDB ----------
const DB = new Promise((ok, no) => { const r = indexedDB.open('hoot', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => ok(r.result); r.onerror = no; });
const idb = async (mode, fn) => { const db = await DB; return new Promise((ok, no) => { const tx = db.transaction('audio', mode); const q = fn(tx.objectStore('audio')); tx.oncomplete = () => ok(q && q.result); tx.onerror = no; }); };
const putAudio = (id, blob) => idb('readwrite', s => s.put(blob, id)), getAudio = id => idb('readonly', s => s.get(id)), delAudio = id => idb('readwrite', s => s.delete(id));
const loadAlarms = () => JSON.parse(localStorage.getItem('alarms') || '[]'), saveAlarms = a => localStorage.setItem('alarms', JSON.stringify(a));
let alarms = loadAlarms();
const $ = s => document.querySelector(s), uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const fmt12 = hhmm => { let [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return [`${h}:${pad(m)}`, ap]; };
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200); };

// ---------- navigation ----------
function go(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if (id === 'home') render(); }
let mode = 'self';
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (!b) return; if (b.dataset.go === 'record') openRecord(b.dataset.mode); else { stopRec(); go(b.dataset.go); } });

// ---------- home list ----------
function render() {
  const list = $('#list'); list.innerHTML = '';
  $('#empty').style.display = alarms.length ? 'none' : 'block';
  [...alarms].sort((a, b) => a.time.localeCompare(b.time)).forEach(a => {
    const [t, ap] = fmt12(a.time), li = document.createElement('li');
    li.className = 'alarm' + (a.enabled ? '' : ' off');
    const sub = a.shareId ? `🎁 from ${esc(a.from)} · ${new Date(a.unlockAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : (a.snoozeUntil > Date.now() ? '😴 snoozed' : 'every day');
    li.innerHTML = `<div class="meta"><div class="t">${t}<small>${ap}</small></div><div class="lbl">${esc(a.label || (a.shareId ? 'Surprise message 🔒' : 'Voice alarm'))}</div><div class="sub">${sub}</div></div>
      <button class="play" title="Preview">▶︎</button><button class="del" title="Delete">🗑</button>
      <label class="switch"><input type="checkbox" ${a.enabled ? 'checked' : ''}><span></span></label>`;
    li.querySelector('input').onchange = e => { a.enabled = e.target.checked; a.lastFired = null; saveAlarms(alarms); render(); };
    li.querySelector('.del').onclick = async () => { alarms = alarms.filter(x => x !== a); saveAlarms(alarms); await delAudio(a.id); render(); toast('Alarm deleted'); };
    li.querySelector('.play').onclick = async () => { const blob = await audioFor(a); if (blob) new Audio(URL.createObjectURL(blob)).play(); else toast('🔒 Sealed until ' + fmt12(a.time).join(' ')); };
    list.appendChild(li);
  });
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Friend alarms: audio is fetched from the server only once it unlocks.
async function audioFor(a) {
  let blob = await getAudio(a.id); if (blob) return blob;
  if (!a.shareId) return null;
  const r = await fetch(`/api/shares/${a.shareId}/audio`, { cache: 'no-store' }); if (!r.ok) return null;
  blob = await r.blob(); await putAudio(a.id, blob);
  const m = await (await fetch(`/api/shares/${a.shareId}`)).json(); if (m.label) { a.label = m.label; saveAlarms(alarms); }
  return blob;
}

// ---------- recording ----------
let rec, chunks = [], stream, recBlob, raf;
function openRecord(m) {
  mode = m; recBlob = null; $('#preview').hidden = true; $('#saveBtn').disabled = true; $('#recStatus').textContent = 'Tap to record your message';
  $('#recTitle').textContent = m === 'friend' ? 'Surprise a friend' : 'New voice alarm';
  $('#fromWrap').hidden = m !== 'friend'; $('#from').value = localStorage.getItem('name') || '';
  $('#time').value = m === 'friend' ? '23:00' : '07:00';
  $('#saveBtn').textContent = m === 'friend' ? '🎁 Create share link' : 'Save alarm'; go('record');
}
$('#recBtn').onclick = async () => {
  if (rec && rec.state === 'recording') return stopRec();
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return toast('Microphone permission needed 🎙️'); }
  chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => { recBlob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); const p = $('#preview'); p.src = URL.createObjectURL(recBlob); p.hidden = false; $('#saveBtn').disabled = false; $('#recStatus').textContent = 'Nice! Listen back or tap to re-record'; stream.getTracks().forEach(t => t.stop()); };
  rec.start(); $('#recBtn').classList.add('rec'); const t0 = Date.now();
  // live waveform
  const ac = new AudioContext(), an = ac.createAnalyser(); ac.createMediaStreamSource(stream).connect(an); an.fftSize = 256; const d = new Uint8Array(an.frequencyBinCount), cv = $('#wave'), cx = cv.getContext('2d');
  (function draw() { an.getByteTimeDomainData(d); cx.clearRect(0, 0, 300, 60); cx.fillStyle = '#ff7a50'; for (let i = 0; i < 50; i++) { const v = Math.abs(d[i * 2] - 128) / 128, h = 4 + v * 110; cx.fillRect(i * 6, 30 - h / 2, 4, h); }
    $('#recStatus').textContent = `Recording… ${((Date.now() - t0) / 1000).toFixed(1)}s (tap to stop)`; raf = requestAnimationFrame(draw); })();
  rec.addEventListener('stop', () => { cancelAnimationFrame(raf); ac.close(); });
};
function stopRec() { if (rec && rec.state === 'recording') rec.stop(); $('#recBtn').classList.remove('rec'); }

function nextOccurrence(hhmm) { const [h, m] = hhmm.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d; }
$('#saveBtn').onclick = async () => {
  if (!recBlob) return; const time = $('#time').value, label = $('#label').value.trim();
  if (mode === 'self') {
    const a = { id: uid(), time, label, enabled: true, lastFired: null };
    await putAudio(a.id, recBlob); alarms.push(a); saveAlarms(alarms); $('#label').value = ''; toast('⏰ Alarm set for ' + fmt12(time).join(' ')); go('home');
  } else {
    const from = $('#from').value.trim() || 'A friend'; localStorage.setItem('name', from);
    const when = nextOccurrence(time), fd = new FormData();
    fd.append('audio', recBlob, 'msg.webm'); fd.append('from', from); fd.append('label', label); fd.append('unlockAt', when.toISOString());
    const r = await fetch('/api/shares', { method: 'POST', body: fd }); if (!r.ok) return toast('Upload failed 😢');
    const { url } = await r.json(); $('#shareUrl').value = location.origin + url;
    $('#sharedWhen').textContent = fmt12(time).join(' '); $('#label').value = ''; go('shared');
  }
};
$('#copyBtn').onclick = async () => { try { await navigator.clipboard.writeText($('#shareUrl').value); toast('Link copied 📋'); } catch { $('#shareUrl').select(); } };
$('#nativeShare').onclick = () => navigator.share ? navigator.share({ title: 'A surprise alarm for you 🎁', url: $('#shareUrl').value }) : $('#copyBtn').click();

// ---------- recipient view ----------
let share, cdTimer;
async function openShare(id) {
  const r = await fetch('/api/shares/' + id); if (!r.ok) { toast('That surprise link is invalid'); return go('home'); }
  share = await r.json(); const skew = Date.parse(share.serverNow) - Date.now(), at = new Date(share.unlockAt);
  const hhmm = pad(at.getHours()) + ':' + pad(at.getMinutes());
  $('#fFrom').textContent = share.from; $('#fTime').textContent = fmt12(hhmm).join(' ');
  $('#fDate').textContent = at.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  resetFriendAudio(id, at <= new Date(Date.now() + skew));
  const tick = () => { const ms = at - (Date.now() + skew); if (ms <= 0) { onUnlock(); $('#fCount').textContent = '🔓 Unlocked!'; $('#lockIcon').textContent = '🔓'; $('#fSealed').textContent = share.label ? `“${share.label}”` : 'Open it from your alarms!'; return clearInterval(cdTimer); }
    const s = Math.floor(ms / 1000); $('#fCount').textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  clearInterval(cdTimer); tick(); cdTimer = setInterval(tick, 1000);
  const already = alarms.some(a => a.shareId === id); $('#addFriend').disabled = already; $('#addFriend').textContent = already ? '✓ In your alarms' : '⏰ Add to my alarms';
  $('#addFriend').onclick = () => { alarms.push({ id: uid(), shareId: id, from: share.from, unlockAt: share.unlockAt, time: hhmm, label: '', enabled: true, lastFired: null }); saveAlarms(alarms); toast('Added! It will ring at ' + fmt12(hhmm).join(' ')); history.replaceState(null, '', '/'); go('home'); };
  go('friend');
}

// ---------- recipient: arm audio for iOS autoplay, keep screen awake, autoplay at unlock ----------
// iOS Safari only lets a media element play without a tap if it was started once inside a tap.
// So "arm" primes our <audio> element (+ an AudioContext) with a silent clip during the user's tap.
const SILENT = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const fAudio = new Audio(); fAudio.setAttribute('playsinline', ''); fAudio.preload = 'auto';
let fCtx = null, fBufSrc = null, armed = false, wakeLock = null, fShareId = null, fDone = false, fPlaying = false, fVibe = null;
async function getWake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { console.warn('wake lock', e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (armed || fPlaying)) { getWake(); if (fCtx && fCtx.state !== 'running') fCtx.resume(); } });
function resetFriendAudio(id, unlockedAlready) {
  fShareId = id; fDone = false; $('#fErr').hidden = true; $('#fStop').hidden = true;
  $('#armZone').hidden = unlockedAlready; $('#hearBtn').hidden = !unlockedAlready;
}
$('#armBtn').onclick = async () => {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (AC) { fCtx = fCtx || new AC(); await fCtx.resume(); const b = fCtx.createBuffer(1, 1, 22050), n = fCtx.createBufferSource(); n.buffer = b; n.connect(fCtx.destination); n.start(0); }
    fAudio.src = SILENT; fAudio.muted = false; await fAudio.play().catch(() => {}); fAudio.pause(); fAudio.currentTime = 0;
    armed = true; await getWake();
    $('#armBtn').classList.add('armed'); $('#armBtn').textContent = '✅ Armed — it will play automatically';
    $('#armNote').textContent = wakeLock ? 'Keep this page open — your phone screen will stay on. 🔆' : 'Keep this page open and the screen on (your browser can’t keep it awake automatically).';
  } catch (e) { $('#fErr').hidden = false; $('#fErr').textContent = 'Could not arm audio: ' + e.message; }
};
async function fetchClip() {
  const r = await fetch(`/api/shares/${fShareId}/audio`, { cache: 'no-store' });
  if (r.status === 423) throw new Error('still locked'); if (!r.ok) throw new Error('clip unavailable (' + r.status + ')');
  return r.blob();
}
async function playSurprise() {
  if (fPlaying) return; fDone = true;
  let blob; try { blob = await fetchClip(); } catch (e) { $('#fErr').hidden = false; $('#fErr').textContent = '⚠️ ' + e.message; $('#hearBtn').hidden = false; return; }
  // iOS Safari plays m4a/mp4 (AAC) natively; webm (from old web recordings) may fail → try AudioContext decode.
  fAudio.src = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'audio/mp4' })); fAudio.loop = true;
  try { await fAudio.play(); }
  catch (e) {
    try { if (!fCtx) { const AC = window.AudioContext || window.webkitAudioContext; fCtx = new AC(); } await fCtx.resume();
      const buf = await fCtx.decodeAudioData(await blob.arrayBuffer()); fBufSrc = fCtx.createBufferSource(); fBufSrc.buffer = buf; fBufSrc.loop = true; fBufSrc.connect(fCtx.destination); fBufSrc.start(0);
      if (fCtx.state !== 'running') throw new Error('audio blocked');
    } catch (e2) { $('#hearBtn').hidden = false; $('#armZone').hidden = true; $('#fErr').hidden = false; $('#fErr').textContent = 'Tap the button to play (your browser blocked autoplay).'; return; }
  }
  fPlaying = true; $('#hearBtn').hidden = true; $('#armZone').hidden = true; $('#fErr').hidden = true; $('#fStop').hidden = false;
  if (navigator.vibrate) { navigator.vibrate([600, 300, 600]); fVibe = setInterval(() => navigator.vibrate([600, 300, 600]), 2000); }
}
function stopSurprise() {
  fAudio.pause(); fAudio.currentTime = 0; try { fBufSrc && fBufSrc.stop(); } catch {} fBufSrc = null; fPlaying = false;
  clearInterval(fVibe); navigator.vibrate && navigator.vibrate(0); if (wakeLock) wakeLock.release().catch(() => {}); armed = false;
  $('#fStop').hidden = true; $('#hearBtn').hidden = false; $('#hearBtn').textContent = '▶ Play again';
}
function onUnlock() {
  if (fDone) return;
  if (armed) playSurprise(); else { fDone = true; $('#armZone').hidden = true; $('#hearBtn').hidden = false; }
}
$('#hearBtn').onclick = () => { fDone = false; playSurprise(); };
$('#fStop').onclick = stopSurprise;

// ---------- ringing engine (runs while the app is open) ----------
let ringing = null, player, gainCtx;
function due(a, now) {
  if (!a.enabled || ringing) return false;
  if (a.snoozeUntil) return now >= a.snoozeUntil;
  if (a.shareId) return now >= Date.parse(a.unlockAt) && !a.lastFired;
  const key = now.toDateString() + a.time; return pad(now.getHours()) + ':' + pad(now.getMinutes()) === a.time && a.lastFired !== key;
}
setInterval(() => { const now = new Date(); $('#clock').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const h = now.getHours(); $('#hello').textContent = h < 12 ? 'Good morning ☀️' : h < 18 ? 'Good afternoon 🌤️' : 'Good evening 🌙';
  alarms.forEach(a => due(a, now) && ring(a)); }, 1000);
async function ring(a) {
  ringing = a; const now = new Date(); a.lastFired = a.shareId ? 'done' : now.toDateString() + a.time; a.snoozeUntil = null; saveAlarms(alarms);
  const blob = await audioFor(a);
  $('#ringTime').textContent = fmt12(a.time).join(' '); $('#ringLabel').textContent = a.label || 'Wake up! ⏰'; $('#ringFrom').textContent = a.from ? `🎁 a surprise from ${a.from}` : '';
  $('#toast').classList.remove('show'); go('ringing');
  player = new Audio(blob ? URL.createObjectURL(blob) : undefined); player.loop = true; player.volume = 1;
  try { gainCtx = new AudioContext(); const g = gainCtx.createGain(); g.gain.value = 2.5; gainCtx.createMediaElementSource(player).connect(g).connect(gainCtx.destination); } catch {}
  if (blob) player.play().catch(() => toast('Tap anywhere to hear the alarm 🔊')); else beep();
  navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('⏰ ' + ($('#ringLabel').textContent));
}
function beep() { try { const c = new AudioContext(), o = c.createOscillator(); o.connect(c.destination); o.frequency.value = 880; o.start(); setTimeout(() => o.stop(), 1500); } catch {} }
function endRing() { if (player) player.pause(); if (gainCtx) gainCtx.close(); navigator.vibrate && navigator.vibrate(0); ringing = null; go('home'); }
document.getElementById('ringing').addEventListener('click', e => { if (player && player.paused && !e.target.closest('button')) player.play(); });
$('#stopBtn').onclick = () => { if (ringing && ringing.shareId) ringing.enabled = false; saveAlarms(alarms); endRing(); };
$('#snoozeBtn').onclick = () => { ringing.snoozeUntil = Date.now() + 5 * 60e3; saveAlarms(alarms); toast('😴 Snoozing for 5 minutes'); endRing(); };
window.__ringNow = id => ring(alarms.find(a => a.id === id) || alarms[0]); // dev/test hook

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
document.addEventListener('click', () => 'Notification' in window && Notification.permission === 'default' && Notification.requestPermission(), { once: true });
const m = location.pathname.match(/^\/s\/([a-f0-9]{16})$/); if (m) openShare(m[1]); else go('home');
