// ============================================================================
// PONTO DE PARTIDA DO FRONTEND
// ============================================================================
// O navegador abre o frontend/index.html, que só tem uma <div id="root"> e
// carrega este arquivo. Daqui pra frente o React desenha tudo dentro dessa
// div. A ordem é:
//
//   index.html -> main.tsx (este) -> App.tsx (rotas) -> pages/XPage.tsx
//
// - StrictMode: modo de desenvolvimento do React que avisa de erros comuns
//   (não muda nada em produção).
// - BrowserRouter: faz o endereço da barra (/dashboard, /a-pagar...) trocar
//   de tela sem recarregar a página. As rotas em si estão no App.tsx.
// - index.css: todo o visual do app, importado uma vez só aqui.
// - initAppRecovery: se o app quebrar logo depois de um deploy (arquivo
//   antigo que sumiu), recarrega sozinho na versão nova.
//
// Pastas do src/ e por que existem:
//   api/        conversa com o backend (client.ts tem o endereço, VITE_API_URL)
//   auth/       quem está logado (AuthContext)
//   pages/      uma página por rota
//   components/ pedaços reaproveitados em várias telas
//   layouts/    a moldura do app (menu lateral, barra de baixo)
//   routes/     a trava das páginas que exigem login (ProtectedRoute)
//   hooks/      funções do React reaproveitáveis (useTheme...)
//   utils/      funções comuns sem React (formatar R$, datas, cache...)
// ============================================================================
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { initAppRecovery } from './utils/appRecovery'

initAppRecovery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* v7_startTransition: ao trocar de tela, a tela atual continua visível
        até a próxima estar pronta, em vez de piscar o skeleton. */}
    <BrowserRouter future={{ v7_startTransition: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
