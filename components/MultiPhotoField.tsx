"use client";

// ─────────────────────────────────────────────────────────────────────────────
// 🖼️ MULTI-PHOTO FIELD — owner forms ka photos wala hissa (rental item
// form wala hi pattern, ab Canteen Menu + Grocery Product forms par bhi):
// har photo ke liye ek URL khana + thumbnail, ✕ se hatayein, "➕ Photo
// URL Add Karein" aur "📷 Photo Upload Karein" (upload khud chhoti —
// max 1024px JPEG — ho kar data-URL ban jati hai). Max 16 photos; pehli
// photo MAIN photo hai. Label hamesha khane ke UPAR (outside label rule).
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ITEM_PHOTOS = 16;

/** Form state ki photos ko saaf karke save ke liye tayyar list: khali
 *  entries bahar, max 16. */
export function cleanPhotoList(list: string[]): string[] {
  return list.map((u) => u.trim()).filter(Boolean).slice(0, MAX_ITEM_PHOTOS);
}

export default function MultiPhotoField({ photos, onChange, label, testidPrefix, hint }: {
  photos: string[];
  onChange: (next: string[]) => void;
  label: string;
  testidPrefix: string; // e.g. "menu-photo" → testids menu-photo-0, menu-photo-add, menu-photo-upload
  hint?: string;
}) {
  return (
    <div className="w-full">
      <span className="block text-xs font-extrabold text-stone-500">{label}</span>
      <div className="mt-1 grid gap-2">
        {photos.map((u, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {u ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u} alt="" className="w-11 h-11 rounded-lg object-cover border shrink-0" />
            ) : (
              <span className="w-11 h-11 rounded-lg bg-stone-100 flex items-center justify-center text-lg shrink-0">🖼️</span>
            )}
            <input value={u} onChange={(e) => onChange(photos.map((x, j) => (j === idx ? e.target.value : x)))}
              data-testid={`${testidPrefix}-${idx}`} placeholder="Photo ka URL / path (e.g. /images/...)"
              className="w-full rounded-xl border-2 border-stone-200 px-3 py-2.5 outline-none focus:border-orange-500" />
            <button type="button" onClick={() => onChange(photos.filter((_, j) => j !== idx))}
              className="shrink-0 rounded-xl bg-red-50 px-3 py-2 font-black" style={{ color: "#DC2626" }}>✕</button>
          </div>
        ))}
        {photos.length < MAX_ITEM_PHOTOS && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onChange([...photos, ""])} data-testid={`${testidPrefix}-add`}
              className="rounded-xl bg-white border-2 border-dashed border-stone-300 px-4 py-2 text-sm font-black text-stone-500">
              ➕ Photo URL Add Karein
            </button>
            <label className="rounded-xl bg-white border-2 border-dashed border-stone-300 px-4 py-2 text-sm font-black text-stone-500 cursor-pointer">
              📷 Photo Upload Karein
              <input type="file" accept="image/*" className="hidden" data-testid={`${testidPrefix}-upload`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const img = new Image();
                  img.onload = () => {
                    const max = 1024;
                    const sc = Math.min(1, max / Math.max(img.width, img.height));
                    const cv = document.createElement("canvas");
                    cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
                    cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
                    URL.revokeObjectURL(img.src);
                    onChange([...photos, cv.toDataURL("image/jpeg", 0.85)].slice(0, MAX_ITEM_PHOTOS));
                  };
                  img.src = URL.createObjectURL(f);
                }} />
            </label>
          </div>
        )}
        <p className="text-xs font-bold text-stone-400">
          {hint ?? "Pehli photo MAIN photo hai (lists/POS mein wohi dikhti hai). 2 ya zyada photos hon to Board par cheez ghumti hui (angles badal badal kar) nazar ati hai — 8 ya zyada photos hon to bilkul 360° ghumti hui lagti hai. Photo recipe: cheez ko ek jagah rakhein, barabar roshni rakhein, phone ko ek hi doori par rakh kar aahista aahista gol ghoom kar 12–16 tasveerein lein."}
        </p>
      </div>
    </div>
  );
}
