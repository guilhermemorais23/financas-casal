// ============================================================================
// MÓDULO categories -- endereços /api/categories
// ============================================================================
// O que faz: Categorias de gasto e de receita: as padrão (de todos os grupos)
//            e as criadas pelo grupo (renomear, trocar emoji, excluir).
// Quem chama: Conta, Nova despesa, edição de lançamento, importar extrato,
//             organizar gastos sem categoria.
//
// Caminho de um pedido dentro do módulo:
//   *.routes.ts      endereço -> função (este arquivo)
//   *.controller.ts  lê e valida o pedido (req.body, req.params), responde
//   *.service.ts     regra de negócio (quem pode, o que calcula)
//   *.repository.ts  lê e grava no Firestore
// ============================================================================
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoGroupError, requireGroupId } from "../groups/groups.service";
import {
  DuplicateCategoryError,
  deleteCategory,
  findCategoryById,
  findVisibleCategories,
  insertCategory,
  updateCategory,
} from "./categories.repository";
import { isNonEmptyString } from "../../utils/validation";
import { suggestCategory } from "./categorySuggest";

export class CategoryNotFoundError extends Error {}
export class DefaultCategoryError extends Error {}

// Usado pelo PATCH e pelo DELETE abaixo -- só dá pra mexer em categoria deste
// grupo. Uma categoria padrão (groupId: null) é de todos os grupos do app,
// então ninguém edita nem apaga; uma categoria de *outro* grupo tem que dar
// 404, sem revelar que existe.
async function requireOwnCategory(userId: string, categoryId: string) {
  const groupId = await requireGroupId(userId);
  const category = await findCategoryById(categoryId);
  if (!category || category.groupId !== groupId) {
    throw new CategoryNotFoundError();
  }
  if (category.isDefault) {
    throw new DefaultCategoryError();
  }
  return category;
}

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const groupId = await requireGroupId(req.user!.id);
    const categories = await findVisibleCategories(groupId);
    res.status(200).json(categories);
  })
);

// Palpite de categoria enquanto a pessoa digita a descrição (ver
// categorySuggest.ts). Fica antes de qualquer rota com /:id.
categoriesRouter.get(
  "/suggest",
  asyncHandler(async (req, res) => {
    const { description, type } = req.query;
    if (type !== undefined && type !== "expense" && type !== "income") {
      res.status(400).json({ error: "type precisa ser expense ou income" });
      return;
    }
    const groupId = await requireGroupId(req.user!.id);
    const suggestion = await suggestCategory(
      groupId,
      req.user!.id,
      typeof description === "string" ? description : "",
      type ?? "expense"
    );
    res.status(200).json(suggestion);
  })
);

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, emoji, type, parentId } = req.body ?? {};
    if (
      !isNonEmptyString(name) ||
      (type !== undefined && type !== "expense" && type !== "income") ||
      (parentId !== undefined && parentId !== null && !isNonEmptyString(parentId))
    ) {
      res.status(400).json({ error: "name is required; type (if set) must be expense or income" });
      return;
    }

    const groupId = await requireGroupId(req.user!.id);

    // Subcategoria: a de cima tem que ser deste grupo (ou padrão) e não pode
    // ser ela mesma uma subcategoria. O tipo (gasto/receita) vem dela.
    let parent = null;
    if (isNonEmptyString(parentId)) {
      parent = (await findVisibleCategories(groupId)).find((category) => category.id === parentId) ?? null;
      if (!parent || parent.parentId) {
        res.status(400).json({ error: "Categoria de cima não encontrada (ou já é uma subcategoria)." });
        return;
      }
    }

    try {
      const category = await insertCategory({
        groupId,
        name: name.trim(),
        emoji: isNonEmptyString(emoji) ? emoji.trim() : null,
        type: parent?.type ?? type ?? "expense",
        parentId: parent?.id ?? null,
      });
      res.status(201).json(category);
    } catch (err) {
      if (err instanceof DuplicateCategoryError) {
        res.status(409).json({ error: "category already exists" });
        return;
      }
      throw err;
    }
  })
);

categoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { name, emoji } = req.body ?? {};
    if (
      (name !== undefined && !isNonEmptyString(name)) ||
      (emoji !== undefined && emoji !== null && !isNonEmptyString(emoji))
    ) {
      res.status(400).json({ error: "invalid category update" });
      return;
    }

    try {
      await requireOwnCategory(req.user!.id, req.params.id);
      const category = await updateCategory(req.params.id, {
        name: isNonEmptyString(name) ? name.trim() : undefined,
        emoji: emoji !== undefined ? (isNonEmptyString(emoji) ? emoji.trim() : null) : undefined,
      });
      res.status(200).json(category);
    } catch (err) {
      if (err instanceof NoGroupError || err instanceof CategoryNotFoundError) {
        res.status(404).json({ error: "category not found" });
        return;
      }
      if (err instanceof DefaultCategoryError) {
        res.status(403).json({ error: "cannot edit a default category" });
        return;
      }
      throw err;
    }
  })
);

categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      const category = await requireOwnCategory(req.user!.id, req.params.id);
      const children = (await findVisibleCategories(category.groupId)).filter((other) => other.parentId === category.id);
      if (children.length > 0) {
        res.status(409).json({ error: "Essa categoria tem subcategorias. Apague as subcategorias antes." });
        return;
      }
      await deleteCategory({ id: category.id, groupId: category.groupId!, type: category.type, parentId: category.parentId });
      res.status(204).send();
    } catch (err) {
      if (err instanceof NoGroupError || err instanceof CategoryNotFoundError) {
        res.status(404).json({ error: "category not found" });
        return;
      }
      if (err instanceof DefaultCategoryError) {
        res.status(403).json({ error: "cannot delete a default category" });
        return;
      }
      throw err;
    }
  })
);
