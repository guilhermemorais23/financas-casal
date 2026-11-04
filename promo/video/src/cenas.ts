// As cenas do vídeo (versão "rolê", em pé 9:16), na ordem do roteiro.md.
// Mudar a narração aqui e rodar `npm run narrar -- --refazer=cena-N` gera o
// áudio de novo só daquela cena.
export type Cena = {
  id: string;
  tipo: "gancho" | "logo" | "app" | "final";
  // Texto falado (ElevenLabs).
  narracao: string;
  // Na tela: assunto (etiqueta) e a frase grande.
  assunto?: string;
  titulo?: string;
  // Capturas do app (public/telas/). Duas = a tela "rola" de uma pra outra.
  telas?: string[];
  // Destaque que salta por cima do celular (o número que importa).
  destaque?: string;
};

export const CENAS: Cena[] = [
  { id: "cena-1", tipo: "gancho", narracao: "Você pagou o bar de novo, né? E o Pix da galera... nada." },
  { id: "cena-2", tipo: "logo", narracao: "Calma. Baixa o PAR." },
  {
    id: "cena-3",
    tipo: "app",
    narracao: "Pagou o rolê? Joga no app, marca quem foi, pronto.",
    assunto: "Lançar",
    titulo: "Pagou o rolê? Joga no app.",
    telas: ["telas/lancar.png", "telas/lancar-2.png"],
    destaque: "R$ 60 pra cada",
  },
  {
    id: "cena-4",
    tipo: "app",
    narracao: "Chega de ficar anotando no celular. No PAR, você tem tudo num lugar só.",
    assunto: "Quem deve quem",
    titulo: "Tudo num lugar só.",
    telas: ["telas/par.png"],
    destaque: "Lucas te deve R$ 60",
  },
  {
    id: "cena-5",
    tipo: "app",
    narracao: "Tá juntando pra viagem com a turma? Cada um guarda e todo mundo vê quanto falta.",
    assunto: "Metas",
    titulo: "Bora pra Floripa?",
    telas: ["telas/metas.png"],
    destaque: "Faltam R$ 3.200",
  },
  {
    id: "cena-6",
    tipo: "app",
    narracao: "Até a fatura do cartão mostra quem gastou o quê.",
    assunto: "Cartão",
    titulo: "Quem gastou o quê.",
    telas: ["telas/fatura.png", "telas/fatura-2.png"],
    destaque: "Ingresso: Bia",
  },
  {
    id: "cena-7",
    tipo: "app",
    narracao: "E se for a dois, o aluguel e o mercado também.",
    assunto: "A dois",
    titulo: "Aluguel e mercado também.",
    telas: ["telas/casal.png"],
  },
  { id: "cena-8", tipo: "final", narracao: "Manda isso pro amigo que tá te devendo. PAR. Dinheiro em grupo, sem climão." },
];

export const vozDa = (cena: Cena) => `voz/${cena.id}.mp3`;
