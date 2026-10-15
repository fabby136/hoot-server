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

// ---------- raven voice: pitch down + cathedral reverb (Web Audio, applied at playback) ----------
const RAVEN_RATE = 0.8;
function cathedralIR(ctx) { const sr = ctx.sampleRate, len = Math.floor(sr * 3.2), b = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < sr * 0.03 ? 0.25 : 1); } return b; }
function ravenChain(ctx, src) {
  const lp = ctx.createBiquadFilter(), dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver(), out = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 3400; conv.buffer = cathedralIR(ctx); dry.gain.value = 0.8; wet.gain.value = 0.55; out.gain.value = 1.3;
  src.connect(lp); lp.connect(dry); dry.connect(out); lp.connect(conv); conv.connect(wet); wet.connect(out); out.connect(ctx.destination); return out;
}
function ravenRate(el, on) { el.playbackRate = on ? RAVEN_RATE : 1; for (const k of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) if (k in el) el[k] = !on; }
const elSrc = new WeakMap();
function routeEl(ctx, el, on) { // a media element can only ever be bound to one source node → cache it
  let n = elSrc.get(el); if (!n) { n = ctx.createMediaElementSource(el); elSrc.set(el, n); } n.disconnect();
  if (on) ravenChain(ctx, n); else n.connect(ctx.destination); ravenRate(el, on);
}
let pCtx; $('#preview').addEventListener('play', () => { try { pCtx = pCtx || new AudioContext(); pCtx.resume(); routeEl(pCtx, $('#preview'), $('#filterOn').checked); } catch (e) { console.warn(e); } });
$('#filterOn').onchange = () => { if (pCtx) routeEl(pCtx, $('#preview'), $('#filterOn').checked); if ($('#filterOn').checked) toast('🐦‍⬛ Raven voice: deep & echoing'); };

// ---------- wake-up riddle ----------
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function askRiddle(r) {
  return new Promise(res => {
    let tries = 0; const box = $('#riddle'), card = box.querySelector('.riddle-card');
    $('#rq').textContent = r.q; $('#ra').value = ''; $('#rmsg').textContent = ''; $('#raHint').hidden = $('#raGive').hidden = true; box.hidden = false; setTimeout(() => $('#ra').focus(), 50);
    const done = v => { box.hidden = true; res(v); };
    $('#raGo').onclick = () => {
      if (norm($('#ra').value) && norm($('#ra').value) === norm(r.a)) { toast('✔ Rightly answered — the bells fall silent'); return done(true); }
      tries++; card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      $('#rmsg').textContent = tries >= 3 ? 'Thrice wrong… take a hint, or surrender.' : `Nay — ${3 - tries} more ${3 - tries === 1 ? 'try' : 'tries'} ere a hint is granted.`;
      if (tries >= 3) $('#raHint').hidden = $('#raGive').hidden = false;
    };
    $('#ra').onkeydown = e => { if (e.key === 'Enter') $('#raGo').click(); };
    $('#raHint').onclick = () => { const a = norm(r.a); $('#rmsg').textContent = `Hint: it begins with “${a[0].toUpperCase()}” and has ${a.length} letters.`; };
    $('#raGive').onclick = () => { toast(`The answer was “${r.a}”`); done(true); };
    $('#raLater').onclick = () => done(false);
  });
}
window.__riddle = askRiddle; // dev/test hook

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
    const sub = a.shareId ? `📜 from ${esc(a.from)} · ${new Date(a.unlockAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : (a.snoozeUntil > Date.now() ? '😴 snoozed' : 'every day');
    li.innerHTML = `<div class="meta"><div class="t">${t}<small>${ap}</small></div><div class="lbl">${esc(a.label || (a.shareId ? 'Sealed message' : 'Voice alarm'))}</div><div class="sub">${sub}</div></div>
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
  const m = await (await fetch(`/api/shares/${a.shareId}`)).json(); if (m.label) a.label = m.label; a.filter = !!m.filter; if (m.riddle) a.riddle = m.riddle; saveAlarms(alarms);
  return blob;
}

// ---------- recording ----------
let rec, chunks = [], stream, recBlob, raf;
function openRecord(m) {
  mode = m; recBlob = null; $('#preview').hidden = true; $('#saveBtn').disabled = true; $('#recStatus').textContent = 'Tap to record your message';
  $('#recTitle').textContent = m === 'friend' ? 'Surprise a friend' : 'New voice alarm';
  $('#fromWrap').hidden = m !== 'friend'; $('#riddleWrap').hidden = false; $('#riddleQ').value = $('#riddleA').value = ''; $('#filterOn').checked = false; $('#from').value = localStorage.getItem('name') || '';
  $('#time').value = m === 'friend' ? '23:00' : '07:00';
  $('#saveBtn').textContent = m === 'friend' ? 'Seal with wax & get link' : 'Save alarm'; go('record');
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
    const a = { id: uid(), time, label, enabled: true, lastFired: null, filter: $('#filterOn').checked, riddle: riddleIn() };
    await putAudio(a.id, recBlob); alarms.push(a); saveAlarms(alarms); $('#label').value = ''; toast('⏰ Alarm set for ' + fmt12(time).join(' ')); go('home');
  } else {
    const from = $('#from').value.trim() || 'A friend'; localStorage.setItem('name', from);
    const when = nextOccurrence(time), fd = new FormData();
    fd.append('audio', recBlob, 'msg.webm'); fd.append('from', from); fd.append('label', label); fd.append('unlockAt', when.toISOString());
    fd.append('filter', $('#filterOn').checked ? '1' : '0'); const rd = riddleIn(); if (rd) { fd.append('riddleQ', rd.q); fd.append('riddleA', rd.a); }
    const r = await fetch('/api/shares', { method: 'POST', body: fd }); if (!r.ok) return toast('Upload failed 😢');
    const { url } = await r.json(); $('#shareUrl').value = location.origin + url;
    $('#sharedWhen').textContent = fmt12(time).join(' '); $('#label').value = ''; go('shared');
  }
};
function riddleIn() { const q = $('#riddleQ').value.trim(), a = $('#riddleA').value.trim(); return q && a ? { q, a } : null; }
$('#copyBtn').onclick = async () => { try { await navigator.clipboard.writeText($('#shareUrl').value); toast('Link copied 📋'); } catch { $('#shareUrl').select(); } };
$('#nativeShare').onclick = () => navigator.share ? navigator.share({ title: 'A sealed Nevermore message for thee', url: $('#shareUrl').value }) : $('#copyBtn').click();

// ---------- recipient view ----------
let share, cdTimer;
async function openShare(id) {
  const r = await fetch('/api/shares/' + id); if (!r.ok) { toast('That surprise link is invalid'); return go('home'); }
  share = await r.json(); const skew = Date.parse(share.serverNow) - Date.now(), at = new Date(share.unlockAt);
  const hhmm = pad(at.getHours()) + ':' + pad(at.getMinutes());
  $('#fFrom').textContent = share.from; $('#rTo').textContent = share.from; $('#rName').value = localStorage.getItem('name') || ''; fSolved = false; $('#fTime').textContent = fmt12(hhmm).join(' ');
  $('#fDate').textContent = at.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  resetFriendAudio(id, at <= new Date(Date.now() + skew));
  const tick = () => { const ms = at - (Date.now() + skew); if (ms <= 0) { onUnlock(); $('#fCount').textContent = 'The seal is broken'; $('#lockIcon').classList.add('broken'); $('#fSealed').textContent = share.label ? `“${share.label}”` : 'Open it from your alarms!'; return clearInterval(cdTimer); }
    const s = Math.floor(ms / 1000); $('#fCount').textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
  clearInterval(cdTimer); tick(); cdTimer = setInterval(tick, 1000);
  const already = alarms.some(a => a.shareId === id); $('#addFriend').disabled = already; $('#addFriend').textContent = already ? '✓ In your alarms' : '⏰ Add to my alarms';
  $('#addFriend').onclick = () => { alarms.push({ id: uid(), shareId: id, from: share.from, filter: !!share.filter, riddle: share.riddle || null, unlockAt: share.unlockAt, time: hhmm, label: '', enabled: true, lastFired: null }); saveAlarms(alarms); toast('Added! It will ring at ' + fmt12(hhmm).join(' ')); history.replaceState(null, '', '/'); go('home'); };
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
  $('#armZone').hidden = unlockedAlready; $('#hearBtn').hidden = !unlockedAlready; $('#fSnooze').hidden = true; $('#replyZone').hidden = !unlockedAlready;
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
  if (fPlaying) return; fDone = true; clearTimeout(fSnoozeT);
  try { const r = await fetch('/api/shares/' + fShareId, { cache: 'no-store' }); if (r.ok) share = { ...share, ...(await r.json()) }; } catch {}
  let blob; try { blob = await fetchClip(); } catch (e) { $('#fErr').hidden = false; $('#fErr').textContent = '⚠️ ' + e.message; $('#hearBtn').hidden = false; return; }
  // iOS Safari plays m4a/mp4 (AAC) natively; webm (from old web recordings) may fail → try AudioContext decode.
  fAudio.src = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'audio/mp4' })); fAudio.loop = true;
  if (share.filter) { try { const AC = window.AudioContext || window.webkitAudioContext; fCtx = fCtx || new AC(); await fCtx.resume(); routeEl(fCtx, fAudio, true); } catch (e) { console.warn('raven filter', e); } }
  try { await fAudio.play(); if (fCtx && elSrc.get(fAudio) && fCtx.state !== 'running') throw new Error('ctx blocked'); }
  catch (e) {
    try { if (!fCtx) { const AC = window.AudioContext || window.webkitAudioContext; fCtx = new AC(); } await fCtx.resume();
      const buf = await fCtx.decodeAudioData(await blob.arrayBuffer()); fBufSrc = fCtx.createBufferSource(); fBufSrc.buffer = buf; fBufSrc.loop = true; if (share.filter) { fBufSrc.playbackRate.value = RAVEN_RATE; ravenChain(fCtx, fBufSrc); } else fBufSrc.connect(fCtx.destination); fBufSrc.start(0);
      if (fCtx.state !== 'running') throw new Error('audio blocked');
    } catch (e2) { $('#hearBtn').hidden = false; $('#armZone').hidden = true; $('#fErr').hidden = false; $('#fErr').textContent = 'Tap the button to play (your browser blocked autoplay).'; return; }
  }
  fPlaying = true; $('#hearBtn').hidden = true; $('#armZone').hidden = true; $('#fErr').hidden = true; $('#fStop').hidden = false; $('#fSnooze').hidden = false; $('#replyZone').hidden = false;
  if (navigator.vibrate) { navigator.vibrate([600, 300, 600]); fVibe = setInterval(() => navigator.vibrate([600, 300, 600]), 2000); }
}
function stopSurprise() {
  fAudio.pause(); fAudio.currentTime = 0; try { fBufSrc && fBufSrc.stop(); } catch {} fBufSrc = null; fPlaying = false;
  clearInterval(fVibe); navigator.vibrate && navigator.vibrate(0); if (wakeLock) wakeLock.release().catch(() => {}); armed = false;
  $('#fStop').hidden = true; $('#fSnooze').hidden = true; $('#hearBtn').hidden = false; $('#hearBtn').textContent = '▶ Play again';
}
function onUnlock() {
  if (fDone) return;
  $('#replyZone').hidden = false;
  if (armed) playSurprise(); else { fDone = true; $('#armZone').hidden = true; $('#hearBtn').hidden = false; }
}
$('#hearBtn').onclick = () => { fDone = false; playSurprise(); };
let fSolved = false, fSnoozeT;
$('#fStop').onclick = async () => { if (share && share.riddle && !fSolved) { if (!(await askRiddle(share.riddle))) return; fSolved = true; } stopSurprise(); };
$('#fSnooze').onclick = () => { const wasArmed = true; stopSurprise(); armed = wasArmed; getWake(); toast('😴 Snoozing — ringing again in 5 minutes'); $('#hearBtn').textContent = '▶ Play now'; fSnoozeT = setTimeout(() => { fDone = false; playSurprise(); }, 5 * 60e3); };

// ---------- reply by raven (recipient → sender) ----------
let rRec, rChunks = [], rBlob = null, rT;
$('#rRec').onclick = async () => {
  if (rRec && rRec.state === 'recording') return rRec.stop();
  if (fPlaying) return toast('Silence the bells first 🔔');
  let st; try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone permission needed 🎙️'); }
  rChunks = []; rRec = new MediaRecorder(st); rRec.ondataavailable = e => e.data.size && rChunks.push(e.data);
  rRec.onstop = () => { clearTimeout(rT); st.getTracks().forEach(t => t.stop()); rBlob = new Blob(rChunks, { type: rRec.mimeType || 'audio/webm' });
    $('#rPrev').src = URL.createObjectURL(rBlob); $('#rPrev').hidden = false; $('#rSend').hidden = false; $('#rRec').classList.remove('rec'); $('#rRec').textContent = '🎙️ Re-record'; $('#rStatus').textContent = 'Listen back, then send it by raven.'; };
  rRec.start(); $('#rRec').classList.add('rec'); $('#rRec').textContent = '■ Stop recording'; $('#rStatus').textContent = 'Recording… (up to 30 s)'; rT = setTimeout(() => rRec.state === 'recording' && rRec.stop(), 30e3);
};
$('#rSend').onclick = async () => {
  if (!rBlob) return; const n = $('#rName').value.trim(); if (n) localStorage.setItem('name', n);
  const fd = new FormData(); fd.append('audio', rBlob, 'reply.' + (rBlob.type.includes('mp4') ? 'm4a' : 'webm')); fd.append('from', n || 'Thy friend');
  $('#rSend').disabled = true; $('#rStatus').textContent = 'The raven takes wing…';
  const r = await fetch(`/api/shares/${fShareId}/replies`, { method: 'POST', body: fd }).catch(() => null); $('#rSend').disabled = false;
  if (!r || !r.ok) { $('#rStatus').textContent = `⚠️ The raven could not fly (${r ? r.status : 'network error'}). Try again.`; return; }
  rBlob = null; $('#rSend').hidden = true; $('#rStatus').textContent = `🪶 Thy reply flies to ${share.from}. They shall find it sealed in their inbox.`;
};

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
  $('#ringTime').textContent = fmt12(a.time).join(' '); $('#ringLabel').textContent = a.label || 'Rise, the bells are tolling!'; $('#ringFrom').textContent = a.from ? `a missive from ${a.from}` : '';
  $('#toast').classList.remove('show'); go('ringing');
  player = new Audio(blob ? URL.createObjectURL(blob) : undefined); player.loop = true; player.volume = 1;
  try { gainCtx = new AudioContext(); const g = gainCtx.createGain(); g.gain.value = 2.5; gainCtx.createMediaElementSource(player).connect(g); if (a.filter) { ravenChain(gainCtx, g); ravenRate(player, true); } else g.connect(gainCtx.destination); } catch {}
  if (blob) player.play().catch(() => toast('Tap anywhere to hear the alarm 🔊')); else beep();
  navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('⏰ ' + ($('#ringLabel').textContent));
}
function beep() { try { const c = new AudioContext(), o = c.createOscillator(); o.connect(c.destination); o.frequency.value = 880; o.start(); setTimeout(() => o.stop(), 1500); } catch {} }
function endRing() { if (player) player.pause(); if (gainCtx) gainCtx.close(); navigator.vibrate && navigator.vibrate(0); ringing = null; go('home'); }
document.getElementById('ringing').addEventListener('click', e => { if (player && player.paused && !e.target.closest('button')) player.play(); });
$('#stopBtn').onclick = async () => { if (ringing && ringing.riddle && !(await askRiddle(ringing.riddle))) return; if (ringing && ringing.shareId) ringing.enabled = false; saveAlarms(alarms); endRing(); };
$('#snoozeBtn').onclick = () => { ringing.snoozeUntil = Date.now() + 5 * 60e3; saveAlarms(alarms); toast('😴 Snoozing for 5 minutes'); endRing(); };
window.__ringNow = id => ring(alarms.find(a => a.id === id) || alarms[0]); // dev/test hook

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
document.addEventListener('click', () => 'Notification' in window && Notification.permission === 'default' && Notification.requestPermission(), { once: true });
const m = location.pathname.match(/^\/s\/([a-f0-9]{16})$/); if (m) openShare(m[1]); else go('home');
