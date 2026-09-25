import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";

// Quem presta o serviço (nome e CPF/CNPJ) e o contato ficam em variáveis de
// ambiente, pra não publicar dado pessoal no código. O Código de Defesa do
// Consumidor e o Decreto do comércio eletrônico (7.962/2013) pedem que isso
// apareça pra quem vai pagar -- preencha VITE_LEGAL_NAME e VITE_LEGAL_DOCUMENT
// no .env de produção.
const LEGAL_NAME = import.meta.env.VITE_LEGAL_NAME as string | undefined;
const LEGAL_DOCUMENT = import.meta.env.VITE_LEGAL_DOCUMENT as string | undefined;
const CONTACT_EMAIL = import.meta.env.VITE_PRIVACY_CONTACT_EMAIL as string | undefined;

// Mesma versão do backend (billing.config.ts, TERMS_VERSION): quem assina
// aceita esta versão, e ela fica guardada junto da assinatura.
export const TERMS_VERSION = "2026-09-25";

// Público (sem login): tem que dar pra ler antes de criar conta ou assinar.
export function TermsPage() {
  return (
    <div className="legal-page">
      <Brand />
      <article className="card legal-card">
        <h1>Termos de uso</h1>
        <p className="card-subtitle">Atualizados em 25 de setembro de 2026</p>

        <p>
          Estes termos valem para quem usa o PAR., app para organizar as finanças de casais e grupos pequenos
          {LEGAL_NAME ? (
            <>
              , oferecido por <strong>{LEGAL_NAME}</strong>
              {LEGAL_DOCUMENT ? <> (CPF/CNPJ {LEGAL_DOCUMENT})</> : null}
            </>
          ) : null}
          . Ao criar uma conta ou assinar o Premium, você concorda com eles e com a{" "}
          <Link to="/privacidade">política de privacidade</Link>.
        </p>

        <h2>1. O serviço</h2>
        <p>
          O PAR. ajuda a registrar gastos, receitas, contas, cartões, dívidas e metas, e a dividir despesas entre as
          pessoas de um grupo. Os números mostrados vêm do que vocês lançam no app. O PAR. <strong>não é banco,
          não movimenta dinheiro</strong> e não oferece consultoria financeira, de investimento ou de crédito: as
          análises e o assistente são sugestões, e as decisões são de vocês.
        </p>

        <h2>2. Conta e grupo</h2>
        <ul>
          <li>Você precisa ter 18 anos ou mais e informar dados verdadeiros.</li>
          <li>Você cuida da sua senha e do acesso ao seu email e ao seu celular.</li>
          <li>
            O que é lançado na conta conjunta e nas metas do grupo é visto por todas as pessoas do grupo. A conta
            pessoal de cada um só é vista pelo dono.
          </li>
        </ul>

        <h2>3. Planos e preços</h2>
        <p>
          O <strong>plano Grátis</strong> continua grátis e sem prazo. O <strong>Premium</strong> é cobrado por grupo
          (uma assinatura vale para todas as pessoas do grupo), por mês ou por ano, e libera o assistente com
          inteligência artificial, a importação de extrato do banco, a exportação dos lançamentos e o link de
          compartilhamento de relatório. Os preços aparecem na tela <strong>Plano</strong> antes de você assinar,
          já com tudo incluído.
        </p>
        <p>
          Grupos novos podem ter um período de teste gratuito do Premium, informado na tela Plano. Ao fim do teste,
          sem assinatura, o grupo volta para o plano Grátis sem perder nenhum dado.
        </p>

        <h2>4. Pagamento e renovação</h2>
        <ul>
          <li>
            O pagamento é processado pelo <strong>Asaas</strong> (Pix, boleto ou cartão), na página de pagamento dele.
            O PAR. não recebe nem guarda número de cartão.
          </li>
          <li>
            A assinatura <strong>renova automaticamente</strong> no fim de cada período (mês ou ano), pelo mesmo
            valor, até você cancelar.
          </li>
          <li>
            Se o pagamento atrasar, o Premium continua por até 3 dias. Depois disso o grupo volta para o plano Grátis
            até o pagamento ser feito.
          </li>
          <li>
            Mudança de preço vale só para os próximos períodos e é avisada com pelo menos 30 dias de antecedência,
            pelo app ou por email. Se não concordar, é só cancelar antes da renovação.
          </li>
        </ul>

        <h2>5. Cancelamento e reembolso</h2>
        <ul>
          <li>
            Você cancela quando quiser, em <strong>Conta → Plano → Cancelar assinatura</strong>, sem multa e sem
            precisar falar com ninguém. O Premium continua até o fim do período já pago e não há nova cobrança.
          </li>
          <li>
            <strong>Direito de arrependimento:</strong> em até <strong>7 dias</strong> depois de um pagamento, você
            pode cancelar e receber <strong>o valor integral de volta</strong> (Código de Defesa do Consumidor, art.
            49), pela mesma tela. O estorno segue o prazo do meio de pagamento usado.
          </li>
          <li>Fora desse prazo, o período já pago não é devolvido, mas continua valendo até o fim.</li>
        </ul>

        <h2>6. Uso aceitável</h2>
        <p>
          Não é permitido usar o PAR. para atividades ilegais, tentar acessar dados de outros grupos, sobrecarregar ou
          atacar o serviço, nem revender o acesso. Nesses casos a conta pode ser suspensa.
        </p>

        <h2>7. Disponibilidade</h2>
        <p>
          A gente se esforça para o app funcionar sempre, mas podem acontecer interrupções para manutenção ou por
          falhas de serviços de terceiros. Seus dados ficam guardados mesmo quando o app está fora do ar. Você pode
          exportar seus lançamentos a qualquer momento.
        </p>

        <h2>8. Responsabilidade</h2>
        <p>
          O PAR. responde pelos serviços que presta, nos termos da lei. Não responde por decisões financeiras
          tomadas com base nos números do app, por dados lançados errado ou por perdas causadas por acesso de
          terceiros à sua conta por falta de cuidado com a senha.
        </p>

        <h2>9. Seus dados</h2>
        <p>
          O tratamento dos seus dados segue a Lei Geral de Proteção de Dados (LGPD) e está explicado na{" "}
          <Link to="/privacidade">política de privacidade</Link>. Você pode excluir sua conta a qualquer momento em
          Conta → Excluir conta.
        </p>

        <h2>10. Mudanças nestes termos</h2>
        <p>
          Se os termos mudarem, a data no topo é atualizada e mudanças importantes são avisadas no app. Para quem
          assina, uma mudança que afete o que foi contratado só vale depois de avisada, e você pode cancelar se não
          concordar.
        </p>

        <h2>11. Lei e foro</h2>
        <p>
          Valem as leis do Brasil. Conflitos podem ser levados ao foro do seu domicílio, como garante o Código de
          Defesa do Consumidor.
        </p>

        <h2>Contato</h2>
        <p>
          {CONTACT_EMAIL ? (
            <>
              Dúvidas, cancelamento ou reembolso: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, ou em
              Mais → Fale com a gente, no app.
            </>
          ) : (
            <>Dúvidas, cancelamento ou reembolso: Mais → Fale com a gente, dentro do app.</>
          )}
        </p>

        <p className="legal-back">
          <Link to="/" className="link">Voltar para o PAR.</Link>
        </p>
      </article>
    </div>
  );
}
