import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apni Dukaan — Har Dukaan ka POS",
  description: "Apni Dukaan — canteen, grocery, kapray/rental aur har qisam ki dukaan ke liye mukammal POS system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
