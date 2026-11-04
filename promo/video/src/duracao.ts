// Duração de cada cena = duração da narração + um respiro. Sem o áudio ainda
// (antes de rodar `npm run narrar`), estima pelo tamanho do texto, pro preview
// já funcionar.
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import { staticFile, type CalculateMetadataFunction } from "remotion";
import { CENAS, vozDa } from "./cenas";

export const FPS = 30;
export const TRANSICAO = 8; // frames de fade entre cenas (cortes rápidos)
const RESPIRO = 0.15; // segundos depois da fala, antes da próxima cena (ritmo de Reels)
const CARACTERES_POR_SEGUNDO = 15; // ritmo de fala calmo em português

export type PropsVideo = { duracoes: number[]; comVoz: boolean[]; comMusica: boolean };

async function duracaoDoAudio(src: string): Promise<number | null> {
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(src) });
    const segundos = await input.computeDuration();
    input.dispose();
    return segundos;
  } catch {
    return null;
  }
}

export const calcularDuracao: CalculateMetadataFunction<PropsVideo> = async () => {
  const audios = await Promise.all(CENAS.map((cena) => duracaoDoAudio(staticFile(vozDa(cena)))));
  // Sem o arquivo da trilha, o vídeo sai só com a voz.
  const musica = await duracaoDoAudio(staticFile("musica/fundo.mp3"));
  const duracoes = CENAS.map((cena, i) => {
    const fala = audios[i] ?? cena.narracao.length / CARACTERES_POR_SEGUNDO;
    return Math.ceil((fala + RESPIRO) * FPS) + TRANSICAO;
  });
  const total = duracoes.reduce((soma, d) => soma + d, 0) - TRANSICAO * (CENAS.length - 1);
  return { durationInFrames: total, props: { duracoes, comVoz: audios.map((a) => a !== null), comMusica: musica !== null } };
};
