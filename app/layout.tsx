import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { translate } from "@/lib/i18n/translate";
import { getLocale } from "@/lib/i18n/server";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Título e descrição eram constantes em português: a aba do navegador, o
// histórico e o cartão de compartilhamento ignoravam o idioma escolhido.
// `generateMetadata` roda por requisição e lê o mesmo cookie que o `<html lang>`.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "meta.title"),
    description: translate(locale, "meta.description"),
  };
}

// Aplica o tema salvo antes da hidratação para evitar flash.
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("sg_theme") || "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch(e) {}
})();
`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `lang` deixa de ser fixo: leitores de tela, correção ortográfica e
  // tradução automática do navegador dependem dele estar certo.
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${poppins.variable}`}>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
