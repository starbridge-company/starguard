import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "StarGuard | Copilot de Segurança",
  description:
    "Plataforma de segurança assistida por IA para desenvolvimento seguro de software — DevSecOps ponta a ponta, headless e AI-native.",
};

// Aplica o tema salvo antes da hidratação para evitar flash.
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("sg_theme") || "dark";
    document.documentElement.setAttribute("data-theme", t);
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${poppins.variable}`}>{children}</body>
    </html>
  );
}
