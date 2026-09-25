import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";

// Contato do responsável pelos dados. Fica numa variável de ambiente (e não
// no código) pra não publicar um email pessoal sem querer; sem ela, a página
// orienta a usar as opções dentro do próprio app.
const CONTACT_EMAIL = import.meta.env.VITE_PRIVACY_CONTACT_EMAIL as string | undefined;

// Público (sem login): a App Store, o Google e a LGPD pedem que a política
// possa ser lida antes de criar a conta.
export function PrivacyPage() {
  return (
    <div className="legal-page">
      <Brand />
      <article className="card legal-card">
        <h1>Política de privacidade</h1>
        <p className="card-subtitle">Atualizada em 25 de setembro de 2026</p>

        <p>
          O PAR. é um app para organizar as finanças de casais e grupos pequenos. Esta página explica quais dados a
          gente guarda, para quê, com quem eles são compartilhados e como você apaga tudo.
        </p>

        <h2>O que a gente guarda</h2>
        <ul>
          <li>
            <strong>Conta:</strong> nome, email e, se você escolher, foto e telefone. Se entrar com Google ou Apple,
            recebemos só o nome e o email que você autorizar. Com a Apple, o email pode ser um endereço de
            retransmissão.
          </li>
          <li>
            <strong>O que você lança:</strong> entradas, gastos, cartões, faturas, dívidas, metas, orçamentos, contas
            fixas, lista de compras e categorias.
          </li>
          <li>
            <strong>Registros técnicos:</strong> data e hora de login e erros do app, para segurança e para corrigir
            problemas. Não guardamos senha (quem cuida do login é o Firebase), endereço IP nem localização.
          </li>
        </ul>

        <h2>Para que usamos</h2>
        <ul>
          <li>Mostrar seus números, relatórios, alertas e lembretes dentro do app.</li>
          <li>Enviar emails de boas-vindas e lembretes de vencimento.</li>
          <li>Manter a conta segura e o app funcionando.</li>
        </ul>
        <p>
          Não vendemos seus dados, não mostramos anúncios e não usamos seus dados para marketing de terceiros.
        </p>

        <h2>Quem vê seus dados</h2>
        <ul>
          <li>
            <strong>Seu grupo:</strong> o que é lançado na conta conjunta, nos cartões do grupo e nas metas aparece
            para as pessoas do seu grupo. O que é da sua conta pessoal e o que você marcar como privado fica só com
            você.
          </li>
          <li>
            <strong>Links de relatório:</strong> quando você gera um link para compartilhar, quem tiver o link vê
            aquele relatório até ele expirar ou você revogar.
          </li>
          <li>
            <strong>Extrato do banco:</strong> quando você importa um extrato em PDF, o texto dele é enviado ao Google
            Gemini só para copiar data, nome e valor de cada lançamento. O arquivo e a senha do PDF não ficam guardados;
            ficam só os lançamentos que você confirmar e as respostas “nome do extrato → categoria”, para as próximas
            importações.
          </li>
          <li>
            <strong>Serviços que fazem o app funcionar:</strong> Google Firebase (login e banco de dados), Render
            (servidor), Brevo (envio de emails), Google Gemini (assistente com inteligência artificial, só para quem
            usa), Asaas (pagamento do Premium, só para quem assina) e, só se você conectar, Telegram ou WhatsApp
            (assistente por mensagem). Eles tratam os dados apenas para prestar esse serviço.
          </li>
        </ul>

        <h2>Pagamentos (Premium)</h2>
        <p>
          Quem assina o Premium paga pelo <strong>Asaas</strong>, que processa o pagamento como responsável por ele.
          Para emitir a cobrança, o Asaas precisa do seu nome, email e CPF ou CNPJ (exigência das regras de pagamento
          no Brasil). O CPF/CNPJ é enviado direto ao Asaas e <strong>não fica guardado no PAR.</strong>; o número
          do cartão é digitado na página do próprio Asaas e nunca passa pelo PAR.
        </p>
        <p>
          No PAR. ficam só os dados da assinatura: plano, situação (em teste, ativa, cancelada), datas, quem assinou
          e a versão dos termos aceita. Eles são mantidos enquanto a conta existir e, depois, pelo tempo que a lei
          exigir para comprovar pagamentos.
        </p>

        <h2>Seus direitos (LGPD)</h2>
        <p>
          Você pode ver e corrigir seus dados a qualquer momento no app, exportar seus lançamentos em{" "}
          <strong>Relatórios → Exportar</strong> e apagar sua conta em <strong>Conta → Excluir conta</strong>.
        </p>

        <h2>Excluir conta</h2>
        <p>
          Ao excluir a conta, apagamos na hora seu login, seu perfil, sua conta pessoal com tudo o que foi lançado
          nela, seus cartões e dívidas pessoais, seus links de relatório e a conexão com Telegram/WhatsApp. Se você
          era a última pessoa do grupo, o grupo inteiro é apagado. Se ainda tiver alguém, o que é do grupo (conta
          conjunta, cartões e metas do grupo) continua com essa pessoa. Não dá para desfazer.
        </p>

        <h2>Segurança</h2>
        <p>
          A conexão é sempre criptografada (HTTPS), o acesso aos dados exige login e cada pessoa só acessa os dados
          do próprio grupo.
        </p>

        <h2>Contato</h2>
        <p>
          {CONTACT_EMAIL ? (
            <>
              Dúvidas ou pedidos sobre seus dados: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </>
          ) : (
            <>Dúvidas ou pedidos sobre seus dados: use as opções em Conta, dentro do app.</>
          )}{" "}
          Se esta política mudar, a data no topo é atualizada.
        </p>

        <p className="legal-back">
          <Link to="/" className="link">Voltar para o PAR.</Link>
        </p>
      </article>
    </div>
  );
}
