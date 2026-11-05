// Texto pra comparar sem se importar com acento nem maiúscula ("Pão de
// Açúcar" e "PAO DE ACUCAR" viram o mesmo). Cada lugar faz o resto (tirar
// pontuação, números, espaços) do seu jeito.
export function plainText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
