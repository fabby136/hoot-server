const express = require('express'), multer = require('multer'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express(), DATA = process.env.DATA_DIR || path.join(__dirname, 'data'); fs.mkdirSync(DATA, { recursive: true });
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Headers', 'Content-Type').set('Access-Control-Allow-Methods', 'GET,POST'); return res.sendStatus(204); } next(); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5e6 } });
const metaPath = id => path.join(DATA, id + '.json'), audioPath = id => path.join(DATA, id + '.audio');
const save = m => fs.writeFileSync(metaPath(m.id), JSON.stringify(m));
const replyAudio = rid => path.join(DATA, 'r-' + rid + '.audio');
const load = id => /^[a-f0-9]{16}$/.test(id) && fs.existsSync(metaPath(id)) ? JSON.parse(fs.readFileSync(metaPath(id))) : null;

app.post('/api/shares', upload.single('audio'), (req, res) => {
  const { from = 'A friend', label = '', unlockAt, filter, riddleQ = '', riddleA = '' } = req.body; const t = Date.parse(unlockAt);
  if (!req.file || !req.file.size) return res.status(400).json({ error: 'audio required' });
  if (isNaN(t)) return res.status(400).json({ error: 'valid unlockAt (ISO) required' });
  const id = crypto.randomBytes(8).toString('hex');
  const ownerKey = crypto.randomBytes(12).toString('hex');
  const riddle = String(riddleQ).trim() && String(riddleA).trim() ? { q: String(riddleQ).trim().slice(0, 200), a: String(riddleA).trim().slice(0, 80) } : null;
  const meta = { id, from: String(from).slice(0, 40), label: String(label).slice(0, 80), unlockAt: new Date(t).toISOString(), mime: req.file.mimetype || 'audio/webm', createdAt: new Date().toISOString(),
    filter: filter === '1' || filter === 'true', riddle, ownerKey, replies: [] };
  fs.writeFileSync(audioPath(id), req.file.buffer); save(meta);
  res.status(201).json({ id, url: `/s/${id}`, ownerKey });
});
// Metadata: label is hidden until unlock (the message is the surprise)
app.get('/api/shares/:id', (req, res) => {
  const m = load(req.params.id); if (!m) return res.status(404).json({ error: 'not found' });
  const unlocked = Date.now() >= Date.parse(m.unlockAt);
  // Riddle (question + answer) is only revealed once unlocked; it's a wake-up game, not a secret.
  res.json({ id: m.id, from: m.from, unlockAt: m.unlockAt, serverNow: new Date().toISOString(), unlocked, label: unlocked ? m.label : null,
    filter: !!m.filter, hasRiddle: !!m.riddle, riddle: unlocked ? m.riddle || null : null, replyCount: (m.replies || []).length });
});
// Reply by raven: the recipient records a voice reply once the seal is broken.
app.post('/api/shares/:id/replies', upload.single('audio'), (req, res) => {
  const m = load(req.params.id); if (!m) return res.status(404).json({ error: 'not found' });
  if (Date.now() < Date.parse(m.unlockAt)) return res.status(423).json({ error: 'still sealed' });
  if (!req.file || !req.file.size) return res.status(400).json({ error: 'audio required' });
  m.replies = m.replies || []; if (m.replies.length >= 20) return res.status(429).json({ error: 'too many replies' });
  const rid = crypto.randomBytes(8).toString('hex');
  const r = { id: rid, from: String(req.body.from || 'Thy friend').slice(0, 40), mime: req.file.mimetype || 'audio/mp4', createdAt: new Date().toISOString() };
  fs.writeFileSync(replyAudio(rid), req.file.buffer); m.replies.push(r); save(m);
  res.status(201).json({ id: rid });
});
// Sender polls replies for its messages: body { items: [{ id, key }] } → { [shareId]: [{ id, from, createdAt }] }
app.post('/api/replies/check', express.json(), (req, res) => {
  const out = {};
  for (const it of (req.body && req.body.items || []).slice(0, 100)) {
    const m = load(String(it.id)); if (!m || !m.ownerKey || m.ownerKey !== it.key) continue;
    out[m.id] = (m.replies || []).map(({ id, from, createdAt }) => ({ id, from, createdAt }));
  }
  res.json(out);
});
app.get('/api/shares/:id/replies/:rid/audio', (req, res) => {
  const m = load(req.params.id); const r = m && (m.replies || []).find(x => x.id === req.params.rid);
  if (!r || m.ownerKey !== req.query.key) return res.status(404).json({ error: 'not found' });
  res.set('Content-Type', r.mime).set('Cache-Control', 'no-store'); res.sendFile(replyAudio(r.id));
});
app.get('/api/shares/:id/audio', (req, res) => {
  const m = load(req.params.id); if (!m) return res.status(404).json({ error: 'not found' });
  const wait = Date.parse(m.unlockAt) - Date.now();
  if (wait > 0) { res.set('Retry-After', Math.ceil(wait / 1000)); return res.status(423).json({ error: 'locked', unlockAt: m.unlockAt }); }
  res.set('Content-Type', m.mime).set('Cache-Control', 'no-store'); res.sendFile(audioPath(m.id));
});
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/s/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const PORT = process.env.PORT || 5173; app.listen(PORT, '0.0.0.0', () => console.log('Voice alarm on http://localhost:' + PORT));
