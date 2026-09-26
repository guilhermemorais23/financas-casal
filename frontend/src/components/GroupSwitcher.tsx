import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { readCache, writeCache } from "../utils/pageCache";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export interface GroupSummary {
  id: string;
  nickname: string | null;
  emoji: string | null;
  memberCount: number;
}

export const DEFAULT_GROUP_NAME = "Nosso grupo";
export const DEFAULT_GROUP_EMOJI = "👥";

export function groupLabel(group: Pick<GroupSummary, "nickname"> | null | undefined): string {
  return group?.nickname || DEFAULT_GROUP_NAME;
}

// Lista de grupos da pessoa, pro seletor e pra tela Conta. Mostra na hora o
// que ficou guardado e atualiza por baixo.
export function useMyGroups() {
  const { user, token } = useAuth();
  const cacheKey = `my-groups:${user?.id ?? ""}`;
  const [groups, setGroups] = useState<GroupSummary[]>(() => readCache<GroupSummary[]>(cacheKey) ?? []);

  const reload = useCallback(async () => {
    if (!token) return;
    const response = await apiRequest<{ groups: GroupSummary[] }>("/groups", { token });
    setGroups(response.groups);
    writeCache(cacheKey, response.groups);
  }, [token, cacheKey]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  return { groups, reload };
}

// Botão com o grupo aberto (topo no celular, barra lateral no PC). Abre a
// lista dos grupos da pessoa pra trocar, criar outro ou entrar com convite.
export function GroupSwitcher({ className = "" }: { className?: string }) {
  const { activeGroupId, switchGroup } = useAuth();
  const { groups } = useMyGroups();
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const active = groups.find((group) => group.id === activeGroupId) ?? null;

  function pick(groupId: string) {
    setIsOpen(false);
    if (groupId !== activeGroupId) {
      switchGroup(groupId);
      navigate("/dashboard");
    }
  }

  return (
    <>
      <button
        type="button"
        className={`group-switcher${className ? ` ${className}` : ""}`}
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Grupo aberto: ${groupLabel(active)}. Trocar de grupo`}
      >
        <span className="group-switcher-emoji" aria-hidden="true">{active?.emoji || DEFAULT_GROUP_EMOJI}</span>
        <span className="group-switcher-name text-truncate">{groupLabel(active)}</span>
        <Icon name="chevron" className="group-switcher-chevron" />
      </button>

      {isOpen && (
        <Sheet onClose={() => setIsOpen(false)} className="group-sheet" labelledBy="group-sheet-title">
          <h2 id="group-sheet-title" className="group-sheet-title">Seus grupos</h2>
          <p className="group-sheet-hint">Cada grupo tem os próprios gastos, metas e contas. Quem está num grupo não vê os outros.</p>
          <ul className="group-sheet-list">
            {groups.map((group) => {
              const isActive = group.id === activeGroupId;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className={`group-sheet-item${isActive ? " active" : ""}`}
                    onClick={() => pick(group.id)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="group-sheet-emoji" aria-hidden="true">{group.emoji || DEFAULT_GROUP_EMOJI}</span>
                    <span className="group-sheet-text">
                      <strong className="text-truncate">{groupLabel(group)}</strong>
                      <span>{group.memberCount === 1 ? "Só você" : `${group.memberCount} pessoas`}</span>
                    </span>
                    {isActive && <Icon name="check" className="group-sheet-check" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="group-sheet-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setIsOpen(false);
                navigate("/group-setup?novo=1");
              }}
            >
              Criar novo grupo
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setIsOpen(false);
                navigate("/group-setup?convite=1");
              }}
            >
              Entrar com convite
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
