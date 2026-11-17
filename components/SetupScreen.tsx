"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SHOP_DEFAULTS, ShopSettings, completeFirstSetup, hasRetail, loadShop, saveShop } from "@/lib/store";
import { RETAIL_TEMPLATES, templateOf } from "@/lib/templates";

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS SETUP wizard (SALE version — Talha, 15 Nov 2026).
// Pehli dafa system khulte hi (setupDone=false) ye screen Staff Login se
// PEHLE ati hai — staff home aur /online par inline render hoti hai, aur
// /setup route par bhi yehi chalti hai. Owner baad mein Settings →
// Business Setup → "Tabdeel karein" se yahan wapas a sakta hai (change
// mode: maujooda choice pehle se selected, warning ke sath).
//   Step 1: Sirf Canteen / Sirf Dukaan / Dono
//   Step 2 (dukaan ho to): dukaan ki qisam (14 retail templates)
// Confirm par: settings save + template seed (sirf fresh khali catalogue
// par — seedRetailTemplateIfEmpty khud faisla karta hai). Type badalne
// se data KABHI delete nahi hota.
// ─────────────────────────────────────────────────────────────────────────────

export default function SetupScreen({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [changeMode, setChangeMode] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [step, setStep] = useState(1);
  const [canteen, setCanteen] = useState<boolean | null>(null);
  const [needsRetail, setNeedsRetail] = useState(false);
  const [retail, setRetail] = useState<string | null>(null);

  useEffect(() => {
    const cur = loadShop();
    if (cur.setupDone) {
      // Change mode — maujooda choice pehle se bhari hui
      setChangeMode(true);
      setCanteen(cur.hasCanteen);
      const r = hasRetail(cur);
      setNeedsRetail(r);
      setRetail(cur.retailType);
      const tpl = templateOf(cur.retailType);
      setCurrentText(
        cur.hasCanteen && r ? `🏪 Dono — 🍔 Canteen + ${tpl?.emoji ?? "🛒"} ${tpl?.label ?? "Dukaan"}`
        : cur.hasCanteen ? "🍔 Sirf Canteen"
        : `${tpl?.emoji ?? "🛒"} Sirf ${tpl?.label ?? "Dukaan"}`
      );
      if (r) setStep(2);
    }
    setReady(true);
  }, []);

  function choose(kind: "canteen" | "retail" | "both") {
    if (kind === "canteen") { setCanteen(true); setNeedsRetail(false); }
    if (kind === "retail") { setCanteen(false); setNeedsRetail(true); setStep(2); }
    if (kind === "both") { setCanteen(true); setNeedsRetail(true); setStep(2); }
  }

  const canConfirm = canteen !== null && (!needsRetail || !!retail);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  async function confirm() {
    if (!canConfirm || saving) return;
    const cur = loadShop();
    const tpl = needsRetail ? templateOf(retail) : undefined;
    const next: ShopSettings = {
      ...cur,
      hasCanteen: canteen === true,
      retailType: needsRetail ? retail : null,
      setupDone: true,
    };
    // Fresh naam: dukaan ka naam abhi default placeholder hi hai to
    // template ka naam laga do (e.g. "Medical Store") — Owner baad mein
    // Settings se apna asal naam kar sakta hai. Custom naam ko kabhi
    // haath nahi lagta.
    if (tpl && cur.groceryName === SHOP_DEFAULTS.groceryName) next.groceryName = tpl.defaultShopName;
    setSaving(true);
    setSaveErr("");
    try {
      if (!cur.setupDone) {
        // PEHLA setup — wizard login se pehle hai, owner session abhi
        // nahi; server ka /setup/complete darwaza sirf isi halat mein
        // khula hota hai (template seed bhi wahin apply hota hai).
        await completeFirstSetup(next);
      } else {
        // Change mode — owner logged in hai; aam settings save ka rasta
        // (server template guard wahan bhi lagu hai).
        saveShop(next);
      }
    } catch {
      setSaving(false);
      setSaveErr("❌ Setup save nahi hua — dobara try karein. (Agar ye pehla setup hai to server se rabta check karein.)");
      return;
    }
    if (onDone) onDone();
    else router.push("/");
  }

  if (!ready) return <div className="min-h-screen" style={{ background: "#0F172A" }} />;

  const cardCls = (sel: boolean) =>
    `tile-3d rounded-3xl p-5 sm:p-6 text-left shadow-md border-[3px] transition w-full ${sel ? "bg-white" : "bg-white/85"}`;
  const cardStyle = (sel: boolean): React.CSSProperties =>
    sel ? { borderColor: "#F97316", background: "#FFF7ED" } : { borderColor: "#E7E5E4" };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#FFF7ED" }} data-testid="setup-screen">
      <header className="text-white shrink-0" style={{ background: "#0F172A" }}>
        <div className="flex items-center gap-3 px-4 py-3 max-w-4xl mx-auto w-full">
          <div className="text-2xl">🏪</div>
          <div>
            <div className="text-lg font-extrabold leading-tight">Apni Dukaan — Business Setup</div>
            <div className="text-xs opacity-70">{changeMode ? "Apni business type tabdeel karein" : "Pehla setup — 2 minute lageinge"}</div>
          </div>
          {changeMode && (
            <button onClick={() => (onDone ? onDone() : router.push("/"))} data-testid="setup-back"
              className="ml-auto rounded-full px-4 py-2 text-xs font-extrabold text-white shrink-0" style={{ background: "#334155" }}>
              ← Wapas
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 pb-10">
        {changeMode && (
          <div className="mb-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4" data-testid="setup-change-warning">
            <div className="font-extrabold">Maujooda setup: <span data-testid="setup-current">{currentText}</span></div>
            <p className="text-sm font-bold text-stone-600 mt-1">
              ⚠️ Business type badalne se <b>koi data delete NAHI hota</b> — purane products, orders aur hisaab mehfooz rahenge.
              Sirf andar nazar ane wale hisse badlenge (jo dukaan off hogi us ki tabs/screens chhup jayengi, data nahi).
              Nayi qisam ka demo catalogue sirf tab seed hota hai jab product list bilkul khali ho.
            </p>
          </div>
        )}

        <h1 className="text-2xl sm:text-3xl font-black mb-1">Aap ka business kya hai?</h1>
        <p className="text-stone-500 font-bold text-sm mb-4">Jo chuneinge, system ka andar ka view usi hisaab se ban jayega. Naam, prices aur products baad mein Dashboard se badal sakte hain.</p>

        <div className="text-xs font-black tracking-widest text-stone-400 mb-2">STEP 1 — BUSINESS CHUNEIN</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <button onClick={() => choose("canteen")} data-testid="setup-card-canteen" aria-pressed={canteen === true && !needsRetail}
            className={cardCls(canteen === true && !needsRetail)} style={cardStyle(canteen === true && !needsRetail)}>
            <div className="text-5xl mb-2">🍔</div>
            <div className="text-xl font-black">Sirf Canteen</div>
            <div className="text-sm font-bold text-stone-500 mt-1">Khana peena — counter billing, Kitchen tokens, table QR, Deals aur Menu Board.</div>
          </button>
          <button onClick={() => choose("retail")} data-testid="setup-card-retail" aria-pressed={canteen === false && needsRetail}
            className={cardCls(canteen === false && needsRetail)} style={cardStyle(canteen === false && needsRetail)}>
            <div className="text-5xl mb-2">🛒</div>
            <div className="text-xl font-black">Sirf Dukaan</div>
            <div className="text-sm font-bold text-stone-500 mt-1">Retail shop — barcode billing, stock, labels, offers aur Products Board.</div>
          </button>
          <button onClick={() => choose("both")} data-testid="setup-card-both" aria-pressed={canteen === true && needsRetail}
            className={cardCls(canteen === true && needsRetail)} style={cardStyle(canteen === true && needsRetail)}>
            <div className="text-5xl mb-2">🏪</div>
            <div className="text-xl font-black">Dono</div>
            <div className="text-sm font-bold text-stone-500 mt-1">Canteen + Dukaan — poora system, dono ke alag tabs aur alag screens.</div>
          </button>
        </div>

        {needsRetail && (
          <div className="pop-in">
            <div className="text-xs font-black tracking-widest text-stone-400 mb-2">STEP 2 — DUKAAN KIS QISAM KI HAI?</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 mb-6" data-testid="setup-type-grid">
              {RETAIL_TEMPLATES.map((t) => {
                const sel = retail === t.key;
                return (
                  <button key={t.key} onClick={() => setRetail(t.key)} data-testid={`setup-type-${t.key}`} aria-pressed={sel}
                    className="tile-3d rounded-2xl p-3.5 text-left shadow-sm border-[3px] transition bg-white"
                    style={sel ? { borderColor: "#F97316", background: "#FFF7ED" } : { borderColor: "#E7E5E4" }}>
                    <div className="text-3xl mb-1">{t.emoji}</div>
                    <div className="font-black leading-tight text-[15px]">{t.label}</div>
                    {sel && <div className="text-[11px] font-black mt-0.5" style={{ color: "#16A34A" }}>✓ Selected</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={confirm} disabled={!canConfirm || saving} data-testid="setup-confirm"
          className="w-full rounded-2xl py-4 text-xl font-black text-white disabled:opacity-40 active:scale-[0.99]" style={{ background: "#16A34A" }}>
          {saving ? "⏳ Save ho raha hai…" : changeMode ? "✓ Tabdeeli Save Karein" : "✓ Setup Mukammal — Shuru Karein"}
        </button>
        {saveErr && (
          <p className="text-center text-sm font-bold mt-2" style={{ color: "#DC2626" }} data-testid="setup-error">{saveErr}</p>
        )}
        {!canConfirm && (
          <p className="text-center text-sm font-bold mt-2" style={{ color: "#DC2626" }}>
            ⚠️ {canteen === null ? "Pehle Step 1 mein apna business chunein" : "Step 2 mein dukaan ki qisam chunein"}
          </p>
        )}
        <p className="text-center text-xs font-bold text-stone-400 mt-3">
          Demo products har template ke sath ate hain taake system foran chal kar dikhe — asal list Dashboard se apni daalein.
        </p>
      </main>
    </div>
  );
}
