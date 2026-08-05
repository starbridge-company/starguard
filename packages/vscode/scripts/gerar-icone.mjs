// ============================================================
// Gera o ícone 128×128 da extensão.
//
// Por que NÃO a logo da Starbridge: ela é um wordmark largo (2000×537) e
// escuro sobre transparente. Espremido num quadrado de 128 px o texto fica
// ilegível, e sobre o fundo escuro da marca ele simplesmente some. Wordmark não
// vira ícone — a Marketplace mostra isto em ~40 px numa lista.
//
// O que funciona nesse tamanho é um SÍMBOLO, e o produto já tem um: o escudo
// (`IconShield`) que aparece no login e no cabeçalho do app. Mesmo símbolo,
// mesma cor de destaque — quem vê o ícone reconhece a ferramenta.
//
// **É um padrão razoável, não uma decisão de design.** Se a Starbridge tiver
// uma marca própria para o StarGuard, troque `icon.png` — nada no código
// depende deste arquivo além do `package.json`.
//
// `sharp` já está na árvore (o Next o usa para otimizar imagem); rasteriza o
// SVG sem dependência nova.
// ============================================================
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(aqui, "..", "icon.png");

const LADO = 128;
/** Fundo da marca — o mesmo tom escuro do app. */
const FUNDO = "#0f1512";
/** `--accent` do `globals.css`, em hex. */
const DESTAQUE = "#5cb69f";

// Escudo com visto, na mesma família do `HiOutlineShieldCheck` que o app usa.
// Traço grosso de propósito: linha fina desaparece quando a Marketplace
// reduz o ícone para a listagem.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${LADO}" height="${LADO}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="26" fill="${FUNDO}"/>
  <path d="M64 20 C 52 30, 38 33, 28 33 C 26 40, 25 47, 25 54 c 0 26, 16 45, 39 53 c 23 -8, 39 -27, 39 -53 c 0 -7, -1 -14, -3 -21 c -10 0, -24 -3, -36 -13 z"
        fill="none" stroke="${DESTAQUE}" stroke-width="7" stroke-linejoin="round"/>
  <path d="M48 63 l 12 12 l 22 -24"
        fill="none" stroke="${DESTAQUE}" stroke-width="9"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

await sharp(Buffer.from(SVG)).png().toFile(DESTINO);

console.log(`[vscode] ícone gerado: ${DESTINO} (${LADO}×${LADO})`);
