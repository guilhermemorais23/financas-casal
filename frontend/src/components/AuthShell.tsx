import type { ReactNode } from "react";
import { Brand } from "./Brand";

// Moldura das telas de fora do app (Entrar, Criar conta, Esqueci a senha):
// lado verde com a frase e uma prévia do Painel, e o formulário do lado.
// A prévia usa SEMPRE valores de exemplo -- nenhuma tela de login pode
// mostrar dado de verdade, porque qualquer pessoa abre esta página.
// No celular o lado verde vira o topo e a prévia some (index.css).
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="login-split">
      <aside className="login-side">
        <Brand animated />
        <div className="login-copy">
          <h2>Finanças em grupo, sem atrito.</h2>
          <p>Contas de casal, cartões e metas num lugar só. Cada um vê o próprio saldo e o saldo do grupo.</p>
        </div>
        <div className="login-preview" aria-label="Exemplo do Painel">
          <p className="login-preview-title">Onde está o dinheiro · exemplo</p>
          <div className="money-bar" aria-hidden="true">
            <span style={{ width: "62%", background: "#fffdf8" }} />
            <span style={{ width: "38%", background: "#f2b84b" }} />
          </div>
          <div className="login-preview-row">
            <span>Conta pessoal</span>
            <strong>R$ 2.480,00</strong>
          </div>
          <div className="login-preview-row">
            <span>Guardado em cartões</span>
            <strong>R$ 1.520,00</strong>
          </div>
          <p className="login-preview-note">Valores de exemplo, não são de ninguém.</p>
        </div>
      </aside>
      <main className="login-main">
        <div className="login-main-inner">{children}</div>
      </main>
    </div>
  );
}
