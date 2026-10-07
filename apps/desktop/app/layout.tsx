import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Remote N3",
  description: "Cliente desktop do Remote N3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
