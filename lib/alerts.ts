// ─────────────────────────────────────────────────────────────────────────────
// STAFF ORDER ALERTS — "har online order par lazmi notification, voice ke
// sath" (Talha, 14 Nov 2026). Staff must never miss an online order.
//
// TRIGGERS (computed from the orders store by alertsFor):
//  (a) a new online order lands as proof_pending → Owner (verification
//      needed) + the relevant shop's staff screen get a "proof" alert;
//  (b) an order gets CONFIRMED (payment verified) → Kitchen (canteen) or
//      Grocery POS packing (grocery) get a "naya order" fulfil alert;
//  (c) table-QR CASH orders (and counter bills) are payment-cleared the
//      moment they are placed → Kitchen gets the fulfil alert directly.
// A proof_pending / rejected order NEVER produces a fulfil alert — the
// alert key only "appears" for an order once it is payment-cleared, which
// is exactly what makes the confirmation transition detectable.
//
// DELIVERY (prototype): staff pages poll the orders store every ~3s and
// also listen to BroadcastChannel + 'storage' + the store's own event, so
// another tab of the same browser alerts near-instantly. Seen alert keys
// are kept per role in sessionStorage (baseline-seeded on first mount so
// old orders never re-alert). Phase 2 replaces this with cross-device
// push (SSE from the PostgreSQL backend).
//
// SOUND: WebAudio beep sequence + speechSynthesis announcement ("Naya
// online order aa gaya hai", lang ur-PK with the browser's best fallback).
// Browsers block audio before the first user interaction, so the first
// staff click/keypress ARMS the audio (armAudio) — the TopBar toggle
// shows the armed state honestly. Sound repeats every ~15s while an
// alert stays unacknowledged.
// ─────────────────────────────────────────────────────────────────────────────

import { Order, isToday, isPaymentCleared } from "./store";

export type AlertRole = "owner" | "canteen" | "grocery" | "kitchen";

export interface OrderAlert {
  key: string;
  orderId: string;
  kind: "proof" | "fulfil";
  headline: string;
  detail: string;
  speak: string;
}

// ── Sound engine (module singleton) ─────────────────────────────────────────
const SOUND_KEY = "canteen-pos-sound-v1";
let actx: AudioContext | null = null;
let armed = false;

export function soundOn(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}
export function setSoundOn(on: boolean): void {
  try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* ignore */ }
  notifySound();
}
export function audioArmed(): boolean { return armed; }
function notifySound() {
  try { window.dispatchEvent(new Event("pos-sound-changed")); } catch { /* ignore */ }
}

/** Browsers only allow audio after a user gesture — the first staff
 *  click/keypress anywhere creates + resumes the AudioContext. */
export function armAudio(): void {
  if (typeof window === "undefined") return;
  try {
    if (!actx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === "suspended") void actx.resume();
    if (!armed) { armed = true; notifySound(); }
  } catch { /* ignore */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", armAudio);
  window.addEventListener("keydown", armAudio);
}

/** Loud 3-beep sequence (WebAudio oscillator — no audio file needed). */
export function beep(): void {
  if (!soundOn() || !armed) return;
  try {
    armAudio();
    if (!actx) return;
    const t0 = actx.currentTime;
    [0, 0.22, 0.44].forEach((off, i) => {
      const osc = actx!.createOscillator();
      const gain = actx!.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1174 : 880;
      gain.gain.setValueAtTime(0.0001, t0 + off);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.18);
      osc.connect(gain); gain.connect(actx!.destination);
      osc.start(t0 + off); osc.stop(t0 + off + 0.2);
    });
  } catch { /* ignore */ }
}

/** Spoken announcement — Urdu first (ur-PK), the browser falls back to its
 *  default voice when no Urdu voice exists. */
export function speak(text: string): void {
  if (!soundOn() || !armed) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ur-PK";
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// ── Which alerts does this role get from these orders? ──────────────────────
const qtyOf = (o: Order) => o.lines.reduce((s, l) => s + l.qty, 0);

function describe(o: Order): string {
  const shop = o.mode === "grocery" ? "🛒 Grocery" : "🍔 Canteen";
  const who = o.orderType === "dine-in" && o.tableNo
    ? `Table ${o.tableNo}${o.customerName ? ` — ${o.customerName}` : ""}`
    : `${o.customerName ?? "Customer"}${o.placeLabel ? ` — ${o.placeLabel}` : ""}`;
  return `${shop} · ${who} · Rs ${o.total.toLocaleString()} · ${qtyOf(o)} items`;
}

export function alertsFor(orders: Order[], role: AlertRole): OrderAlert[] {
  const out: OrderAlert[] = [];
  for (const o of orders) {
    const mode: "canteen" | "grocery" = o.mode === "grocery" ? "grocery" : "canteen";
    // (a) payment proof awaiting verification — any date, verification
    // must never be missed. Owner sees all; the shop's own staff too.
    if (o.paymentStatus === "proof_pending") {
      if (role === "owner" || role === mode) {
        out.push({
          key: `proof:${o.id}`, orderId: o.id, kind: "proof",
          headline: "💳 Naya Online Order — Payment Tasdeeq Chahiye",
          detail: describe(o) + (o.paymentProof ? ` · ${o.paymentProof.method}` : ""),
          speak: "Naya online order aa gaya hai. Payment ki tasdeeq baqi hai.",
        });
      }
      continue; // never a fulfil alert while payment is unverified
    }
    // (b)+(c) fulfilment — only payment-cleared orders from today.
    if (!isPaymentCleared(o) || !isToday(o) || o.status === "ready") continue;
    if (role === "kitchen" && mode === "canteen") {
      out.push({
        key: `fulfil:${o.id}`, orderId: o.id, kind: "fulfil",
        headline: "🍳 Naya Order — Kitchen ke liye",
        detail: `${describe(o)} · Token ${o.token}`,
        speak: "Naya order aa gaya hai.",
      });
    }
    if (role === "grocery" && mode === "grocery" && o.source === "online") {
      out.push({
        key: `fulfil:${o.id}`, orderId: o.id, kind: "fulfil",
        headline: "📦 Naya Online Order — Packing ke liye",
        detail: `${describe(o)} · Token ${o.token}`,
        speak: "Naya online order aa gaya hai.",
      });
    }
  }
  return out;
}
