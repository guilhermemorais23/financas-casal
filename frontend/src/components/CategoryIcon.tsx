import type { CSSProperties } from "react";
import { categoryColor } from "../utils/categoryColor";
import { initialOf } from "../utils/initial";
import { Icon } from "./Icon";

// O quadradinho redondo da categoria nas listas de lançamentos: o emoji da
// categoria (ou a inicial, se ela não tiver) sobre um fundo suave da cor
// dela. A cor sai da paleta fixa das categorias (categoryColor), pelo id --
// a mesma categoria tem sempre a mesma cor. Sem categoria: etiqueta cinza.
export function CategoryIcon({
  categoryId,
  name,
  emoji,
}: {
  categoryId: string | null;
  name: string | null;
  emoji?: string | null;
}) {
  if (!categoryId && !name) {
    return (
      <span className="transaction-icon cat-icon is-none" aria-hidden="true">
        <Icon name="tag" />
      </span>
    );
  }
  const style = { "--cat-color": categoryColor(categoryId ?? name) } as CSSProperties;
  return (
    <span className={`transaction-icon cat-icon${emoji ? " has-emoji" : ""}`} style={style} aria-hidden="true">
      {emoji || initialOf(name)}
    </span>
  );
}
