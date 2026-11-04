// Gera a trilha de fundo com a ElevenLabs Music (public/musica/fundo.mp3).
// Instrumental, ritmo de Reels, um pouco mais longa que o vídeo (o fim sai
// com fade). Precisa da permissão "Music Generation" na chave da API.
// Já existe o arquivo? Só gera de novo com --refazer.
//
// Uso: npm run musica [-- --refazer]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  (existsSync(".env") ? readFileSync(".env", "utf8") : "")
    .split(/\r?\n/)
    .map((linha) => linha.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const chave = process.env.ELEVENLABS_API_KEY ?? env.ELEVENLABS_API_KEY;
if (!chave) {
  console.error("Falta ELEVENLABS_API_KEY em promo/video/.env");
  process.exit(1);
}
const arquivo = "public/musica/fundo.mp3";
if (existsSync(arquivo) && !process.argv.includes("--refazer")) {
  console.log("já tem trilha (use --refazer pra gerar outra)");
  process.exit(0);
}

const resposta = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
  method: "POST",
  headers: { "xi-api-key": chave, "Content-Type": "application/json" },
  body: JSON.stringify({
    model_id: "music_v1",
    force_instrumental: true,
    music_length_ms: 30000,
    prompt:
      "Upbeat, catchy instrumental pop beat for a short social media ad for young people. Playful plucked synth melody, light claps, soft punchy kick, bright and modern, around 115 BPM, simple and repetitive hook, energetic but not busy, leaves room for a voiceover. No vocals.",
  }),
});
if (!resposta.ok) {
  console.error(`erro: ${resposta.status} ${await resposta.text()}`);
  process.exit(1);
}
mkdirSync("public/musica", { recursive: true });
writeFileSync(arquivo, Buffer.from(await resposta.arrayBuffer()));
console.log("pronto:", arquivo);
