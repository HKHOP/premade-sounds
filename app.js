/* =========================================================
   Premade Sounds — أصوات جاهزة
   محركات تحويل النص إلى كلام عربي:
   1) Piper  — طبيعية، داخل المتصفح، تُنزَّل مرة واحدة (OPFS)
   2) Google Translate TTS — سحابية مجانية بلا مفتاح (تشغيل فقط)
   3) VoiceRSS — سحابية بجودة أعلى، تتطلب مفتاحًا مجانيًا خاصًا بك
   4) eSpeak NG — مدمجة فورية (صوت آلي)
   مع تخزين مؤقت للملفات السحابية في IndexedDB.
   تُحفظ الأصوات (نص + إعدادات) في localStorage.
   ========================================================= */
'use strict';

/* ارفع هذا الرقم ومعه ?v= في index.html عند كل نشر — يمنع تحميل ملفات قديمة من الذاكرة المؤقتة */
const APP_VERSION = '1.2.0';

const STORAGE_KEY = 'premade-sounds:v1';
const VOICERSS_KEY_STORAGE = 'premade-sounds:voicerss-key';
const AUDIO_DB_NAME = 'premade-sounds-audio';
const AUDIO_DB_STORE = 'clips';

/* مفاتيح اختبارية اختيارية (غير مستخدمة في الإنتاج) */
const loadEspeakModule = () =>
  window.__espeakLoader ? window.__espeakLoader() : import(`./vendor/espeak-ng/espeak-ng.js?v=${APP_VERSION}`);
const loadPiperModule = () =>
  window.__piperLoader ? window.__piperLoader() : import(`./vendor/piper/piper-tts-web.js?v=${APP_VERSION}`);
const createAudio = (url) =>
  window.__audioFactory ? window.__audioFactory(url) : new Audio(url);
const fetchImpl = (...args) => (window.__fetchImpl || fetch)(...args);

/* الأصوات: Piper (طبيعي محلي) + Puter/Polly/ElevenLabs (عصبي سحابي مجاني) + Google (بدون مفتاح) + VoiceRSS (مفتاح مجاني) + eSpeak NG */
const VOICES = [
  { id: 'piper:ar_JO-kareem-medium', label: 'عربي — طبيعي (Piper، يُنزَّل مرة واحدة)', engine: 'piper', group: 'natural' },
  { id: 'polly:Hala',                label: 'عربي خليجي — Polly «Hala» (Puter)',        engine: 'puter', group: 'natural', puter: { provider: 'aws-polly', voice: 'Hala', engine: 'neural', language: 'ar-AE' } },
  { id: 'polly:Zayd',                label: 'عربي خليجي — Polly «Zayd» (Puter)',        engine: 'puter', group: 'natural', puter: { provider: 'aws-polly', voice: 'Zayd', engine: 'neural', language: 'ar-AE' } },
  { id: 'polly:Zeina',               label: 'فصحى — Polly «Zeina» (Puter)',             engine: 'puter', group: 'natural', puter: { provider: 'aws-polly', voice: 'Zeina', engine: 'standard', language: 'arb' } },
  { id: 'eleven:bella',              label: 'عربي وعالمي — ElevenLabs «Bella» (Puter)', engine: 'puter', group: 'natural', puter: { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice: '21m00Tcm4TlvDq8ikWAM' } },
  { id: 'google:ar',                 label: 'عربي — Google (سحابي، بدون تنزيل)',        engine: 'google', group: 'cloud' },
  { id: 'voicerss:oda',              label: 'عربي مصري — VoiceRSS «Oda» (مفتاح مجاني)',   engine: 'voicerss', group: 'cloud', hl: 'ar-eg', v: 'Oda' },
  { id: 'voicerss:salim',            label: 'عربي سعودي — VoiceRSS «Salim» (مفتاح مجاني)', engine: 'voicerss', group: 'cloud', hl: 'ar-sa', v: 'Salim' },
  { id: 'ar',                        label: 'عربي — الأساسي (eSpeak)',                   engine: 'espeak', group: 'espeak' },
  { id: 'ar+f3',                     label: 'عربي — أنثوي (eSpeak)',                      engine: 'espeak', group: 'espeak' },
  { id: 'ar+m2',                     label: 'عربي — ذكوري (eSpeak)',                      engine: 'espeak', group: 'espeak' },
  { id: 'ar+whisper',                label: 'عربي — هامس (eSpeak)',                       engine: 'espeak', group: 'espeak' },
];
const VOICE_GROUPS = [
  { id: 'natural', label: 'أصوات طبيعية عصبية — محلية وسحابية (Puter بدون مفتاح)' },
  { id: 'cloud',   label: 'سحابية مجانية — Google وVoiceRSS' },
  { id: 'espeak',  label: 'أصوات eSpeak NG — مدمجة وفورية' },
];
const DEFAULT_VOICE = 'piper:ar_JO-kareem-medium';

function findVoice(voiceId) {
  return VOICES.find(v => v.id === voiceId) || VOICES[0];
}

function voiceLabel(voiceId) {
  return findVoice(voiceId).label;
}

function safeVoice(voiceId) {
  return VOICES.some(v => v.id === voiceId) ? voiceId : DEFAULT_VOICE;
}

/* ---------- DOM ---------- */
const form = document.getElementById('generate-form');
const textInput = document.getElementById('text-input');
const charCount = document.getElementById('char-count');
const voiceSelect = document.getElementById('voice-select');
const rateRange = document.getElementById('rate-range');
const pitchRange = document.getElementById('pitch-range');
const rateValue = document.getElementById('rate-value');
const pitchValue = document.getElementById('pitch-value');
const pitchNote = document.getElementById('pitch-note');
const voiceHelp = document.getElementById('voice-help');
const voicerssBox = document.getElementById('voicerss-box');
const voicerssInput = document.getElementById('voicerss-key');
const voicerssSave = document.getElementById('voicerss-save');
const previewBtn = document.getElementById('preview-btn');
const generateBtn = document.getElementById('generate-btn');
const generateLabel = generateBtn.querySelector('.btn-label');

const soundsList = document.getElementById('sounds-list');
const soundsCount = document.getElementById('sounds-count');
const emptyState = document.getElementById('empty-state');
const noResults = document.getElementById('no-results');
const searchInput = document.getElementById('search-input');
const clearAllBtn = document.getElementById('clear-all-btn');
const toastContainer = document.getElementById('toast-container');

/* ---------- حالة ---------- */
let sounds = [];
let currentAudio = null;
let currentObjectUrl = null;
let playingId = null;
let lastDeleted = null;
let espeakFactory = null;
let espeakLoading = null;
/* Google: طابور تشغيل للأجزاء (الحد الأقصى لكل طلب ~200 حرف) */
let googleQueue = null; // { urls: string[], index: number }

/* ---------- التخزين المحلي ---------- */
function loadSounds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    sounds = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(sounds)) sounds = [];
  } catch (err) {
    console.warn('تعذّرت قراءة الأصوات المحفوظة:', err);
    sounds = [];
  }
}

function saveSounds() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sounds));
  } catch (err) {
    showToast('تعذّرت كتابة الذاكرة المحلية — ربما امتلأت مساحة التخزين.', 'danger');
    console.error(err);
  }
}

/* ---------- IndexedDB: تخزين مؤقت لمقاطع الصوت السحابية ---------- */
function openAudioDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB غير مدعومة'));
    const req = indexedDB.open(AUDIO_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(AUDIO_DB_STORE)) {
        req.result.createObjectStore(AUDIO_DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openAudioDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_DB_STORE, 'readonly');
      const req = tx.objectStore(AUDIO_DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

async function idbSet(key, blob) {
  try {
    const db = await openAudioDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_DB_STORE, 'readwrite');
      tx.objectStore(AUDIO_DB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('تعذّر التخزين المؤقت للصوت:', err);
  }
}

const audioCacheKey = (entry) => `${entry.voice}|${entry.rate}|${entry.pitch}|${entry.text}`;

/* =========================================================
   المحركات
   ========================================================= */

/* ---- eSpeak NG (مدمج) ---- */
async function getEspeak() {
  if (espeakFactory) return espeakFactory;
  if (espeakLoading) return espeakLoading;

  espeakLoading = (async () => {
    const mod = await loadEspeakModule();
    const factory = mod.default || mod.ESpeakNG || mod;
    if (typeof factory !== 'function') throw new Error('وحدة eSpeak NG غير مفهومة');
    espeakFactory = factory;
    return factory;
  })();

  try {
    return await espeakLoading;
  } finally {
    espeakLoading = null;
  }
}

function espeakArgs(text, rate, pitch, voice) {
  const speed = clamp(Math.round(175 * Number(rate || 1)), 80, 450);
  const pitchValueEf = clamp(Math.round(Number(pitch == null ? 1 : pitch) * 50), 0, 99);
  return ['-v', safeVoice(voice), '-a', '100', '-s', String(speed), '-p', String(pitchValueEf), '-w', 'output.wav', text];
}

async function synthesizeEspeak(text, rate, pitch, voice) {
  const factory = await getEspeak();
  const espeak = await factory({ arguments: espeakArgs(text, rate, pitch, voice) });
  const data = espeak.FS.readFile('output.wav');
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return new Blob([bytes], { type: 'audio/wav' });
}

/* ---- Piper (طبيعي، محلي) ---- */
async function synthesizePiper(text, voiceId, onProgress) {
  if (window.__piperPredict) return window.__piperPredict(text, voiceId, onProgress);
  const mod = await loadPiperModule();
  const predict = mod.predict || (mod.default && mod.default.predict);
  if (typeof predict !== 'function') throw new Error('مكتبة Piper غير مفهومة');
  return predict({ text, voiceId }, onProgress);
}

/* ---- Puter.js (سحابي عصبي، بدون مفتاح — حساب Puter عند تجاوز الحد المجاني) ---- */
let puterLoading = null;
function loadPuter() {
  if (window.__puterJs) return Promise.resolve(window.__puterJs); // للاختبار
  if (window.puter && window.puter.ai) return Promise.resolve(window.puter);
  if (puterLoading) return puterLoading;
  puterLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.puter.com/v2/';
    s.onload = () => (window.puter ? resolve(window.puter) : reject(new Error('تعذّر تحميل Puter.js')));
    s.onerror = () => { puterLoading = null; reject(new Error('تعذّر تحميل Puter.js')); };
    document.head.appendChild(s);
  });
  return puterLoading;
}

async function synthesizePuter(entry) {
  if (window.__puterPredict) return { blob: await window.__puterPredict(entry) }; // للاختبار
  const v = findVoice(entry.voice);
  const puter = await loadPuter();
  const audioEl = await puter.ai.txt2speech(entry.text, v.puter);
  const src = audioEl && audioEl.src;
  if (src) {
    try {
      const res = await fetchImpl(src);
      if (res.ok) return { blob: new Blob([await res.arrayBuffer()], { type: res.headers.get('content-type') || 'audio/mpeg' }) };
    } catch { /* المصدر غير قابل للقراءة — نشغّله كما هو */ }
    return { streamUrl: src };
  }
  throw new Error('Puter: لم يصل صوت');
}

/* ---- Google Translate TTS (بدون مفتاح — تشغيل تدفقي عبر <audio>) ---- */
const GOOGLE_TTS_MAX_CHUNK = 180; // حرفًا لكل طلب تقريبًا

function googleChunks(text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.length > GOOGLE_TTS_MAX_CHUNK && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

const googleTtsUrl = (chunk) =>
  'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-in-it&tl=ar&q=' + encodeURIComponent(chunk);

/* ---- VoiceRSS (مفتاح مجاني للمستخدم، يُخزَّن محليًا) ---- */
function getVoiceRssKey() {
  try { return localStorage.getItem(VOICERSS_KEY_STORAGE) || ''; } catch { return ''; }
}

function setVoiceRssKey(value) {
  try { localStorage.setItem(VOICERSS_KEY_STORAGE, value.trim()); } catch { /* تجاهل */ }
}

function voicerssRate(rate) {
  return clamp(Math.round((Number(rate) - 1) * 10), -10, 10);
}

async function synthesizeVoiceRss(entry) {
  const v = findVoice(entry.voice);
  const key = getVoiceRssKey();
  if (!key) {
    const err = new Error('NO_KEY');
    err.code = 'NO_KEY';
    throw err;
  }
  const url = 'https://api.voicerss.org/?' + new URLSearchParams({
    key,
    hl: v.hl,
    v: v.v,
    c: 'MP3',
    f: '16khz_16bit_mono',
    r: String(voicerssRate(entry.rate)),
    src: entry.text,
  });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('VoiceRSS HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 7));
  const looksLikeError = head[0] === 0x45 && head[1] === 0x52 /* "ER"ror */;
  if (looksLikeError) {
    const msg = new TextDecoder().decode(buf);
    throw new Error(msg || 'VoiceRSS error');
  }
  return new Blob([buf], { type: 'audio/mpeg' });
}

/* ---------- التنسيق الموحّد للتوليد ---------- */
async function synthesize(entry, onProgress) {
  const v = findVoice(entry.voice);

  // المقاطع المحلية (لا تُخزَّن مؤقتًا — التوليد فوري أو مخزّن في OPFS)
  if (v.engine === 'espeak') {
    return { blob: await synthesizeEspeak(entry.text, entry.rate, entry.pitch, v.id), engine: 'espeak' };
  }
  if (v.engine === 'piper') {
    const blob = await synthesizePiper(entry.text, v.id.replace(/^piper:/, ''), onProgress);
    return { blob, engine: 'piper' };
  }

  // السحابية: تحقق من الكاش أولًا
  const cacheKey = audioCacheKey(entry);
  const cached = await idbGet(cacheKey);
  if (cached) return { blob: cached, engine: v.engine, cached: true };

  if (v.engine === 'google') {
    return { urls: googleChunks(entry.text).map(googleTtsUrl), engine: 'google' };
  }
  if (v.engine === 'voicerss') {
    const blob = await synthesizeVoiceRss(entry);
    await idbSet(cacheKey, blob);
    return { blob, engine: 'voicerss' };
  }
  if (v.engine === 'puter') {
    const out = await synthesizePuter(entry);
    if (out.blob) {
      await idbSet(cacheKey, out.blob);
      return { blob: out.blob, engine: 'puter' };
    }
    return { urls: [out.streamUrl], engine: 'puter' };
  }
  throw new Error('engine غير مدعوم: ' + v.engine);
}

/* ---------- التشغيل ---------- */
function stopPlayback() {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.src = ''; } catch { /* تجاهل */ }
    currentAudio = null;
  }
  googleQueue = null;
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  playingId = null;
  syncPlayingUI();
}

function setPlaying(id) {
  playingId = id;
  syncPlayingUI();
}

function playBlob(blob, id, engine, rate) {
  currentObjectUrl = URL.createObjectURL(blob);
  const audio = createAudio(currentObjectUrl);
  currentAudio = audio;
  if (engine === 'piper' || engine === 'puter') audio.playbackRate = clamp(Number(rate) || 1, 0.5, 2);

  const finish = () => {
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    currentAudio = null;
    playingId = null;
    syncPlayingUI();
  };
  audio.addEventListener('ended', finish);
  audio.addEventListener('error', () => { finish(); showToast('تعذّرت قراءة الملف الصوتي.', 'danger'); });

  const played = audio.play();
  if (played && typeof played.catch === 'function') {
    played.catch(() => { finish(); showToast('تعذّر تشغيل الصوت في هذا المتصفح.', 'danger'); });
  }
}

function playUrlQueue(urls, id, failMessage) {
  googleQueue = { urls, index: 0 };
  const step = () => {
    if (!googleQueue) return;
    const url = googleQueue.urls[googleQueue.index];
    const audio = createAudio(url);
    currentAudio = audio;

    const advance = () => {
      if (!googleQueue) return;
      googleQueue.index += 1;
      if (googleQueue.index >= googleQueue.urls.length) {
        googleQueue = null;
        currentAudio = null;
        playingId = null;
        syncPlayingUI();
      } else {
        step();
      }
    };
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', () => {
      googleQueue = null;
      currentAudio = null;
      playingId = null;
      syncPlayingUI();
      showToast(failMessage || 'تعذّر تشغيل الصوت السحابي.', 'danger');
    });
    const played = audio.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => { googleQueue = null; playingId = null; syncPlayingUI(); showToast(failMessage || 'تعذّر تشغيل الصوت السحابي.', 'danger'); });
    }
  };
  step();
}

async function playEntry(entry) {
  if (playingId === entry.id) { stopPlayback(); return; }
  stopPlayback();
  setPlaying(entry.id);

  try {
    const result = await synthesize(entry, makeProgressReporter());
    if (result.urls) playUrlQueue(result.urls, entry.id);
    else playBlob(result.blob, entry.id, result.engine, entry.rate);
  } catch (err) {
    console.error('فشل توليد الصوت:', err);
    const code = err && err.code;
    if (code === 'NO_KEY') {
      playingId = null; syncPlayingUI();
      showToast('VoiceRSS يحتاج مفتاحًا مجانيًا — الصقه في حقل المفتاح بالأسفل.', 'danger');
      revealVoiceRssBox(true);
      return;
    }
    if (findVoice(entry.voice).engine === 'voicerss' || findVoice(entry.voice).engine === 'puter') {
      showToast('تعذّر الصوت السحابي — استُخدم Google المجاني بدلًا منه.', 'danger');
      playUrlQueue(googleChunks(entry.text).map(googleTtsUrl), entry.id, 'تعذّر تشغيل Google أيضًا.');
      return;
    }
    playingId = null; syncPlayingUI();
    speakWithSystemVoice(entry); // احتياطي أخير
  }
}

/* احتياطي: أصوات النظام عبر Web Speech API */
function speakWithSystemVoice(entry) {
  const synth = window.speechSynthesis;
  if (!synth) { showToast('تعذّر توليد الصوت حاليًا.', 'danger'); return; }

  const voices = synth.getVoices();
  const arabic = voices.find(v => v.lang.toLowerCase().startsWith('ar'));
  if (!arabic) {
    showToast('تعذّر توليد الصوت — جرّب محركًا آخر من القائمة.', 'danger');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(entry.text);
  utterance.voice = arabic;
  utterance.lang = arabic.lang;
  utterance.rate = clamp(Number(entry.rate) || 1, 0.5, 2);
  const pitchOffset = entry.voice === 'ar+f3' ? 0.35 : entry.voice === 'ar+m2' ? -0.3 : 0;
  utterance.pitch = clamp((Number(entry.pitch) || 1) + pitchOffset, 0, 2);
  utterance.onend = () => { playingId = null; syncPlayingUI(); };
  utterance.onerror = () => { playingId = null; syncPlayingUI(); };
  playingId = entry.id;
  syncPlayingUI();
  synth.speak(utterance);
}

/* ---------- أدوات مساعدة ---------- */
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `snd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function autoName(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > 42 ? clean.slice(0, 42).trimEnd() + '…' : clean;
}

function formatDate(ts) {
  try {
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function makeProgressReporter() {
  return (p) => {
    if (p && p.total > 0 && String(p.url || '').endsWith('.onnx')) {
      const pct = Math.min(99, Math.round((p.loaded / p.total) * 100));
      setBusy(true, `جارٍ تنزيل الصوت الطبيعي… ${pct}%`);
    }
  };
}

/* ---------- الإشعارات ---------- */
function showToast(message, type = 'ok', actionLabel, actionFn) {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'danger' ? ' toast-danger' : ''}`;
  toast.innerHTML = `<span>${escapeHTML(message)}</span>`;

  if (actionLabel && actionFn) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { actionFn(); dismiss(); });
    toast.appendChild(btn);
  }

  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 220);
  };

  toastContainer.appendChild(toast);
  setTimeout(dismiss, actionLabel ? 6000 : 3500);
}

/* ---------- عرض القائمة ---------- */
function filteredSounds() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return sounds;
  return sounds.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.text.toLowerCase().includes(q) ||
    voiceLabel(s.voice).toLowerCase().includes(q)
  );
}

function renderSounds() {
  const visible = filteredSounds();
  soundsList.innerHTML = visible.map(renderItem).join('');

  soundsCount.textContent = String(sounds.length);
  emptyState.hidden = sounds.length !== 0;
  noResults.hidden = !(sounds.length > 0 && visible.length === 0);
  soundsList.hidden = visible.length === 0;
  clearAllBtn.style.visibility = sounds.length ? 'visible' : 'hidden';

  syncPlayingUI();
}

function renderItem(sound) {
  return `
  <li class="sound-item" data-id="${escapeHTML(sound.id)}">
    <button class="play-btn" data-action="play" aria-label="تشغيل ${escapeHTML(sound.name)}" title="تشغيل / إيقاف">
      <svg class="icon-play" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><polygon points="8 5 20 12 8 19 8 5"/></svg>
      <svg class="icon-stop" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="display:none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
    </button>
    <div class="sound-body">
      <div class="sound-name-row">
        <input class="sound-name" data-action="rename" value="${escapeHTML(sound.name)}" aria-label="اسم الصوت" spellcheck="false" />
      </div>
      <p class="sound-text" title="${escapeHTML(sound.text)}">${escapeHTML(sound.text)}</p>
      <div class="sound-meta">
        <span>${escapeHTML(voiceLabel(sound.voice))}</span>
        <span>السرعة ${sound.rate}×</span>
        <span>${escapeHTML(formatDate(sound.createdAt))}</span>
      </div>
    </div>
    <div class="eq" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="sound-actions">
      <button class="icon-btn duplicate" data-action="duplicate" title="تكرار" aria-label="تكرار ${escapeHTML(sound.name)}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="icon-btn danger" data-action="delete" title="حذف" aria-label="حذف ${escapeHTML(sound.name)}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  </li>`;
}

function syncPlayingUI() {
  soundsList.querySelectorAll('.sound-item').forEach(item => {
    const isPlaying = item.dataset.id === playingId;
    item.classList.toggle('playing', isPlaying);
    const playIcon = item.querySelector('.icon-play');
    const stopIcon = item.querySelector('.icon-stop');
    if (playIcon && stopIcon) {
      playIcon.style.display = isPlaying ? 'none' : '';
      stopIcon.style.display = isPlaying ? '' : 'none';
    }
  });
}

/* ---------- إجراءات الأصوات ---------- */
function addSound(text, rate, pitch, voice) {
  const entry = {
    id: uid(),
    name: autoName(text),
    text: text.trim(),
    voice: safeVoice(voice),
    rate: clamp(Number(rate), 0.5, 2),
    pitch: clamp(Number(pitch), 0, 2),
    createdAt: Date.now(),
  };
  sounds.unshift(entry);
  saveSounds();
  renderSounds();
  return entry;
}

function renameSound(id, newName) {
  const sound = sounds.find(s => s.id === id);
  if (!sound) return;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === sound.name) { renderSounds(); return; }
  sound.name = trimmed;
  saveSounds();
  renderSounds();
  showToast('تم حفظ الاسم الجديد.');
}

function duplicateSound(id) {
  const index = sounds.findIndex(s => s.id === id);
  if (index === -1) return;
  const src = sounds[index];
  const copy = { ...src, id: uid(), name: `نسخة من ${src.name}`, createdAt: Date.now() };
  sounds.splice(index, 0, copy);
  saveSounds();
  renderSounds();
  showToast('تم تكرار الصوت.');
}

function deleteSound(id) {
  const index = sounds.findIndex(s => s.id === id);
  if (index === -1) return;
  if (playingId === id) stopPlayback();
  lastDeleted = { item: sounds[index], index };
  sounds.splice(index, 1);
  saveSounds();
  renderSounds();
  showToast(`حُذف «${lastDeleted.item.name}»`, 'danger', 'تراجع', undoDelete);
}

function undoDelete() {
  if (!lastDeleted) return;
  sounds.splice(Math.min(lastDeleted.index, sounds.length), 0, lastDeleted.item);
  lastDeleted = null;
  saveSounds();
  renderSounds();
  showToast('تمت استعادة الصوت.');
}

function clearAllSounds() {
  if (!sounds.length) return;
  const confirmed = window.confirm('سيتم حذف كل الأصوات المحفوظة نهائيًا. هل أنت متأكد؟');
  if (!confirmed) return;
  stopPlayback();
  sounds = [];
  saveSounds();
  renderSounds();
  showToast('تم مسح كل الأصوات.', 'danger');
}

/* ---------- اختيار الصوت وتوفر الإعدادات ---------- */
function populateVoiceSelect() {
  voiceSelect.innerHTML = '';
  for (const g of VOICE_GROUPS) {
    const group = document.createElement('optgroup');
    group.label = g.label;
    for (const v of VOICES.filter(v => v.group === g.id)) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label;
      group.appendChild(opt);
    }
    voiceSelect.appendChild(group);
  }
  voiceSelect.value = DEFAULT_VOICE;
  syncVoiceControls();
}

function revealVoiceRssBox(focus) {
  if (!voicerssBox) return;
  voicerssBox.hidden = false;
  const saved = getVoiceRssKey();
  if (saved) voicerssInput.value = saved;
  if (focus) voicerssInput.focus();
}

function syncVoiceControls() {
  const v = findVoice(voiceSelect.value);
  const isEspeak = v.engine === 'espeak';
  const isGoogle = v.engine === 'google';
  const isVoiceRss = v.engine === 'voicerss';

  pitchRange.disabled = !isEspeak;
  if (pitchNote) pitchNote.hidden = isEspeak;
  const pitchBlock = pitchRange.closest('.control-block');
  if (pitchBlock) pitchBlock.classList.toggle('is-disabled', !isEspeak);

  rateRange.disabled = isGoogle;
  const rateBlock = rateRange.closest('.control-block');
  if (rateBlock) rateBlock.classList.toggle('is-disabled', isGoogle);

  if (voicerssBox) voicerssBox.hidden = !isVoiceRss;
  if (isVoiceRss && voicerssInput && !voicerssInput.value) voicerssInput.value = getVoiceRssKey();
  if (voiceHelp) {
    voiceHelp.textContent =
      v.engine === 'piper' ? 'طبيعي محلي، يُخزَّن في جهازك بعد التنزيل الأول' :
      v.engine === 'puter' ? 'عصبية سحابية مجانية عبر Puter — دون مفتاح (حساب Puter عند تجاوز الحد المجاني)' :
      v.engine === 'google' ? 'سحابي مجاني — للتشغيل فقط (لا يُخزَّن)' :
      v.engine === 'voicerss' ? 'سحابي بجودة أعلى — يحتاج مفتاحًا مجانيًا 350 طلب/يوم' :
      'آلي لكن فوري ولا يحتاج الإنترنت';
  }
}

/* ---------- أحداث ---------- */
textInput.addEventListener('input', () => {
  charCount.textContent = String(textInput.value.length);
});

voiceSelect.addEventListener('change', syncVoiceControls);
rateRange.addEventListener('input', () => { rateValue.textContent = `${Number(rateRange.value).toFixed(1)}×`; });
pitchRange.addEventListener('input', () => { pitchValue.textContent = Number(pitchRange.value).toFixed(1); });
if (voicerssSave) {
  voicerssSave.addEventListener('click', () => {
    setVoiceRssKey(voicerssInput.value);
    showToast('حُفظ مفتاح VoiceRSS في متصفحك.');
  });
}

function setBusy(busy, label) {
  generateBtn.disabled = busy;
  previewBtn.disabled = busy;
  if (generateLabel) generateLabel.textContent = busy ? (label || 'جارٍ التوليد…') : 'توليد الصوت';
}

previewBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text) { showToast('اكتب نصًا أولًا للاستماع إليه.', 'danger'); textInput.focus(); return; }
  setBusy(true, 'جارٍ التوليد…');
  try {
    const entry = { text, voice: voiceSelect.value, rate: rateRange.value, pitch: pitchRange.value };
    const result = await synthesize(entry, makeProgressReporter());
    stopPlayback();
    if (result.urls) playUrlQueue(result.urls, '__preview__');
    else playBlob(result.blob, '__preview__', result.engine, entry.rate);
  } catch (err) {
    console.error(err);
    if (err && err.code === 'NO_KEY') {
      showToast('VoiceRSS يحتاج مفتاحًا مجانيًا — الصقه في حقل المفتاح.', 'danger');
      revealVoiceRssBox(true);
    } else if (findVoice(voiceSelect.value).engine === 'puter' || findVoice(voiceSelect.value).engine === 'voicerss') {
      showToast('تعذّر الصوت السحابي — استُخدم Google المجاني بدلًا منه.', 'danger');
      stopPlayback();
      playUrlQueue(googleChunks(text).map(googleTtsUrl), '__preview__', 'تعذّر تشغيل Google أيضًا.');
    } else {
      speakWithSystemVoice({ text, rate: rateRange.value, pitch: pitchRange.value, voice: 'ar', id: '__preview__' });
    }
  } finally {
    setBusy(false);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) { showToast('اكتب نصًا أولًا ثم اضغط توليد.', 'danger'); textInput.focus(); return; }

  const entry = addSound(text, rateRange.value, pitchRange.value, voiceSelect.value);

  setBusy(true, 'جارٍ التوليد…');
  try {
    await playEntry(entry);
    showToast(`أُضيف «${entry.name}» إلى قائمتك.`);
  } finally {
    setBusy(false);
  }
});

soundsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.dataset.action === 'rename') return;
  const item = btn.closest('.sound-item');
  const id = item && item.dataset.id;
  if (!id) return;

  switch (btn.dataset.action) {
    case 'play': {
      const sound = sounds.find(s => s.id === id);
      if (sound) playEntry(sound);
      break;
    }
    case 'duplicate': duplicateSound(id); break;
    case 'delete': deleteSound(id); break;
  }
});

// إعادة التسمية: الحفظ عند مغادرة الحقل أو الضغط على Enter
soundsList.addEventListener('change', (e) => {
  const input = e.target.closest('[data-action="rename"]');
  if (!input) return;
  const item = input.closest('.sound-item');
  renameSound(item.dataset.id, input.value);
});
soundsList.addEventListener('keydown', (e) => {
  const input = e.target.closest('[data-action="rename"]');
  if (!input) return;
  if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  else if (e.key === 'Escape') { renderSounds(); }
});

searchInput.addEventListener('input', renderSounds);
clearAllBtn.addEventListener('click', clearAllSounds);

window.addEventListener('beforeunload', stopPlayback);

/* ---------- إقلاع ---------- */
populateVoiceSelect();
loadSounds();
renderSounds();
