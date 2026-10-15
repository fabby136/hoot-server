const express = require('express'), multer = require('multer'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express(), DATA = process.env.DATA_DIR || path.join(__dirname, 'data'); fs.mkdirSync(DATA, { recursive: true });
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Headers', '*').set('Access-Control-Allow-Methods', 'GET,POST'); return res.sendStatus(204); } next(); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5e6 } });
const metaPath = id => path.join(DATA, id + '.json'), audioPath = id => path.join(DATA, id + '.audio');
const load = id => /^[a-f0-9]{16}$/.test(id) && fs.existsSync(metaPath(id)) ? JSON.parse(fs.readFileSync(metaPath(id))) : null;

app.post('/api/shares', upload.single('audio'), (req, res) => {
  const { from = 'A friend', label = '', unlockAt } = req.body; const t = Date.parse(unlockAt);
  if (!req.file || !req.file.size) return res.status(400).json({ error: 'audio required' });
  if (isNaN(t)) return res.status(400).json({ error: 'valid unlockAt (ISO) required' });
  const id = crypto.randomBytes(8).toString('hex');
  const meta = { id, from: String(from).slice(0, 40), label: String(label).slice(0, 80), unlockAt: new Date(t).toISOString(), mime: req.file.mimetype || 'audio/webm', createdAt: new Date().toISOString() };
  fs.writeFileSync(audioPath(id), req.file.buffer); fs.writeFileSync(metaPath(id), JSON.stringify(meta));
  res.status(201).json({ id, url: `/s/${id}` });
});
// Metadata: label is hidden until unlock (the message is the surprise)
app.get('/api/shares/:id', (req, res) => {
  const m = load(req.params.id); if (!m) return res.status(404).json({ error: 'not found' });
  const unlocked = Date.now() >= Date.parse(m.unlockAt);
  res.json({ id: m.id, from: m.from, unlockAt: m.unlockAt, serverNow: new Date().toISOString(), unlocked, label: unlocked ? m.label : null });
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
