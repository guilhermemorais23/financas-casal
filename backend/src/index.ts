// ============================================================================
// PONTO DE PARTIDA DO BACKEND
// ============================================================================
// `npm run dev` (dentro de backend/) roda este arquivo com o tsx, que executa
// TypeScript direto. Em produção, o Render roda a versão compilada
// (dist/index.js) dentro do Docker (ver backend/Dockerfile).
//
// O que acontece aqui:
//   1. installFirestoreUsageCounter: começa a contar as leituras do Firestore
//      (o plano grátis tem limite diário; o Admin mostra esse número);
//   2. createApp(): monta o servidor Express inteiro (rotas, segurança) --
//      está em app.ts;
//   3. app.listen: liga o servidor na porta (4000 no seu PC, a que o Render
//      mandar em produção) e começa a atender os pedidos do frontend.
//
// Cada arquivo faz uma coisa: o app.ts monta, o index.ts só liga.
// ============================================================================
import { createApp } from "./app";
import { installFirestoreUsageCounter } from "./utils/firestoreUsage";
import { env } from "./config/env";

installFirestoreUsageCounter();
const app = createApp();

app.listen(env.port, () => {
  console.log(`fincae backend listening on http://localhost:${env.port}`);
});
