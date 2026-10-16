// Variáveis de ambiente do backend, lidas num lugar só. O import
// "dotenv/config" carrega o backend/.env no process.env (no seu PC); em
// produção o Render injeta as variáveis direto, sem arquivo. O modelo de
// todas está em backend/.env.example. Variável obrigatória que faltar
// derruba o servidor na hora de ligar (required), em vez de quebrar depois.
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST vêm do .env no seu PC
// (ver backend/.env.example) e precisam ser lidos antes de qualquer chamada a
// initializeApp()/getFirestore() -- o import "dotenv/config" lá em cima já
// rodou, então o process.env está preenchido quando o db/firestore.ts liga o
// Admin SDK. Em produção ficam vazios, e o SDK usa o projeto real.

export const env = {
  firebaseProjectId: required("FIREBASE_PROJECT_ID"),
  port: Number(process.env.PORT ?? 4000),
  // Opcional: sem credenciais, o envio de e-mail é pulado (registrado no log,
  // sem erro). Envia pelo SMTP do próprio Gmail, com uma conta pessoal + uma
  // Senha de App (não a senha real da conta -- gerada em Conta Google >
  // Segurança > Verificação em duas etapas > Senhas de app, que só aparece com
  // a verificação em duas etapas ligada). É um quebra-galho até usar um
  // provedor de e-mail de verdade (Resend etc.) num domínio próprio
  // verificado -- e este projeto ainda não tem domínio.
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  // Segredo compartilhado do POST /api/reminders/run -- um cron externo diário
  // (o mesmo cron-job.org que já mantém o servidor acordado) chama a rota com
  // isto no cabeçalho x-cron-secret. Vazio = a rota recusa toda chamada, o
  // mesmo "desligado por padrão" de quando falta a chave do Resend.
  cronSecret: process.env.CRON_SECRET,
};
