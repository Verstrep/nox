import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "NOX - Orchestration du developpement assiste par IA",
  description:
    "NOX orchestre la conception, le decoupage et l'execution des taches de developpement assistees par IA.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-nox-base font-sans text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
