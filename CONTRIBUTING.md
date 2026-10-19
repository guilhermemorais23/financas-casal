# Como contribuir

## Branches

- **`master`** — produção. É o que está rodando no Render (backend) e no Firebase Hosting (frontend). Ninguém commita direto aqui.
- **Um branch por tarefa**, criado a partir do `master` e nomeado pelo tipo: `feat/conta-so-esta-vez`, `fix/painel-cartao`, `docs/readme-atualizado`. Cada branch leva só o que é daquela tarefa.

Fluxo de qualquer mudança, sempre nessa ordem:

1. **Criar o branch a partir do `master` atualizado** (guarde com `git stash` qualquer coisa que não seja da tarefa):
   ```
   git checkout master
   git pull
   git checkout -b feat/minha-tarefa
   ```
2. **Testar localmente** — rodar `npm run dev` (emulador + backend + frontend), confirmar que o fluxo que você mexeu continua funcionando (veja o roteiro em [README.md](README.md#verificando-que-funciona)) e que `npm --prefix backend run build`, `npm --prefix frontend run build` e `npm run test:backend` passam.
3. **Commitar e subir o branch**:
   ```
   git add <arquivos>
   git commit -m "feat: adiciona X"
   git push -u origin feat/minha-tarefa
   ```
4. **Abrir o PR do branch para o `master`** no GitHub. O CI roda build e testes no PR; revise o diff antes de mergear.
5. **Mergear o PR** → isso é o que sobe pra produção, sozinho: o CI testa de novo, publica o backend (Render) e o frontend (Firebase Hosting) e o semantic-release cria a versão nova (`chore(release): X.Y.Z`). Detalhes em [DEPLOY.md](DEPLOY.md).
6. **Apagar o branch** depois do merge (botão "Delete branch" no PR).

O branch `Desenvolvimento` (com D maiúsculo) ainda existe no GitHub, mas não faz parte do fluxo atual. O CI está configurado pra rodar em push no `desenvolvimento` minúsculo (`.github/workflows/ci.yml`), então push nele não dispara o CI; PRs disparam normalmente.

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

## Comentários no código

Comentários no código (`//`, `/* */`, `{/* */}` no JSX) são escritos **em português**, no mesmo tom direto do resto do app. Nomes de variáveis, funções e arquivos continuam em inglês. Ao mexer num arquivo que ainda tem comentários antigos em inglês, vale traduzir os que estiver tocando.

## Antes de abrir o PR

- [ ] `npm --prefix backend run build` sem erro
- [ ] `npm --prefix frontend run build` sem erro
- [ ] Testado manualmente contra o emulador local
- [ ] Nenhum arquivo de segredo (`.env`, `.env.production`, `serviceAccountKey.json`) staged — confira com `git status`
