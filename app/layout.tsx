import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canteen POS — Phase 1",
  description: "Canteen Point of Sale prototype (Phase 1, sample menu)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
