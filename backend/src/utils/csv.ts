// CSV mínimo no padrão RFC 4180 -- só põe aspas no campo quando precisa
// (tem vírgula, aspas ou quebra de linha), dobrando as aspas de dentro.
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\r\n");
}
