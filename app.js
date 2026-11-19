/* =========================================================
   Premade Sounds — أصوات جاهزة
   تحويل النص إلى كلام عربي عبر eSpeak NG (WASM) المدمج داخل
   الموقع — يعمل على أي جهاز دون الاعتماد على أصوات النظام.
   تُحفظ الأصوات (نص + إعدادات) في localStorage وتُولَّد
   الملفات الصوتية عند الطلب.
   ========================================================= */
'use strict';

/* ارفع هذا الرقم ومعه ?v= في index.html عند كل نشر — يمنع تحميل ملفات قديمة من الذاكرة المؤقتة */
const APP_VERSION = '1.1.0';

const STORAGE_KEY = 'premade-sounds:v1';

/* مفاتيح اختبارية اختيارية يسمح بها التطبيق (غير مستخدمة في الإنتاج) */
/* الأصوات: Piper (طبيعية، تُنزَّل مرة واحدة ثم تُخزَّن في OPFS) + eSpeak NG (مدمج فوري، اصطناعي) */
const VOICES = [
  { id: 'piper:ar_JO-kareem-medium', label: 'عربي — طبيعي (Piper)', engine: 'piper' },
  { id: 'ar',                        label: 'عربي — الأساسي (eSpeak)', engine: 'espeak' },
  { id: 'ar+f3',                     label: 'عربي — أنثوي (eSpeak)',   engine: 'espeak' },
  { id: 'ar+m2',                     label: 'عربي — ذكوري (eSpeak)',   engine: 'espeak' },
  { id: 'ar+whisper',                label: 'عربي — هامس (eSpeak)',    engine: 'espeak' },
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

function populateVoiceSelect() {
  voiceSelect.innerHTML = '';
  const groups = [
    { label: 'صوت طبيعي — Piper (يُنزَّل مرة واحدة)', engine: 'piper' },
    { label: 'أصوات eSpeak NG — مدمجة وفورية', engine: 'espeak' },
  ];
  for (const g of groups) {
    const group = document.createElement('optgroup');
    group.label = g.label;
    for (const v of VOICES.filter(v => v.engine === g.engine)) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.label;
      group.appendChild(opt);
    }
    voiceSelect.appendChild(group);
  }
  voiceSelect.value = DEFAULT_VOICE;
  syncPitchAvailability();
}

function syncPitchAvailability() {
  const piper = findVoice(voiceSelect.value).engine === 'piper';
  const note = document.getElementById('pitch-note');
  pitchRange.disabled = piper;
  if (note) note.hidden = !piper;
  const block = pitchRange.closest('.control-block');
  if (block) block.classList.toggle('is-disabled', piper);
}

const loadEspeakModule = () =>
  window.__espeakLoader ? window.__espeakLoader() : import(`./vendor/espeak-ng/espeak-ng.js?v=${APP_VERSION}`);
const loadPiperModule = () =>
  window.__piperLoader ? window.__piperLoader() : import(`./vendor/piper/piper-tts-web.js?v=${APP_VERSION}`);
const createAudio = (url) =>
  window.__audioFactory ? window.__audioFactory(url) : new Audio(url);

/* ---------- حالة التطبيق ---------- */
let sounds = [];
let currentAudio = null;
let currentObjectUrl = null;
let playingId = null;
let lastDeleted = null; // { item, index } للتراجع عن الحذف
let espeakFactory = null;
let espeakLoading = null;

/* ---------- عناصر DOM ---------- */
const form = document.getElementById('generate-form');
const textInput = document.getElementById('text-input');
const charCount = document.getElementById('char-count');
const voiceSelect = document.getElementById('voice-select');
const rateRange = document.getElementById('rate-range');
const pitchRange = document.getElementById('pitch-range');
const rateValue = document.getElementById('rate-value');
const pitchValue = document.getElementById('pitch-value');
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

/* ---------- توليد الصوت (eSpeak NG) ---------- */
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
  const speed = clamp(Math.round(175 * Number(rate || 1)), 80, 450);   // عدد الكلمات/الدقيقة
  const pitchValueEf = clamp(Math.round(Number(pitch == null ? 1 : pitch) * 50), 0, 99); // eSpeak: 0–99
  return ['-v', safeVoice(voice), '-a', '100', '-s', String(speed), '-p', String(pitchValueEf), '-w', 'output.wav', text];
}

async function synthesizeEspeak(text, rate, pitch, voice) {
  const factory = await getEspeak();
  const espeak = await factory({ arguments: espeakArgs(text, rate, pitch, voice) });
  const data = espeak.FS.readFile('output.wav');
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
  return new Blob([bytes], { type: 'audio/wav' });
}

/* توليد Piper طبيعي — يُنزِّل النموذج مرة واحدة (~63 م.بايت) ويخزّنه في OPFS */
async function synthesizePiper(text, voiceId, onProgress) {
  if (window.__piperPredict) return window.__piperPredict(text, voiceId, onProgress);
  const mod = await loadPiperModule();
  const predict = mod.predict || (mod.default && mod.default.predict);
  if (typeof predict !== 'function') throw new Error('مكتبة Piper غير مفهومة');
  return predict({ text, voiceId }, onProgress);
}

async function synthesize(text, rate, pitch, voice, onProgress) {
  const v = findVoice(safeVoice(voice));
  if (v.engine === 'piper') {
    const blob = await synthesizePiper(text, v.id.replace(/^piper:/, ''), onProgress);
    return { blob, engine: 'piper' };
  }
  const blob = await synthesizeEspeak(text, rate, pitch, v.id);
  return { blob, engine: 'espeak' };
}

/* ---------- التشغيل ---------- */
function stopPlayback() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  playingId = null;
  syncPlayingUI();
}

function makeProgressReporter() {
  return (p) => {
    if (p && p.total > 0 && String(p.url || '').endsWith('.onnx')) {
      const pct = Math.min(99, Math.round((p.loaded / p.total) * 100));
      setBusy(true, `جارٍ تنزيل الصوت الطبيعي… ${pct}%`);
    }
  };
}

async function playEntry(entry) {
  if (playingId === entry.id) { stopPlayback(); return; }
  stopPlayback();
  playingId = entry.id;
  syncPlayingUI();

  try {
    const { blob, engine } = await synthesize(entry.text, entry.rate, entry.pitch, entry.voice, makeProgressReporter());
    playBlob(blob, entry.id, engine, entry.rate);
  } catch (err) {
    console.error('فشل توليد الصوت عبر المحرك الأساسي:', err);
    if (findVoice(entry.voice).engine === 'piper') {
      showToast('تعذّر الصوت الطبيعي — استُخدم الصوت المدمج eSpeak بدلًا منه.', 'danger');
      try {
        const blob = await synthesizeEspeak(entry.text, entry.rate, entry.pitch, 'ar');
        playBlob(blob, entry.id, 'espeak', entry.rate);
        return;
      } catch (err2) {
        console.error('فشل eSpeak أيضًا:', err2);
      }
    }
    playingId = null;
    syncPlayingUI();
    speakWithSystemVoice(entry); // احتياطي أخير إن وُجدت أصوات النظام
  }
}

function playBlob(blob, id, engine, rate) {
  currentObjectUrl = URL.createObjectURL(blob);
  const audio = createAudio(currentObjectUrl);
  currentAudio = audio;
  // Piper لا يدعم تغيير طبقة الصوت؛ السرعة تُطبق عبر playbackRate مع الحفاظ على الطبقة
  if (engine === 'piper') audio.playbackRate = clamp(Number(rate) || 1, 0.5, 2);

  const finish = () => {
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    currentAudio = null;
    playingId = null;
    syncPlayingUI();
  };
  audio.addEventListener('ended', finish);
  audio.addEventListener('error', () => { finish(); showToast('تعذّرت قراءة الملف الصوتي المولَّد.', 'danger'); });

  const played = audio.play();
  if (played && typeof played.catch === 'function') {
    played.catch(() => { finish(); showToast('تعذّر تشغيل الصوت في هذا المتصفح.', 'danger'); });
  }
}

/* احتياطي: أصوات النظام عبر Web Speech API (قد لا يوجد صوت عربي على كل جهاز) */
function speakWithSystemVoice(entry) {
  const synth = window.speechSynthesis;
  if (!synth) { showToast('تعذّر توليد الصوت — يتطلب المتصفح دعم WASM.', 'danger'); return; }

  const voices = synth.getVoices();
  const arabic = voices.find(v => v.lang.toLowerCase().startsWith('ar'));
  if (!arabic) {
    showToast('تعذّر تحميل صوت eSpeak NG ولم تُثبّت أصوات عربية في نظامك.', 'danger');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(entry.text);
  // نحترم نمط الصوت المختار قدر الإمكان في الاحتياطي: إزاحة طبقة الصوت حسب النمط
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

/* ---------- أحداث ---------- */
textInput.addEventListener('input', () => {
  charCount.textContent = String(textInput.value.length);
});

voiceSelect.addEventListener('change', syncPitchAvailability);
rateRange.addEventListener('input', () => { rateValue.textContent = `${Number(rateRange.value).toFixed(1)}×`; });
pitchRange.addEventListener('input', () => { pitchValue.textContent = Number(pitchRange.value).toFixed(1); });

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
    const { blob, engine } = await synthesize(text, rateRange.value, pitchRange.value, voiceSelect.value, makeProgressReporter());
    stopPlayback();
    playBlob(blob, '__preview__', engine, rateRange.value);
  } catch (err) {
    console.error(err);
    if (findVoice(voiceSelect.value).engine === 'piper') {
      showToast('تعذّر الصوت الطبيعي — استُخدم eSpeak بدلًا منه.', 'danger');
      try {
        const blob = await synthesizeEspeak(text, rateRange.value, pitchRange.value, 'ar');
        stopPlayback();
        playBlob(blob, '__preview__', 'espeak', rateRange.value);
      } catch (err2) {
        console.error(err2);
        speakWithSystemVoice({ text, rate: rateRange.value, pitch: pitchRange.value, voice: 'ar', id: '__preview__' });
      }
    } else {
      speakWithSystemVoice({ text, rate: rateRange.value, pitch: pitchRange.value, voice: voiceSelect.value, id: '__preview__' });
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
