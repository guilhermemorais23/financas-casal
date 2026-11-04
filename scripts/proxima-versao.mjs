// Qual versão este código vai ganhar quando chegar no master.
//
// Por quê: o CI faz o build do frontend e publica ANTES do semantic-release
// subir a versão (release.yml roda em paralelo). Lendo só o package.json, o
// app no ar mostraria sempre a versão anterior. Este script faz a mesma conta
// do semantic-release (preset conventionalcommits, regras padrão) olhando os
// commits desde a última tag:
//   - "tipo!:" ou "BREAKING CHANGE" no corpo -> versão maior (2.0.0)
//   - feat                                     -> menor (1.51.0)
//   - fix, perf                                -> patch (1.50.2)
//   - resto (chore, docs, test, style...)      -> não sai versão nova
// Sem tag nenhuma, ou sem commit que gere versão: a do package.json.
//
// Uso: node scripts/proxima-versao.mjs   (imprime só o número, ex.: 1.51.0)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function nextVersion(current, messages) {
  let bump = 0; // 0 nada, 1 patch, 2 menor, 3 maior
  for (const message of messages) {
    const subject = message.split("\n")[0];
    const type = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
    if (!type) continue;
    if (type[3] || /^BREAKING[ -]CHANGE:/m.test(message)) bump = Math.max(bump, 3);
    else if (type[1] === "feat") bump = Math.max(bump, 2);
    else if (type[1] === "fix" || type[1] === "perf") bump = Math.max(bump, 1);
  }
  const [major, minor, patch] = current.split(".").map(Number);
  if (bump === 3) return `${major + 1}.0.0`;
  if (bump === 2) return `${major}.${minor + 1}.0`;
  if (bump === 1) return `${major}.${minor}.${patch + 1}`;
  return current;
}

function main() {
  let tag;
  try {
    tag = git("describe", "--tags", "--abbrev=0", "--match", "v*");
  } catch {
    return packageVersion;
  }
  const log = git("log", `${tag}..HEAD`, "--format=%B%x00");
  const messages = log.split("\0").map((m) => m.trim()).filter(Boolean);
  return nextVersion(tag.replace(/^v/, ""), messages);
}

// Chamado direto (node scripts/proxima-versao.mjs), não importado.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(main());
}
