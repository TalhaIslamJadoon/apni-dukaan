"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { hasRetail, useShop } from "@/lib/store";
import SetupScreen from "@/components/SetupScreen";

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS GATES (SALE version — Talha, 15 Nov 2026): Business Setup ki
// choice ke hisaab se andar ka view. SetupGate pehli dafa wizard dikhata
// hai; CanteenOnly / RetailOnly band hisse par polite notice dete hain
// (StaffGate ke "Access Nahi Hai" card wale andaaz mein). Data kabhi
// delete nahi hota — gate sirf VIEW rokta hai.
// ─────────────────────────────────────────────────────────────────────────────

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => { setM(true); }, []);
  return m;
}

const splash = <div className="min-h-screen" style={{ background: "#0F172A" }} />;

/** Pehla setup (setupDone=false) — children ki jagah wizard. */
export function SetupGate({ children }: { children: React.ReactNode }) {
  const shop = useShop();
  const mounted = useMounted();
  if (!mounted) return splash;
  if (!shop.setupDone) return <SetupScreen />;
  return <>{children}</>;
}

/** Band hisse ka polite full-page notice. */
export function DisabledSectionNotice({ what }: { what: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#FFF7ED" }} data-testid="section-disabled-notice">
      <div className="bg-white rounded-3xl shadow-lg border border-orange-100 p-8 w-full max-w-md text-center pop-in">
        <div className="text-5xl mb-2">🚫</div>
        <h1 className="text-xl font-extrabold mb-1">Ye Hissa On Nahi Hai</h1>
        <p className="text-sm text-stone-500 font-bold">
          <b>{what}</b> aap ke business setup mein on nahi hai.<br />
          Chahiye to Owner Dashboard → Settings → <b>🏪 Business Setup</b> se apni business type tabdeel karein — data delete nahi hoga.
        </p>
        <div className="flex gap-2 mt-4">
          <Link href="/" className="flex-1 rounded-xl py-3 font-extrabold text-white text-center" style={{ background: "#F97316" }}>🏠 Home</Link>
          <Link href="/owner" className="flex-1 rounded-xl py-3 font-extrabold text-white text-center" style={{ background: "#0F172A" }}>⚙️ Owner Settings</Link>
        </div>
      </div>
    </div>
  );
}

/** Sirf tab render karo jab setup mein canteen ON ho. */
export function CanteenOnly({ children, what = "Canteen" }: { children: React.ReactNode; what?: string }) {
  const shop = useShop();
  const mounted = useMounted();
  if (!mounted) return splash;
  if (!shop.hasCanteen) return <DisabledSectionNotice what={what} />;
  return <>{children}</>;
}

/** Sirf tab render karo jab setup mein retail dukaan ON ho. */
export function RetailOnly({ children, what = "Dukaan (Retail)" }: { children: React.ReactNode; what?: string }) {
  const shop = useShop();
  const mounted = useMounted();
  if (!mounted) return splash;
  if (!hasRetail(shop)) return <DisabledSectionNotice what={what} />;
  return <>{children}</>;
}
