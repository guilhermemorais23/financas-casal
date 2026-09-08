import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { deleteCategory, findCategoryById, insertCategory, updateCategory } from "./categories.repository";

describe("updateCategory / deleteCategory", () => {
  it("renames and re-emojis a category, keeping its doc id", async () => {
    const { groupId } = await createTestGroup();
    const category = await insertCategory({ groupId, name: "Lazer", emoji: "🎮" });

    const renamed = await updateCategory(category.id, { name: "Lazer 2", emoji: "🎯" });
    expect(renamed.id).toBe(category.id);
    expect(renamed.name).toBe("Lazer 2");
    expect(renamed.emoji).toBe("🎯");
  });

  it("deletes a category", async () => {
    const { groupId } = await createTestGroup();
    const category = await insertCategory({ groupId, name: "Temporária", emoji: null });

    await deleteCategory(category.id);
    expect(await findCategoryById(category.id)).toBeNull();
  });
});
