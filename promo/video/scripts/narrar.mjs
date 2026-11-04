// Gera a narração de cada cena com a ElevenLabs (public/voz/cena-N.mp3).
// A chave fica em promo/video/.env (ELEVENLABS_API_KEY=...), fora do git.
// Cena que já tem áudio é pulada (não gasta crédito de novo); --refazer gera
// todas de novo, ou --refazer=cena-3 só aquela.
//
// Uso: npm run narrar [-- --refazer] [-- --refazer=cena-3]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CENAS, vozDa } from "../src/cenas.ts";

function lerEnv() {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((linha) => linha.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]])
  );
}

const env = { ...lerEnv(), ...process.env };
const chave = env.ELEVENLABS_API_KEY;
if (!chave) {
  console.error("Falta ELEVENLABS_API_KEY em promo/video/.env");
  process.exit(1);
}
// Sarah (voz calma; fala português bem com o modelo multilíngue).
const voz = env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
const refazer = process.argv.find((a) => a.startsWith("--refazer"));
const soEsta = refazer?.includes("=") ? refazer.split("=")[1] : null;

mkdirSync("public/voz", { recursive: true });
let caracteres = 0;
for (const cena of CENAS) {
  const arquivo = `public/${vozDa(cena)}`;
  const forcar = refazer && (!soEsta || soEsta === cena.id);
  if (existsSync(arquivo) && !forcar) {
    console.log(`pulando ${cena.id} (já tem áudio)`);
    continue;
  }
  const resposta = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": chave, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: cena.narracao,
      model_id: "eleven_multilingual_v2",
      language_code: "pt",
      // Estabilidade média: nem monótono nem exagerado.
      // speed 1.1: um pouco mais rápido, ritmo de vídeo curto.
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true, speed: 1.1 },
    }),
  });
  if (!resposta.ok) {
    console.error(`erro em ${cena.id}: ${resposta.status} ${await resposta.text()}`);
    process.exit(1);
  }
  writeFileSync(arquivo, Buffer.from(await resposta.arrayBuffer()));
  caracteres += cena.narracao.length;
  console.log(`ok ${cena.id}`);
}
console.log(`pronto. caracteres usados agora: ${caracteres}`);
