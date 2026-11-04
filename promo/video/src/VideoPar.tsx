// O vídeo do PAR. (versão "rolê", em pé): gancho, logo, uma cena por parte do
// app e a chamada final. Uma cena por TransitionSeries.Sequence.
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment } from "react";
import { CenaApp } from "./CenaApp";
import { CenaGancho } from "./CenaGancho";
import { CenaMarca } from "./CenaMarca";
import { MusicaDeFundo } from "./MusicaDeFundo";
import { CENAS, vozDa } from "./cenas";
import { TRANSICAO, type PropsVideo } from "./duracao";

export const VideoPar = ({ duracoes, comVoz, comMusica }: PropsVideo) => {
  if (duracoes.length !== CENAS.length) return null;
  return (
    <>
    {comMusica && <MusicaDeFundo />}
    <TransitionSeries name="Vídeo do PAR.">
      {CENAS.map((cena, i) => {
        const voz = comVoz[i] ? vozDa(cena) : null;
        return (
          <Fragment key={cena.id}>
            {i > 0 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSICAO })} />}
            <TransitionSeries.Sequence name={cena.assunto ?? cena.tipo} durationInFrames={duracoes[i]}>
              {cena.tipo === "gancho" && <CenaGancho voz={voz} />}
              {cena.tipo === "logo" && <CenaMarca frase="Baixa o PAR." voz={voz} />}
              {cena.tipo === "app" && (
                <CenaApp assunto={cena.assunto!} titulo={cena.titulo!} telas={cena.telas!} destaque={cena.destaque} voz={voz} />
              )}
              {cena.tipo === "final" && (
                <CenaMarca chamada="Manda pro amigo que te deve 👀" frase="Dinheiro em grupo, sem climão." rodape="par-projeto.web.app" voz={voz} />
              )}
            </TransitionSeries.Sequence>
          </Fragment>
        );
      })}
    </TransitionSeries>
    </>
  );
};
