# vendor/piper

طرف ثالث: حزمة `@mintplex-labs/piper-tts-web@1.0.5` (رخصة MIT، المصدر:
https://github.com/Mintplex-Labs/piper-tts-web) — نسخة مشتقة من
[@diffusion-studio/vits-web](https://github.com/diffusion-studio/vits-web) لتشغيل Piper TTS داخل المتصفح.

- `piper-tts-web.js` / `piper-o91UDS6e.js` / `voices_static-D_OtJDHM.js` — ملفات ESM من الحزمة كما هي دون تعديل.
- `ort.wasm.min.js` — `onnxruntime-web@1.18.0` نسخة ESM (import map في index.html). لا تُخزَّن نماذج Piper هنا؛
  تُنزَّل عند الطلب من Hugging Face وتُخزَّن في OPFS داخل المتصفح.
- مكتبة eSpeak NG المدمجة في `vendor/espeak-ng/` (رخصة GPL-3.0 — انظر LICENSE هناك) — الصوت الاحتياطي المدمج.

النماذج الصوتية العربية: `ar_JO-kareem-medium` من مستودع diffusionstudio/piper-voices على Hugging Face
(مرخّصة MIT ضمن مشروع Piper).
