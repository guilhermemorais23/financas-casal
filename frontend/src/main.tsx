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
