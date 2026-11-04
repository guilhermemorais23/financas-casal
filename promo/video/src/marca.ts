// Cores e fonte da marca (as mesmas do app: frontend/src/index.css).
import { loadFont } from "@remotion/google-fonts/BricolageGrotesque";

export const { fontFamily } = loadFont("normal", { weights: ["400", "600", "700", "800"], subsets: ["latin", "latin-ext"] });

export const COR = {
  verde: "#0e5e58",
  verdeEscuro: "#093e3a",
  creme: "#f4f1ea",
  cremeClaro: "#fffdf8",
  ambar: "#f2b84b",
  tinta: "#1c2b2a",
  tintaSuave: "#566461",
};
