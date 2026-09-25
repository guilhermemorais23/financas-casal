// Primeira letra do nome, em maiúscula -- é o que aparece no quadradinho de
// categorias, metas e contas no lugar dos emojis (que deixavam o app com
// cara de gerado por IA).
export function initialOf(name: string | null | undefined): string {
  const letter = name?.trim().charAt(0);
  return letter ? letter.toLocaleUpperCase("pt-BR") : "·";
}
