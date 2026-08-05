# Como contribuir

## Branches

- **`master`** — produção. É o que está rodando no Render (backend) e é o que se publica no Firebase Hosting (frontend). Ninguém commita direto aqui.
- **`desenvolvimento`** — branch de teste/staging. É onde qualquer mudança passa antes de ir pra produção.

Fluxo de qualquer mudança, sempre nessa ordem:

1. **Testar localmente** — rodar `npm run dev` (emulador + backend + frontend), confirmar que o fluxo que você mexeu continua funcionando (veja o roteiro em [README.md](README.md#verificando-que-funciona)) e que `npm --prefix backend run build` / `npm --prefix frontend run build` compilam sem erro.
2. **Commitar e subir pra `desenvolvimento`**:
   ```
   git checkout desenvolvimento
   git pull
   git add <arquivos>
   git commit -m "feat: adiciona X"
   git push origin desenvolvimento
   ```
3. **Testar de novo a partir da branch** (rodar local em cima do que foi de fato commitado — pega qualquer coisa que só existia sem commitar na sua máquina).
4. **Se funcionou, abrir PR de `desenvolvimento` para `master`** no GitHub e revisar o diff antes de mergear.
5. **Mergear o PR** → isso é o que efetivamente sobe pra produção:
   - Backend: o Render está configurado para redeployar automaticamente a cada push em `master`.
   - Frontend: precisa rodar `firebase deploy --only hosting --project par-projeto` manualmente depois do merge (não é automático ainda — ver [DEPLOY.md](DEPLOY.md)).

Nunca dar `git push origin master` direto. Se `master` tiver proteção de branch ativada no GitHub (Settings → Branches → Branch protection rules → exigir PR), isso nem deixa acontecer por acidente.

## Mensagens de commit

Prefixo + descrição curta e direta do que foi feito, em português:

| Prefixo | Quando usar |
|---|---|
| `feat:` | funcionalidade nova |
| `fix:` | correção de bug |
| `chore:` | tarefa de manutenção (deps, config, limpeza) sem mudar comportamento |
| `docs:` | só documentação (README, este arquivo, comentários) |
| `refactor:` | reorganiza código sem mudar comportamento observável |
| `style:` | CSS/visual, sem mudar lógica |
| `perf:` | melhoria de performance |

Exemplos:
```
feat: adiciona botão de excluir transação na página Par
fix: corrige split de despesa não dividir certo com 3+ membros
chore: atualiza tsconfig para moduleResolution node16
docs: documenta processo de deploy e fluxo de branches
```

A mensagem deve explicar **o que mudou**, não só repetir o prefixo — "fix: bug" não serve, "fix: corrige saldo negativo aparecendo pro pagador da própria despesa" serve.

## Antes de abrir o PR

- [ ] `npm --prefix backend run build` sem erro
- [ ] `npm --prefix frontend run build` sem erro
- [ ] Testado manualmente contra o emulador local
- [ ] Nenhum arquivo de segredo (`.env`, `.env.production`, `serviceAccountKey.json`) staged — confira com `git status`
