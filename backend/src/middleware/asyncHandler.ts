// Embrulha uma função de rota assíncrona (async) pra que um erro dentro dela
// chegue no errorHandler. Sem isto, o Express (versão 4) não pega erro de
// função async e o pedido ficaria sem resposta. Por isso toda rota é
// registrada como: router.get("/", asyncHandler(minhaFuncao)).
import type { NextFunction, Request, Response } from "express";

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(handler: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
