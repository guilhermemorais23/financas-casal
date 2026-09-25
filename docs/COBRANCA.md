# Cobrança do Premium (Asaas)

O código da cobrança já está no app, mas fica **desligado** até você ligar.
Desligado, todo mundo tem todas as funções e nada é gravado sobre assinatura.

## Como funciona

- **Plano por grupo** (o casal paga uma vez): Premium mensal ou anual.
- **Teste grátis** de `BILLING_TRIAL_DAYS` dias pra todo grupo, contado a partir
  da primeira vez que alguém abre o app com a cobrança ligada.
- **Premium libera:** assistente com IA (app, Telegram, WhatsApp), importar
  extrato, exportar CSV e link de relatório. Sem Premium, o assistente continua
  lançando "gastei 50 no mercado", só sem IA.
- **Pagamento:** a pessoa informa CPF/CNPJ, aceita os termos e vai pra página
  de pagamento do Asaas (Pix, boleto ou cartão). O CPF vai direto pro Asaas e
  não fica guardado no PAR.; o cartão nunca passa pelo PAR.
- **Quem libera o Premium é o webhook do Asaas** (`/api/billing/webhook`), quando
  o pagamento é confirmado. Atraso: 3 dias de tolerância. Estorno: acaba na hora.
- **Cancelamento** em Conta → Plano, a qualquer momento. Até 7 dias depois de um
  pagamento, dá pra cancelar com reembolso integral (direito de arrependimento).
- **Admin → Assinaturas:** situação da configuração, receita por mês (MRR),
  grupos por situação, cortesias (+30 dias ou sem prazo), eventos do Asaas e o
  registro das ações do admin.

## Passo a passo pra ligar

1. **Crie a conta no Asaas** (dá com CPF). Comece pelo ambiente de testes:
   https://sandbox.asaas.com
2. **Chave da API:** Integrações → Chave de API. Coloque no Render:
   `ASAAS_API_KEY=...` e `ASAAS_ENV=sandbox`.
3. **Webhook:** Integrações → Webhooks → Adicionar.
   - URL: `https://SEU-BACKEND.onrender.com/api/billing/webhook`
   - Token de autenticação: invente um texto longo e coloque o mesmo em
     `ASAAS_WEBHOOK_TOKEN` no Render.
   - Eventos: cobranças (confirmada, recebida, vencida, estornada,
     contestação) e assinaturas (removida/inativada).
4. **Termos:** no frontend, preencha `VITE_LEGAL_NAME` e `VITE_LEGAL_DOCUMENT`
   (nome e CPF/CNPJ de quem presta o serviço) e `VITE_PRIVACY_CONTACT_EMAIL`.
5. **Ligue:** `BILLING_ENABLED=true` no Render. Confira em Admin → Assinaturas
   se os três itens de configuração ficaram verdes.
6. **Teste no sandbox:** assine com um CPF de teste e pague pela página do
   Asaas (no sandbox o pagamento é de mentira). O grupo deve aparecer como
   "Assinante" em Admin → Assinaturas.
7. **Produção:** troque a chave pela de produção, `ASAAS_ENV=production`, e
   cadastre o webhook de novo na conta de produção.

## Antes de cobrar de verdade

- Os Termos de uso e a Política de privacidade são um ponto de partida escrito
  com base no Código de Defesa do Consumidor e na LGPD. **Vale uma revisão por
  um advogado.**
- Recebendo como pessoa física, a renda entra no seu imposto de renda (carnê-leão
  mensal). Com mais volume, um CNPJ pode sair mais barato. **Converse com um
  contador** sobre qual formato e sobre emissão de nota fiscal.
