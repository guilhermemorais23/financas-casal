import { db } from "../src/db/firestore";

const DEFAULT_CATEGORIES: { name: string; emoji: string }[] = [
  { name: "Moradia", emoji: "🏠" },
  { name: "Alimentação", emoji: "🍔" },
  { name: "Transporte", emoji: "🚗" },
  { name: "Saúde", emoji: "🩺" },
  { name: "Lazer", emoji: "🎮" },
  { name: "Compras", emoji: "🛍️" },
  { name: "Contas Fixas", emoji: "📄" },
  { name: "Educação", emoji: "📚" },
  { name: "Outros", emoji: "✨" },
];

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\//g, "-");
}

async function seed() {
  const batch = db.batch();
  for (const category of DEFAULT_CATEGORIES) {
    const id = `global__${normalize(category.name)}`;
    batch.set(db.collection("categories").doc(id), {
      groupId: null,
      name: category.name,
      emoji: category.emoji,
      isDefault: true,
      createdAt: new Date(),
    });
  }
  await batch.commit();
  console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
