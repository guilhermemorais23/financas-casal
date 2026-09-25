// Qual edição da apresentação de boas-vindas / "o que tem de novo" esta conta
// já viu. Todo mundo -- contas novas e antigas -- vê cada edição uma vez;
// aumente TOUR_EDITION quando a apresentação tiver conteúdo novo que vale
// mostrar de novo. Por id de usuário, então uma segunda pessoa entrando no
// mesmo celular vê a dela. localStorage pode dar erro (modo privado,
// armazenamento bloqueado) -- perder a apresentação não faz mal, então todo
// acesso só ignora o erro.
export const TOUR_EDITION = "2026-09-painel-chat";

const key = (userId: string) => `par:welcome-tour:${userId}`;

export function isWelcomeTourPending(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) !== TOUR_EDITION;
  } catch {
    return false;
  }
}

export function markWelcomeTourDone(userId: string): void {
  try {
    localStorage.setItem(key(userId), TOUR_EDITION);
  } catch {
    // ignore
  }
}
