// Erros que valem pra qualquer módulo e que o errorHandler
// (middleware/errorHandler.ts) já sabe responder -- assim cada controller não
// precisa repetir o mesmo if.

// Mexer num lançamento da conta pessoal de outra pessoa (pela lista de
// compras, por uma meta...). Só quem criou mexe, a regra de
// canManageTransaction.
export class PartnerPersonalEntryError extends Error {
  constructor() {
    super("Esse gasto saiu da conta pessoal de outra pessoa. Só ela pode mudar ou apagar.");
  }
}
