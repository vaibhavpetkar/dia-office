// Dia's cloud voice: Azure neural text-to-speech, the same Neerja / Swara / Aarohi voices Edge has built in,
// so every browser gets a natural English, Hindi or Marathi voice. Only used when AZURE_SPEECH_KEY is set;
// otherwise the page uses the browser's own voices for free.
const VOICES = {
  en: { lang: "en-IN", name: process.env.AZURE_VOICE_EN || "en-IN-NeerjaNeural" },
  hi: { lang: "hi-IN", name: process.env.AZURE_VOICE_HI || "hi-IN-SwaraNeural" },
  mr: { lang: "mr-IN", name: process.env.AZURE_VOICE_MR || "mr-IN-AarohiNeural" }
};
const xml = s => s.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

export async function speech(text, lang = "en") {
  const key = process.env.AZURE_SPEECH_KEY, region = process.env.AZURE_SPEECH_REGION || "centralindia";
  if (!key) throw Object.assign(new Error("Cloud voice is not set up. Add AZURE_SPEECH_KEY to .env, or use the browser's voice."), { status: 400 });
  const v = VOICES[lang] || VOICES.en;
  // A touch slower and warmer than default, like someone talking to you across a desk.
  const ssml = `<speak version="1.0" xml:lang="${v.lang}"><voice name="${v.name}"><prosody rate="-4%" pitch="+3%">${xml(text)}</prosody></voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "dia-office" },
    body: ssml
  });
  if (!r.ok) throw Object.assign(new Error(`Azure voice failed (${r.status}). Check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.`), { status: 502 });
  return Buffer.from(await r.arrayBuffer());
}
