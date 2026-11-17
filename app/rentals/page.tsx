"use client";

import { useEffect, useMemo, useState } from "react";
import StaffGate from "@/components/StaffGate";
import TopBar from "@/components/TopBar";
import { RentalsOnly } from "@/components/BusinessGate";
import RentalSlip from "@/components/RentalSlip";
import {
  RENTAL_CATEGORIES, RENTAL_STATUS_META, RentalBooking, RentalItem, RentalItemStatus, ReturnCondition,
  SECURITY_KINDS, SecurityKind, bookingRentBalance, effectiveRentPerDay, isBookingOverdue, loadRentalBookings,
  loadRentalItems, nextBookingNo, rentalAvailableQty, rentalCategoryEmoji, rentalDaysBetween, rentalIncomeOn,
  rentalOfferActive, rentalPhotos, saveRentalBookings, saveRentalItems, useShop, useStaffSession,
} from "@/lib/store";

// ─────────────────────────────────────────────────────────────────────────────
// 👰 KIRAYA / RENTALS — dress rent par dena: booking → pickup → wapsi.
// Har dress EK unique piece hai (RentalItem) jis ki apni status hai:
// available → booked → out → (wapsi) → available / cleaning.
// Paisa: advance (booking par) + baqaya (pickup par) + settlement (wapsi
// par late fine / damage, security deposit se katoti). Deposit amanat
// hai — aamdani sirf wasool shuda kiraya + fine + damage (cash-basis,
// rentalMoneyEvents) jo Owner Overview aur Munafa Nuqsan mein jata hai.
// ─────────────────────────────────────────────────────────────────────────────

const money = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dlabel = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};
const num = (s: string) => {
  const n = parseFloat(s);
  return isNaN(n) || n < 0 ? 0 : n;
};

const inputCls = "mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 text-base font-bold outline-none focus:border-[#F97316] bg-white";
const labelCls = "block text-xs font-extrabold text-stone-500";

type Filter = "all" | "due" | "late" | "upcoming";

export default function RentalsPage() {
  return (
    <StaffGate tab="rentals">
      <RentalsOnly>
        <RentalsInner />
      </RentalsOnly>
    </StaffGate>
  );
}

function RentalsInner() {
  const shop = useShop();
  const member = useStaffSession();
  const [items, setItems] = useState<RentalItem[]>(() => loadRentalItems());
  const [bookings, setBookings] = useState<RentalBooking[]>(() => loadRentalBookings());
  const [view, setView] = useState<"bookings" | "dresses">("bookings");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  // Booking form
  const [formOpen, setFormOpen] = useState(false);
  const [fItem, setFItem] = useState("");
  const [fName, setFName] = useState("");
  const [fMobile, setFMobile] = useState("");
  const [fCnic, setFCnic] = useState("");
  const [fPickup, setFPickup] = useState(todayStr());
  const [fReturn, setFReturn] = useState(addDays(todayStr(), 2));
  const [fRent, setFRent] = useState(""); // kul kiraya (auto, editable)
  const [rentEdited, setRentEdited] = useState(false);
  const [fSecurity, setFSecurity] = useState("");
  const [fKind, setFKind] = useState<SecurityKind>("Cash");
  const [fAdvance, setFAdvance] = useState("");
  const [fQty, setFQty] = useState("1"); // kitne piece (lights waghera par zyada)
  const [formErr, setFormErr] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all"); // dresses view: category chips

  // Pickup / Return / Slip panels
  const [pickupFor, setPickupFor] = useState<RentalBooking | null>(null);
  const [pickupAmt, setPickupAmt] = useState("");
  const [returnFor, setReturnFor] = useState<RentalBooking | null>(null);
  const [rDate, setRDate] = useState(todayStr());
  const [rFine, setRFine] = useState("");
  const [fineEdited, setFineEdited] = useState(false);
  const [rCond, setRCond] = useState<ReturnCondition>("theek");
  const [rDamage, setRDamage] = useState("");
  const [rDamageNote, setRDamageNote] = useState("");
  const [slipFor, setSlipFor] = useState<RentalBooking | null>(null);

  // Item form (sirf owner)
  const [itemEdit, setItemEdit] = useState<RentalItem | null>(null);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [iName, setIName] = useState("");
  const [iSize, setISize] = useState("");
  const [iColor, setIColor] = useState("");
  const [iRent, setIRent] = useState("");
  const [iDeposit, setIDeposit] = useState("");
  const [iEmoji, setIEmoji] = useState("👗");
  const [iStatus, setIStatus] = useState<RentalItemStatus>("available");
  const [iOffer, setIOffer] = useState("");
  const [iBoardOffer, setIBoardOffer] = useState(false);
  const [iCategory, setICategory] = useState<string>("Baraat");
  const [iCategoryCustom, setICategoryCustom] = useState("");
  const [iTotalQty, setITotalQty] = useState("1");
  const [iPhotos, setIPhotos] = useState<string[]>([]);

  useEffect(() => {
    const read = () => { setItems(loadRentalItems()); setBookings(loadRentalBookings()); };
    read();
    window.addEventListener("rentals-changed", read);
    return () => window.removeEventListener("rentals-changed", read);
  }, []);

  const today = todayStr();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // Bookable = halat available/cleaning/inactive na ho AUR piece bacha ho
  // (qty wale samaan par availability bookings se gintee hai).
  const availableItems = useMemo(
    () => items.filter((i) => i.status !== "cleaning" && i.status !== "inactive" && rentalAvailableQty(i, bookings) > 0),
    [items, bookings],
  );
  const presentCategories = useMemo(() => {
    const have = new Set(items.map((i) => i.category).filter(Boolean) as string[]);
    const ordered = RENTAL_CATEGORIES.filter((c) => have.has(c));
    for (const c of have) if (!ordered.includes(c as never)) ordered.push(c as never);
    return ordered as string[];
  }, [items]);

  const stats = useMemo(() => ({
    incomeToday: rentalIncomeOn(bookings, today),
    out: bookings.filter((b) => b.status === "out").length,
    due: bookings.filter((b) => b.status === "out" && b.returnDate === today).length,
    late: bookings.filter((b) => isBookingOverdue(b, today)).length,
  }), [bookings, today]);

  const shownBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = bookings.filter((b) => {
      if (filter === "due") return b.status === "out" && b.returnDate === today;
      if (filter === "late") return isBookingOverdue(b, today);
      if (filter === "upcoming") return b.status === "booked" && b.pickupDate >= today;
      return true;
    });
    if (q) list = list.filter((b) => b.customerName.toLowerCase().includes(q) || b.customerMobile.includes(q)
      || b.itemName.toLowerCase().includes(q) || b.bookingNo.toLowerCase().includes(q));
    const rank = (b: RentalBooking) => isBookingOverdue(b, today) ? 0 : b.status === "out" ? 1 : b.status === "booked" ? 2 : b.status === "completed" ? 3 : 4;
    return [...list].sort((a, b) => rank(a) - rank(b) || (a.pickupDate < b.pickupDate ? -1 : 1));
  }, [bookings, filter, search, today]);

  const shownItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (catFilter !== "all") list = list.filter((i) => (i.category ?? "") === catFilter);
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.color ?? "").toLowerCase().includes(q) || (i.size ?? "").toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q));
    return list;
  }, [items, search, catFilter]);

  /** Item ki halat bookings se dobara gin kar set karo (qty wale samaan par
   *  bhi yehi chalta hai: sab piece book ho jayein to "booked", warna
   *  available). Cleaning/inactive owner ki marzi hai — haath nahi lagate,
   *  siwaye return par dry-clean wali halat ke (wo doReturn khud lagata hai). */
  function syncStatuses(allItems: RentalItem[], allBookings: RentalBooking[]): RentalItem[] {
    return allItems.map((it) => {
      if (it.status === "cleaning" || it.status === "inactive") return it;
      const active = allBookings.filter((b) => b.itemId === it.id && (b.status === "booked" || b.status === "out"));
      let status: RentalItemStatus = "available";
      if (active.length) {
        if ((it.totalQty || 1) > 1) status = rentalAvailableQty(it, allBookings) <= 0 ? "booked" : "available";
        else status = active.some((b) => b.status === "out") ? "out" : "booked";
      }
      return status === it.status ? it : { ...it, status };
    });
  }

  // ── Booking form helpers ──────────────────────────────────────────────
  const selItem = items.find((i) => i.id === fItem);
  const fDays = Math.max(0, rentalDaysBetween(fPickup, fReturn));
  const fQtyN = Math.max(1, Math.floor(num(fQty)) || 1);
  const selAvail = selItem ? rentalAvailableQty(selItem, bookings) : 0;
  useEffect(() => {
    if (!rentEdited && selItem) setFRent(String(effectiveRentPerDay(selItem) * Math.max(1, fDays) * fQtyN));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fItem, fPickup, fReturn, rentEdited, fQty]);
  function openBooking(itemId?: string) {
    setFItem(itemId ?? availableItems[0]?.id ?? "");
    const it = items.find((i) => i.id === (itemId ?? availableItems[0]?.id));
    setFName(""); setFMobile(""); setFCnic("");
    setFPickup(todayStr()); setFReturn(addDays(todayStr(), 2));
    setRentEdited(false); setFQty("1");
    setFRent(it ? String(effectiveRentPerDay(it) * 2) : "");
    setFSecurity(it ? String(it.securityDeposit) : "");
    setFKind("Cash"); setFAdvance(""); setFormErr("");
    setFormOpen(true);
  }
  function saveBooking() {
    const it = items.find((i) => i.id === fItem);
    if (!it) { setFormErr("Pehle dress/item chunein."); return; }
    if (it.status === "cleaning" || it.status === "inactive") { setFormErr("Ye item abhi rent ke liye band hai — pehle koi aur item chunein."); return; }
    const avail = rentalAvailableQty(it, bookings);
    if (avail <= 0) { setFormErr("Is item ke saare piece book ho chuke hain — pehle koi aur item chunein."); return; }
    if (fQtyN > avail) { setFormErr(`Sirf ${avail} piece available hain — qty ${fQtyN} book nahi ho sakti.`); return; }
    if (!fName.trim()) { setFormErr("Customer ka naam lazmi hai."); return; }
    if (!fMobile.trim()) { setFormErr("Customer ka mobile number lazmi hai — baghair mobile booking nahi banti."); return; }
    if (fDays < 1) { setFormErr("Wapsi ki tareekh lene ki tareekh ke baad ki honi chahiye (kam az kam 1 din)."); return; }
    const rentTotal = num(fRent);
    const advance = num(fAdvance);
    if (advance > rentTotal) { setFormErr("Advance kul kiraye se zyada nahi ho sakta."); return; }
    const offerOn = rentalOfferActive(it);
    const b: RentalBooking = {
      id: `rb-${Date.now()}`,
      bookingNo: nextBookingNo(bookings),
      itemId: it.id, itemName: it.name, qty: fQtyN,
      customerName: fName.trim(), customerMobile: fMobile.trim(),
      customerCnic: fCnic.trim() || undefined,
      pickupDate: fPickup, returnDate: fReturn, days: fDays,
      rentPerDay: effectiveRentPerDay(it), // CHARGE hua kiraya (offer ho to offer wala)
      listRentPerDay: offerOn ? it.rentPerDay : undefined, // asal kiraya — slip par imandari
      rentTotal,
      securityDeposit: num(fSecurity), securityKind: fKind,
      advancePaid: advance, balancePaid: 0,
      status: "booked",
      lateFinePerDay: shop.rentalLateFinePerDay || 500,
      createdAt: new Date().toISOString(),
      by: member?.name,
    };
    const nb = [b, ...bookings];
    saveRentalBookings(nb); setBookings(nb);
    const ni = syncStatuses(items, nb);
    saveRentalItems(ni); setItems(ni);
    setFormOpen(false);
    setSlipFor(b);
  }

  // ── Pickup ────────────────────────────────────────────────────────────
  function doPickup() {
    if (!pickupFor) return;
    const amt = num(pickupAmt);
    const nb = bookings.map((b) => b.id === pickupFor.id
      ? { ...b, status: "out" as const, balancePaid: b.balancePaid + amt, pickedUpAt: new Date().toISOString() }
      : b);
    saveRentalBookings(nb); setBookings(nb);
    const ni = syncStatuses(items, nb);
    saveRentalItems(ni); setItems(ni);
    setPickupFor(null);
  }

  // ── Return / settlement ───────────────────────────────────────────────
  const rLateDays = returnFor ? Math.max(0, rentalDaysBetween(returnFor.returnDate, rDate)) : 0;
  useEffect(() => {
    if (returnFor && !fineEdited) setRFine(String(rLateDays * returnFor.lateFinePerDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rDate, returnFor, fineEdited]);
  const rDeducted = num(rFine) + (rCond === "damage" ? num(rDamage) : 0);
  const rRefund = returnFor ? Math.max(0, returnFor.securityDeposit - rDeducted) : 0;
  const rExtra = returnFor ? Math.max(0, rDeducted - returnFor.securityDeposit) : 0;
  function doReturn() {
    if (!returnFor) return;
    const fine = num(rFine);
    const damage = rCond === "damage" ? num(rDamage) : 0;
    const deducted = fine + damage;
    const done: RentalBooking = {
      ...returnFor,
      status: "completed",
      returnedAt: new Date().toISOString(),
      actualReturnDate: rDate,
      lateDays: rLateDays,
      lateFine: fine,
      damageCharges: damage,
      damageNote: rCond === "damage" ? (rDamageNote.trim() || undefined) : undefined,
      returnCondition: rCond,
      securityDeducted: deducted,
      securityRefunded: Math.max(0, returnFor.securityDeposit - deducted),
      extraDue: Math.max(0, deducted - returnFor.securityDeposit),
    };
    const nb = bookings.map((b) => (b.id === done.id ? done : b));
    saveRentalBookings(nb); setBookings(nb);
    // Dry-clean sirf UNIQUE piece (totalQty 1) par item ko cleaning mein
    // bhejta hai; qty wale samaan ke baqi piece chalte rehte hain.
    const doneItem = items.find((i) => i.id === done.itemId);
    const toCleaning = rCond === "cleaning" && (doneItem?.totalQty ?? 1) <= 1;
    const withCond = toCleaning
      ? items.map((i) => (i.id === done.itemId ? { ...i, status: "cleaning" as RentalItemStatus } : i))
      : items;
    const ni = syncStatuses(withCond, nb);
    saveRentalItems(ni); setItems(ni);
    setReturnFor(null);
    setSlipFor(done);
  }

  function cancelBooking(b: RentalBooking) {
    if (!window.confirm(`Booking ${b.bookingNo} cancel kar dein? Item ke ${b.qty || 1} piece wapas Available ho jayenge.`)) return;
    const nb = bookings.map((x) => (x.id === b.id ? { ...x, status: "cancelled" as const } : x));
    saveRentalBookings(nb); setBookings(nb);
    const ni = syncStatuses(items, nb);
    saveRentalItems(ni); setItems(ni);
  }

  // ── Item form (owner) ─────────────────────────────────────────────────
  function openItemForm(it?: RentalItem) {
    setItemEdit(it ?? null);
    setIName(it?.name ?? ""); setISize(it?.size ?? ""); setIColor(it?.color ?? "");
    setICategory(it?.category && (RENTAL_CATEGORIES as readonly string[]).includes(it.category) ? it.category : it?.category ? "__custom" : "Baraat");
    setICategoryCustom(it?.category && !(RENTAL_CATEGORIES as readonly string[]).includes(it.category) ? it.category : "");
    setITotalQty(it ? String(it.totalQty || 1) : "1");
    setIRent(it ? String(it.rentPerDay) : ""); setIDeposit(it ? String(it.securityDeposit) : "");
    setIEmoji(it?.emoji ?? "👗"); setIStatus(it?.status ?? "available");
    setIOffer(it?.offerRentPerDay ? String(it.offerRentPerDay) : "");
    setIBoardOffer(it?.boardOffer === true);
    setIPhotos(it ? rentalPhotos(it) : []);
    setItemFormOpen(true);
  }
  function saveItem() {
    if (!iName.trim()) return;
    const photos = iPhotos.map((u) => u.trim()).filter(Boolean).slice(0, 16);
    const offer = num(iOffer);
    const base: RentalItem = {
      id: itemEdit?.id ?? `rent-${Date.now()}`,
      name: iName.trim(),
      category: (iCategory === "__custom" ? iCategoryCustom.trim() : iCategory) || undefined,
      totalQty: Math.max(1, Math.floor(num(iTotalQty)) || 1),
      size: iSize.trim() || undefined,
      color: iColor.trim() || undefined,
      rentPerDay: num(iRent),
      securityDeposit: num(iDeposit),
      emoji: iEmoji.trim() || "👗",
      image: photos[0] ?? undefined,
      images: photos.length ? photos : undefined,
      offerRentPerDay: offer > 0 ? offer : undefined,
      boardOffer: iBoardOffer ? true : undefined,
      status: itemEdit && (itemEdit.status === "booked" || itemEdit.status === "out") ? itemEdit.status : iStatus,
    };
    const ni = itemEdit ? items.map((i) => (i.id === base.id ? base : i)) : [...items, base];
    saveRentalItems(ni); setItems(ni);
    setItemFormOpen(false);
  }
  function deleteItem(it: RentalItem) {
    if (bookings.some((b) => b.itemId === it.id && (b.status === "booked" || b.status === "out"))) {
      window.alert("Is dress par active booking hai — pehle woh mukammal/cancel karein.");
      return;
    }
    if (!window.confirm(`"${it.name}" delete kar dein?`)) return;
    const ni = items.filter((i) => i.id !== it.id);
    saveRentalItems(ni); setItems(ni);
  }

  const filterBtn = (key: Filter, label: string, testid: string) => (
    <button key={key} onClick={() => setFilter(key)} data-testid={testid}
      className="rounded-full px-4 py-2 text-sm font-black transition"
      style={filter === key ? { background: "#0F172A", color: "#fff" } : { background: "#fff", color: "#44403C", border: "2px solid #E7E5E4" }}>
      {label}
    </button>
  );

  return (
    <div data-testid="rentals-page">
      <TopBar />
      <div className="mx-auto max-w-[1400px] px-4 py-4">
      {/* ── Stats strip ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-2xl p-4 text-white shadow" style={{ background: "#16A34A" }}>
          <div className="text-xs font-black opacity-80">💰 AAJ KI KIRAYA AAMDANI</div>
          <div className="text-2xl font-black mt-1" data-testid="rental-income-today">{money(stats.incomeToday)}</div>
          <div className="text-[11px] opacity-80 font-bold">wasool shuda kiraya + fine + damage</div>
        </div>
        <div className="rounded-2xl p-4 text-white shadow" style={{ background: "#1D4ED8" }}>
          <div className="text-xs font-black opacity-80">👰 BAHAR GAYI DRESSES</div>
          <div className="text-2xl font-black mt-1">{stats.out}</div>
          <div className="text-[11px] opacity-80 font-bold">customers ke paas hain</div>
        </div>
        <div className="rounded-2xl p-4 text-white shadow" style={{ background: "#F59E0B" }}>
          <div className="text-xs font-black opacity-80">📅 AAJ WAPSI WALE</div>
          <div className="text-2xl font-black mt-1">{stats.due}</div>
          <div className="text-[11px] opacity-80 font-bold">aaj jin ki wapsi ki tareekh hai</div>
        </div>
        <div className="rounded-2xl p-4 text-white shadow" style={{ background: stats.late > 0 ? "#DC2626" : "#78716C" }}>
          <div className="text-xs font-black opacity-80">🔴 LATE (WAQT GUZAR GAYA)</div>
          <div className="text-2xl font-black mt-1">{stats.late}</div>
          <div className="text-[11px] opacity-80 font-bold">abhi tak wapas nahi ayi</div>
        </div>
      </div>

      {/* ── View switch + search + new booking ──────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setView("bookings")} data-testid="view-bookings"
          className="rounded-xl px-4 py-2.5 font-black text-sm shadow"
          style={view === "bookings" ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>
          📋 Bookings ({bookings.filter((b) => b.status === "booked" || b.status === "out").length} active)
        </button>
        <button onClick={() => setView("dresses")} data-testid="view-dresses"
          className="rounded-xl px-4 py-2.5 font-black text-sm shadow"
          style={view === "dresses" ? { background: "#F97316", color: "#fff" } : { background: "#fff", color: "#44403C" }}>
          👗 Dresses ({items.length})
        </button>
        <input value={search} onChange={(e) => setSearch(e.target.value)} data-testid="rentals-search"
          placeholder="🔎 Naam, mobile, dress ya booking no se dhoondein…"
          className="flex-1 min-w-[220px] rounded-xl border-2 border-stone-200 bg-white px-4 py-2.5 font-bold outline-none focus:border-[#F97316]" />
        {view === "bookings" && (
          <button onClick={() => openBooking()} data-testid="new-booking-btn"
            className="rounded-xl px-5 py-2.5 font-black text-white shadow" style={{ background: "#0F172A" }}>
            ➕ Nayi Booking
          </button>
        )}
        {view === "dresses" && member?.isOwner && (
          <button onClick={() => openItemForm()} data-testid="new-item-btn"
            className="rounded-xl px-5 py-2.5 font-black text-white shadow" style={{ background: "#0F172A" }}>
            ➕ Nayi Dress
          </button>
        )}
      </div>

      {view === "bookings" && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {filterBtn("all", "📋 Sab Bookings", "filter-all")}
            {filterBtn("due", "📅 Aaj Wapsi Wale", "filter-due")}
            {filterBtn("late", `🔴 Late (${stats.late})`, "filter-late")}
            {filterBtn("upcoming", "🗓️ Aane Wali Bookings", "filter-upcoming")}
          </div>
          {shownBookings.length === 0 && (
            <div className="rounded-2xl bg-white p-8 text-center shadow">
              <div className="text-4xl mb-2">👰</div>
              <div className="font-black text-stone-600">Is list mein koi booking nahi hai</div>
              <div className="text-sm text-stone-400 font-bold">➕ Nayi Booking se pehli booking banayein</div>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {shownBookings.map((b) => {
              const overdue = isBookingOverdue(b, today);
              const bal = bookingRentBalance(b);
              return (
                <div key={b.id} data-testid={`booking-card-${b.bookingNo}`}
                  className="rounded-2xl bg-white p-4 shadow"
                  style={overdue ? { border: "3px solid #DC2626", background: "#FEF2F2" } : { border: "3px solid transparent" }}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-black text-lg leading-snug">{b.itemName}{(b.qty || 1) > 1 ? <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-black text-white align-middle" style={{ background: "#7E22CE" }}>× {b.qty} piece</span> : null}</div>
                      <div className="text-xs font-bold text-stone-400">{b.bookingNo} · Roz ka kiraya {money(b.rentPerDay)}</div>
                    </div>
                    {overdue ? (
                      <span className="rounded-full px-3 py-1 text-xs font-black text-white" style={{ background: "#DC2626" }} data-testid={`overdue-chip-${b.bookingNo}`}>
                        🔴 LATE — {rentalDaysBetween(b.returnDate, today)} din guzar gaye
                      </span>
                    ) : (
                      <span className="rounded-full px-3 py-1 text-xs font-black"
                        style={b.status === "booked" ? { background: "#FEF3C7", color: "#92400E" }
                          : b.status === "out" ? { background: "#DBEAFE", color: "#1D4ED8" }
                          : b.status === "completed" ? { background: "#DCFCE7", color: "#166534" }
                          : { background: "#E7E5E4", color: "#57534E" }}>
                        {b.status === "booked" ? "📅 BOOKED" : b.status === "out" ? "👰 BAHAR HAI" : b.status === "completed" ? "✓ MUKAMMAL" : "✕ CANCELLED"}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-bold text-stone-600">
                    <div>👤 {b.customerName}</div>
                    <div>📱 {b.customerMobile}</div>
                    <div>📅 Lena: {dlabel(b.pickupDate)}</div>
                    <div>↩️ Wapsi: {dlabel(b.returnDate)} ({b.days} din)</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="font-bold text-stone-500">Kiraya: <b className="text-stone-800">{money(b.rentTotal)}</b></span>
                    <span className="font-bold text-stone-500">Advance: <b style={{ color: "#16A34A" }}>{money(b.advancePaid)}</b></span>
                    {b.balancePaid > 0 && <span className="font-bold text-stone-500">Pickup par: <b style={{ color: "#16A34A" }}>{money(b.balancePaid)}</b></span>}
                    {bal > 0 && b.status !== "completed" && b.status !== "cancelled" && (
                      <span className="font-black" style={{ color: "#DC2626" }}>Baqaya: {money(bal)}</span>
                    )}
                    <span className="font-bold text-stone-500">Security ({b.securityKind}): <b className="text-stone-800">{money(b.securityDeposit)}</b></span>
                  </div>
                  {b.status === "completed" && (
                    <div className="mt-2 rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-sm font-bold text-green-800">
                      Wapsi {dlabel(b.actualReturnDate)} ko hui
                      {(b.lateDays ?? 0) > 0 ? ` · Late fine ${money(b.lateFine ?? 0)} (${b.lateDays} din)` : ""}
                      {(b.damageCharges ?? 0) > 0 ? ` · Damage ${money(b.damageCharges ?? 0)}` : ""}
                      {" "}· Security wapas: {money(b.securityRefunded ?? 0)}
                      {(b.extraDue ?? 0) > 0 ? ` · Mazeed wasool: ${money(b.extraDue ?? 0)}` : ""}
                    </div>
                  )}
                  {(b.status === "booked" || b.status === "out" || b.status === "completed") && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {b.status === "booked" && (
                        <>
                          <button onClick={() => { setPickupFor(b); setPickupAmt(String(bookingRentBalance(b))); }} data-testid={`pickup-btn-${b.bookingNo}`}
                            className="rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: "#1D4ED8" }}>
                            📦 Pickup — Issue Karein
                          </button>
                          <button onClick={() => cancelBooking(b)} data-testid={`cancel-btn-${b.bookingNo}`}
                            className="rounded-xl px-4 py-2 text-sm font-black bg-stone-100 text-stone-500">
                            ✕ Cancel
                          </button>
                        </>
                      )}
                      {b.status === "out" && (
                        <button onClick={() => { setReturnFor(b); setRDate(todayStr()); setFineEdited(false); setRCond("theek"); setRDamage(""); setRDamageNote(""); }} data-testid={`return-btn-${b.bookingNo}`}
                          className="rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: "#16A34A" }}>
                          ↩️ Wapsi / Return
                        </button>
                      )}
                      <button onClick={() => setSlipFor(b)} data-testid={`slip-btn-${b.bookingNo}`}
                        className="rounded-xl px-4 py-2 text-sm font-black bg-stone-800 text-white">
                        🖨️ Slip Print
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "dresses" && (
        <>
          {/* Category (function) chips — shadi ke function ke hisaab se filter */}
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => setCatFilter("all")} data-testid="cat-all"
              className="rounded-full px-4 py-2 text-sm font-black transition"
              style={catFilter === "all" ? { background: "#7E22CE", color: "#fff" } : { background: "#fff", color: "#44403C", border: "2px solid #E7E5E4" }}>
              👗 Sab
            </button>
            {presentCategories.map((c) => (
              <button key={c} onClick={() => setCatFilter(c)} data-testid={`cat-${c}`}
                className="rounded-full px-4 py-2 text-sm font-black transition"
                style={catFilter === c ? { background: "#7E22CE", color: "#fff" } : { background: "#fff", color: "#44403C", border: "2px solid #E7E5E4" }}>
                {rentalCategoryEmoji(c)} {c}
              </button>
            ))}
          </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shownItems.map((it) => {
            const meta = RENTAL_STATUS_META[it.status];
            const offerOn = rentalOfferActive(it);
            const photo = rentalPhotos(it)[0];
            const avail = rentalAvailableQty(it, bookings);
            return (
              <div key={it.id} data-testid={`item-card-${it.id}`} className="rounded-2xl bg-white p-4 shadow flex flex-col">
                {photo
                  ? <img src={photo} alt={it.name} className="h-36 w-full object-cover rounded-xl" />
                  : <div className="h-36 rounded-xl flex items-center justify-center text-7xl" style={{ background: "#FFF7ED" }}>{it.emoji}</div>}
                <div className="mt-3 font-black leading-snug">{it.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {it.category && (
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black text-white" style={{ background: "#7E22CE" }}>
                      {rentalCategoryEmoji(it.category)} {it.category}
                    </span>
                  )}
                  <span className="text-xs font-bold text-stone-400">
                    {[it.size ? `Size: ${it.size}` : "", it.color ? `Rang: ${it.color}` : ""].filter(Boolean).join(" · ") || "—"}
                  </span>
                </div>
                {(it.totalQty || 1) > 1 && (
                  <div className="mt-1.5 text-sm font-black" data-testid={`item-avail-${it.id}`}
                    style={{ color: avail > 0 ? "#16A34A" : "#DC2626" }}>
                    📦 Available {avail} / {it.totalQty} piece
                  </div>
                )}
                {offerOn ? (
                  <div className="mt-2">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-black text-white" style={{ background: "#DC2626" }}>🎉 OFFER {money(it.offerRentPerDay as number)}</span>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-lg font-black" style={{ color: "#DC2626" }}>{money(it.offerRentPerDay as number)}<span className="text-xs text-stone-400"> / din</span></span>
                      <s className="text-sm font-bold text-stone-400">{money(it.rentPerDay)}</s>
                      <span className="text-xs font-bold text-stone-500">Security {money(it.securityDeposit)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex items-baseline gap-3">
                    <span className="text-lg font-black" style={{ color: "#F97316" }}>{money(it.rentPerDay)}<span className="text-xs text-stone-400"> / din</span></span>
                    <span className="text-xs font-bold text-stone-500">Security {money(it.securityDeposit)}</span>
                  </div>
                )}
                <span className="mt-2 self-start rounded-full px-3 py-1 text-xs font-black" style={{ background: meta.bg, color: meta.fg }}>
                  {meta.label}
                </span>
                <div className="mt-3 flex flex-wrap gap-2 mt-auto pt-3">
                  {avail > 0 && it.status !== "cleaning" && it.status !== "inactive" && (
                    <button onClick={() => { setView("bookings"); openBooking(it.id); }} data-testid={`book-item-${it.id}`}
                      className="rounded-xl px-4 py-2 text-sm font-black text-white" style={{ background: "#0F172A" }}>
                      📅 Book Karein
                    </button>
                  )}
                  {member?.isOwner && (
                    <>
                      <button onClick={() => openItemForm(it)} data-testid={`edit-item-${it.id}`}
                        className="rounded-xl px-4 py-2 text-sm font-black bg-stone-100 text-stone-600">✏️ Edit</button>
                      <button onClick={() => deleteItem(it)} data-testid={`delete-item-${it.id}`}
                        className="rounded-xl px-4 py-2 text-sm font-black bg-red-50" style={{ color: "#DC2626" }}>🗑️</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {shownItems.length === 0 && (
            <div className="col-span-full rounded-2xl bg-white p-8 text-center shadow">
              <div className="text-4xl mb-2">👗</div>
              <div className="font-black text-stone-600">Koi dress nahi mili</div>
              {member?.isOwner && <div className="text-sm text-stone-400 font-bold">➕ Nayi Dress se pehli dress add karein</div>}
            </div>
          )}
        </div>
        </>
      )}

      {/* ── Booking form modal ──────────────────────────────────────── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" data-testid="booking-form">
          <div className="w-full max-w-[560px] rounded-3xl bg-[#FFF7ED] p-5 shadow-2xl my-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xl font-black">📅 Nayi Kiraya Booking</div>
              <button onClick={() => setFormOpen(false)} className="rounded-full bg-white px-3 py-1 font-black shadow">✕</button>
            </div>
            <div className="grid gap-3">
              <label className={labelCls}>DRESS / ITEM CHUNEIN (SIRF JIN KE PIECE BACHE HON)
                <select value={fItem} onChange={(e) => { setFItem(e.target.value); const it = items.find((i) => i.id === e.target.value); if (it) { setFSecurity(String(it.securityDeposit * Math.max(1, Math.floor(num(fQty)) || 1))); setRentEdited(false); } }}
                  data-testid="bk-item" className={inputCls}>
                  <option value="">— Dress / item chunein —</option>
                  {availableItems.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} — {rentalOfferActive(i) ? `🎉 OFFER ${money(i.offerRentPerDay as number)}/din (asal ${money(i.rentPerDay)})` : `${money(i.rentPerDay)}/din`}{(i.totalQty || 1) > 1 ? ` · ${rentalAvailableQty(i, bookings)} piece available` : ""}</option>
                  ))}
                </select>
              </label>
              {selItem && (selItem.totalQty || 1) > 1 && (
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelCls}>KITNE PIECE (QTY)
                    <input value={fQty} data-testid="bk-qty" inputMode="numeric" className={inputCls}
                      onChange={(e) => { setFQty(e.target.value); const q = Math.max(1, Math.floor(num(e.target.value)) || 1); setFSecurity(String(selItem.securityDeposit * q)); }} />
                  </label>
                  <div className="rounded-xl bg-white border-2 border-stone-200 px-3 py-2 text-sm font-bold text-stone-600 self-end">
                    Abhi available: <b className="text-stone-900" data-testid="bk-avail">{selAvail} / {selItem.totalQty} piece</b>
                    {fQtyN > selAvail && <div className="font-black" style={{ color: "#DC2626" }}>⚠️ Sirf {selAvail} piece hain — itne book nahi ho sakte.</div>}
                  </div>
                </div>
              )}
              {selItem && rentalOfferActive(selItem) && (
                <div className="rounded-xl px-3 py-2 text-sm font-black text-white" style={{ background: "#DC2626" }} data-testid="bk-offer-tag">
                  🎉 OFFER chal raha hai — roz ka kiraya {money(selItem.offerRentPerDay as number)} hai (asal <s>{money(selItem.rentPerDay)}</s>) — booking offer wale kiraye par hi bane gi.
                </div>
              )}
              {availableItems.length === 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-800">
                  Is waqt koi dress available nahi — sab booked/bahar/cleaning mein hain.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>CUSTOMER KA NAAM (LAZMI)
                  <input value={fName} onChange={(e) => setFName(e.target.value)} data-testid="bk-name" placeholder="e.g. Fatima Bibi" className={inputCls} />
                </label>
                <label className={labelCls}>MOBILE NUMBER (LAZMI)
                  <input value={fMobile} onChange={(e) => setFMobile(e.target.value)} data-testid="bk-mobile" placeholder="03XX-XXXXXXX" inputMode="tel" className={inputCls} />
                </label>
              </div>
              <label className={labelCls}>CNIC (IKHTIYARI)
                <input value={fCnic} onChange={(e) => setFCnic(e.target.value)} data-testid="bk-cnic" placeholder="e.g. 35202-XXXXXXX-X (na ho to khali)" className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>LENE KI TAREEKH
                  <input type="date" value={fPickup} onChange={(e) => setFPickup(e.target.value)} data-testid="bk-pickup" className={inputCls} />
                </label>
                <label className={labelCls}>WAPSI KI TAREEKH
                  <input type="date" value={fReturn} onChange={(e) => setFReturn(e.target.value)} data-testid="bk-return" className={inputCls} />
                </label>
              </div>
              <div className="rounded-xl bg-white border-2 border-stone-200 px-3 py-2 text-sm font-bold text-stone-600">
                Kul Din: <b className="text-stone-900">{fDays} din</b>
                {selItem ? <> · Roz ka Kiraya: <b className="text-stone-900">{money(effectiveRentPerDay(selItem))}</b>{rentalOfferActive(selItem) ? <> (🎉 offer — asal <s>{money(selItem.rentPerDay)}</s>)</> : null}{(selItem.totalQty || 1) > 1 ? <> · Piece: <b className="text-stone-900">{fQtyN}</b></> : null}</> : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>KUL KIRAYA RS (BADAL SAKTE HAIN)
                  <input value={fRent} onChange={(e) => { setFRent(e.target.value); setRentEdited(true); }} data-testid="bk-rent-total" inputMode="numeric" className={inputCls} />
                </label>
                <label className={labelCls}>ADVANCE WASOOL RS
                  <input value={fAdvance} onChange={(e) => setFAdvance(e.target.value)} data-testid="bk-advance" inputMode="numeric" placeholder="0" className={inputCls} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>SECURITY DEPOSIT RS
                  <input value={fSecurity} onChange={(e) => setFSecurity(e.target.value)} data-testid="bk-security" inputMode="numeric" className={inputCls} />
                </label>
                <label className={labelCls}>SECURITY KIS PAR RAKHI
                  <select value={fKind} onChange={(e) => setFKind(e.target.value as SecurityKind)} data-testid="bk-kind" className={inputCls}>
                    {SECURITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              </div>
              <div className="rounded-xl px-3 py-2 text-sm font-black" style={{ background: "#FEF2F2", color: "#DC2626" }}>
                Baqaya (Pickup par wasool hoga): {money(Math.max(0, num(fRent) - num(fAdvance)))}
              </div>
              {formErr && <div className="rounded-xl bg-red-100 border border-red-300 px-3 py-2 text-sm font-black" style={{ color: "#DC2626" }} data-testid="bk-error">{formErr}</div>}
              <button onClick={saveBooking} data-testid="bk-save"
                className="rounded-2xl py-3.5 text-lg font-black text-white shadow" style={{ background: "#F97316" }}>
                ✓ Booking Save Karein
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pickup modal ────────────────────────────────────────────── */}
      {pickupFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-testid="pickup-panel">
          <div className="w-full max-w-[440px] rounded-3xl bg-[#FFF7ED] p-5 shadow-2xl">
            <div className="text-xl font-black mb-1">📦 Pickup — Dress Issue Karein</div>
            <div className="text-sm font-bold text-stone-500 mb-3">{pickupFor.itemName} → {pickupFor.customerName} ({pickupFor.customerMobile})</div>
            <div className="rounded-xl bg-white border-2 border-stone-200 px-3 py-2 text-sm font-bold text-stone-600 mb-3">
              Kul Kiraya {money(pickupFor.rentTotal)} · Advance {money(pickupFor.advancePaid)} ·{" "}
              <span style={{ color: "#DC2626" }}>Baqaya {money(bookingRentBalance(pickupFor))}</span>
            </div>
            <label className={labelCls}>ABHI WASOOL RAQAM RS
              <input value={pickupAmt} onChange={(e) => setPickupAmt(e.target.value)} data-testid="pickup-amount" inputMode="numeric" className={inputCls} />
            </label>
            {num(pickupAmt) < bookingRentBalance(pickupFor) && (
              <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-800">
                Baqaya pura wasool nahi hua — baqi {money(bookingRentBalance(pickupFor) - num(pickupAmt))} booking par laal dikhta rahega.
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPickupFor(null)} className="flex-1 rounded-2xl py-3 font-black bg-white shadow">Cancel</button>
              <button onClick={doPickup} data-testid="pickup-confirm"
                className="flex-[2] rounded-2xl py-3 font-black text-white shadow" style={{ background: "#1D4ED8" }}>
                ✓ Wasool — Dress Bahar (Out)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Return / settlement modal ───────────────────────────────── */}
      {returnFor && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" data-testid="return-panel">
          <div className="w-full max-w-[520px] rounded-3xl bg-[#FFF7ED] p-5 shadow-2xl my-6">
            <div className="text-xl font-black mb-1">↩️ Wapsi — Settlement</div>
            <div className="text-sm font-bold text-stone-500 mb-3">{returnFor.itemName} → {returnFor.customerName} · Tay wapsi: {dlabel(returnFor.returnDate)}</div>
            <div className="grid gap-3">
              <label className={labelCls}>ASAL WAPSI KI TAREEKH
                <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} data-testid="ret-date" className={inputCls} />
              </label>
              <div className="rounded-xl bg-white border-2 border-stone-200 px-3 py-2 text-sm font-bold text-stone-600">
                Late Din: <b className="text-stone-900">{rLateDays} din</b> · Roz ka Fine: <b className="text-stone-900">{money(returnFor.lateFinePerDay)}</b>
              </div>
              <label className={labelCls}>LATE FINE RS (BADAL SAKTE HAIN)
                <input value={rFine} onChange={(e) => { setRFine(e.target.value); setFineEdited(true); }} data-testid="ret-fine" inputMode="numeric" className={inputCls} />
              </label>
              <label className={labelCls}>DRESS KI HALAT
                <select value={rCond} onChange={(e) => setRCond(e.target.value as ReturnCondition)} data-testid="ret-condition" className={inputCls}>
                  <option value="theek">✓ Theek Hai — Available Ho Jayegi</option>
                  <option value="damage">⚠️ Damage Hai — Charges Lageinge</option>
                  <option value="cleaning">🧺 Dry-Clean Bhej Diya — Cleaning Mein Jayegi</option>
                </select>
              </label>
              {rCond === "damage" && (
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelCls}>DAMAGE CHARGES RS
                    <input value={rDamage} onChange={(e) => setRDamage(e.target.value)} data-testid="ret-damage" inputMode="numeric" placeholder="0" className={inputCls} />
                  </label>
                  <label className={labelCls}>DAMAGE NOTE
                    <input value={rDamageNote} onChange={(e) => setRDamageNote(e.target.value)} data-testid="ret-damage-note" placeholder="e.g. Aasteen phati hui" className={inputCls} />
                  </label>
                </div>
              )}
              <div className="rounded-2xl bg-white border-2 border-stone-200 p-3 space-y-1 text-sm font-bold text-stone-600" data-testid="ret-settlement">
                <div className="flex justify-between"><span>Jama Security</span><b className="text-stone-900">{money(returnFor.securityDeposit)}</b></div>
                <div className="flex justify-between"><span>Katoti (Fine {money(num(rFine))} + Damage {money(rCond === "damage" ? num(rDamage) : 0)})</span><b>− {money(rDeducted)}</b></div>
                <div className="flex justify-between text-base"><span className="font-black text-stone-800">Security Wapas Customer Ko</span><b style={{ color: "#16A34A" }}>{money(rRefund)}</b></div>
                {rExtra > 0 && (
                  <div className="flex justify-between text-base"><span className="font-black">Mazeed Wasool (Charges Deposit Se Zyada)</span><b style={{ color: "#DC2626" }}>{money(rExtra)}</b></div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setReturnFor(null)} className="flex-1 rounded-2xl py-3 font-black bg-white shadow">Cancel</button>
                <button onClick={doReturn} data-testid="ret-confirm"
                  className="flex-[2] rounded-2xl py-3 font-black text-white shadow" style={{ background: "#16A34A" }}>
                  ✓ Wapsi Mukammal Karein
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Slip modal ──────────────────────────────────────────────── */}
      {slipFor && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="w-full max-w-[420px] my-6">
            <RentalSlip booking={slipFor} item={itemById.get(slipFor.itemId)} />
            <div className="no-print mt-3 flex gap-2">
              <button onClick={() => setSlipFor(null)} className="flex-1 rounded-2xl py-3 font-black bg-white shadow">Band Karein</button>
              <button onClick={() => window.print()} data-testid="slip-print"
                className="flex-1 rounded-2xl py-3 font-black text-white shadow" style={{ background: "#0F172A" }}>
                🖨️ Print Karein
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Item form modal (owner) ─────────────────────────────────── */}
      {itemFormOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" data-testid="item-form">
          <div className="w-full max-w-[520px] rounded-3xl bg-[#FFF7ED] p-5 shadow-2xl my-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xl font-black">{itemEdit ? "✏️ Dress Edit Karein" : "➕ Nayi Dress"}</div>
              <button onClick={() => setItemFormOpen(false)} className="rounded-full bg-white px-3 py-1 font-black shadow">✕</button>
            </div>
            <div className="grid gap-3">
              <label className={labelCls}>DRESS / ITEM KA POORA NAAM
                <input value={iName} onChange={(e) => setIName(e.target.value)} data-testid="it-name" placeholder="e.g. Bridal Lehenga — Laal" className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>CATEGORY / FUNCTION
                  <select value={iCategory} onChange={(e) => setICategory(e.target.value)} data-testid="it-category" className={inputCls}>
                    {RENTAL_CATEGORIES.map((c) => <option key={c} value={c}>{rentalCategoryEmoji(c)} {c}</option>)}
                    <option value="__custom">✏️ Nayi Category Likhein…</option>
                  </select>
                </label>
                <label className={labelCls}>KUL PIECE (TOTAL QTY)
                  <input value={iTotalQty} onChange={(e) => setITotalQty(e.target.value)} data-testid="it-total-qty" inputMode="numeric" placeholder="1" className={inputCls} />
                </label>
              </div>
              {iCategory === "__custom" && (
                <label className={labelCls}>NAYI CATEGORY KA NAAM
                  <input value={iCategoryCustom} onChange={(e) => setICategoryCustom(e.target.value)} data-testid="it-category-custom" placeholder="e.g. Nikkah, Engagement…" className={inputCls} />
                </label>
              )}
              <p className="-mt-1 text-xs font-bold text-stone-400">Dresses aksar 1 hi piece hoti hain. Lights, sajawat dholki, chairs waghera ki tadaad zyada ho to Total Qty mein likhein — booking utne hi piece ki hogi jitne bache hon ge.</p>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>SIZE
                  <input value={iSize} onChange={(e) => setISize(e.target.value)} data-testid="it-size" placeholder="M / L / Free Size" className={inputCls} />
                </label>
                <label className={labelCls}>RANG (COLOUR)
                  <input value={iColor} onChange={(e) => setIColor(e.target.value)} data-testid="it-color" placeholder="e.g. Mehroon" className={inputCls} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>ROZ KA KIRAYA RS
                  <input value={iRent} onChange={(e) => setIRent(e.target.value)} data-testid="it-rent" inputMode="numeric" className={inputCls} />
                </label>
                <label className={labelCls}>SECURITY DEPOSIT RS
                  <input value={iDeposit} onChange={(e) => setIDeposit(e.target.value)} data-testid="it-deposit" inputMode="numeric" className={inputCls} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>OFFER KIRAYA RS / DIN (KHAALI = KOI OFFER NAHI)
                  <input value={iOffer} onChange={(e) => setIOffer(e.target.value)} data-testid="it-offer" inputMode="numeric" placeholder="e.g. 3200" className={inputCls} />
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input type="checkbox" checked={iBoardOffer} onChange={(e) => setIBoardOffer(e.target.checked)} data-testid="it-board-offer"
                    className="w-6 h-6 accent-red-600" />
                  <span className="text-sm font-black text-stone-600">🎉 Board Offer — Dress Board ki Offers slide par dikhayein</span>
                </label>
              </div>
              <p className="-mt-1 text-xs font-bold text-stone-400">Offer sirf tab ACTIVE hoti hai jab Board Offer ON ho aur offer kiraya asal kiraye se KAM ho. Booking hamesha offer wale kiraye par banti hai jab offer active ho.</p>
              <div>
                <span className={labelCls}>DRESS KI PHOTOS (MAX 16 — GOL GHOOM KAR LI GAYI ANGLES)</span>
                <div className="mt-1 grid gap-2">
                  {iPhotos.map((u, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {u ? <img src={u} alt="" className="w-11 h-11 rounded-lg object-cover border" /> : <span className="w-11 h-11 rounded-lg bg-stone-100 flex items-center justify-center text-lg">🖼️</span>}
                      <input value={u} onChange={(e) => setIPhotos((p) => p.map((x, j) => (j === idx ? e.target.value : x)))}
                        data-testid={`it-photo-${idx}`} placeholder="Photo ka URL / path (e.g. /images/...)" className={inputCls} />
                      <button type="button" onClick={() => setIPhotos((p) => p.filter((_, j) => j !== idx))}
                        className="shrink-0 rounded-xl bg-red-50 px-3 py-2 font-black" style={{ color: "#DC2626" }}>✕</button>
                    </div>
                  ))}
                  {iPhotos.length < 16 && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setIPhotos((p) => [...p, ""])} data-testid="it-photo-add"
                        className="rounded-xl bg-white border-2 border-dashed border-stone-300 px-4 py-2 text-sm font-black text-stone-500">
                        ➕ Photo URL Add Karein
                      </button>
                      <label className="rounded-xl bg-white border-2 border-dashed border-stone-300 px-4 py-2 text-sm font-black text-stone-500 cursor-pointer">
                        📷 Photo Upload Karein
                        <input type="file" accept="image/*" className="hidden" data-testid="it-photo-upload"
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
                              setIPhotos((p) => [...p, cv.toDataURL("image/jpeg", 0.85)].slice(0, 16));
                            };
                            img.src = URL.createObjectURL(f);
                          }} />
                      </label>
                    </div>
                  )}
                  <p className="text-xs font-bold text-stone-400">Pehli photo MAIN photo hai (lists mein wohi dikhti hai). 2 ya zyada photos hon to Dress Board par dress ghumti hui (angles badal badal kar) nazar ati hai — 8 ya zyada photos hon to bilkul 360° ghumti hui lagti hai. Photo recipe: dress ko mannequin/stand par pehnayein, barabar roshni rakhein, phone ko ek hi doori par rakh kar aahista aahista gol ghoom kar 12–16 tasveerein lein.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelCls}>EMOJI (PHOTO NA HO TO)
                  <input value={iEmoji} onChange={(e) => setIEmoji(e.target.value)} data-testid="it-emoji" className={inputCls} />
                </label>
                <label className={labelCls}>HALAT (STATUS)
                  <select value={iStatus} onChange={(e) => setIStatus(e.target.value as RentalItemStatus)} data-testid="it-status" className={inputCls}
                    disabled={!!itemEdit && (itemEdit.status === "booked" || itemEdit.status === "out")}>
                    <option value="available">✅ Available</option>
                    <option value="cleaning">🧺 Dry-Clean / Repair</option>
                    <option value="inactive">🚫 Band (Inactive)</option>
                  </select>
                </label>
              </div>
              {itemEdit && (itemEdit.status === "booked" || itemEdit.status === "out") && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-800">
                  Ye dress abhi booking par hai — halat booking flow se hi badlegi.
                </div>
              )}
              <button onClick={saveItem} data-testid="it-save" disabled={!iName.trim()}
                className="rounded-2xl py-3.5 text-lg font-black text-white shadow disabled:opacity-40" style={{ background: "#F97316" }}>
                ✓ Dress Save Karein
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
