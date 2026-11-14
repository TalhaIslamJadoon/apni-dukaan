# POS System — Canteen + Grocery (Prototype)

One POS system with **two modes in separate tabs**, built to Talha's approved
spec (14 Nov 2026). Same billing / payment / stock / report engine and the
same orders data underneath — the cashier screens never mix.

**Context:** this system is for a canteen + grocery store run on contract
at a college — the customers are that college's students/staff. It is a
standalone business system, **not** part of any college administration /
LMS software. Shop names are neutral placeholders (`College Canteen`,
`Campus Grocery Store`) and live in **one place only**: the `SHOP` object
at the top of `lib/store.ts` — change them there and the bill header,
header text and table-QR cards all follow.

## Tabs (top, in the Dark Slate header — active tab is orange)

| Tab | Route | Screen |
|---|---|---|
| 🍽️ **Canteen POS** | `/` | Canteen cashier (description below) |
| 🛒 **Grocery POS** | `/grocery` | Grocery cashier (description below) |
| 👨‍🍳 **Kitchen** | `/kitchen` | Canteen tokens only |
| 📦 **Stock** | `/stock` | Stock keeper's backend entries (description below) |
| 📊 **Owner Dashboard** | `/owner` | Combined reports for both modes |
| 📱 **Online Order** | `/online` | Customer-facing ordering (description below) |

**Tabs are role-based** — a staff member only ever sees the tab(s) the
owner gave them (next section). The full strip above is what the
**Owner** sees.

## 🔐 Staff Login & Role-Based Tab Access

Talha's rule: **"Jis banday ko jis chez ka access ho usy just uska tab
show ho — owner role assign kar saky."** Each person sees ONLY their own
tab(s); the **owner assigns the roles**.

- **Staff login** (for the staff routes `/`, `/grocery`, `/kitchen`,
  `/stock`, `/owner`): with no session, the app shows a friendly login —
  **tap your name card + enter your 4-digit PIN**. You land on your first
  allowed tab. The session persists on the device; the header shows who
  is logged in + a **⏻ Logout** (switch user) button.
- **Tab visibility + guards:** the top strip renders only the logged-in
  person's tabs. Opening a forbidden tab's URL directly does NOT show
  it — an "⛔ Aap ko is tab ka access nahi hai" notice appears and the
  app redirects to the person's first allowed tab, where the notice
  repeats once as a banner so the redirect is never mysterious.
- **Demo staff (seeded, test instantly):**

  | Person | PIN | Sees |
  |---|---|---|
  | 👑 Owner | **1234** | ALL tabs |
  | 🍽️ Canteen Wala | **1111** | Canteen POS only |
  | 🛒 Grocery Wala | **2222** | Grocery POS only |
  | 👨‍🍳 Kitchen Wala | **3333** | Kitchen only |
  | 📦 Stock Wala | **4444** | Stock only |

- **Owner Dashboard → 🔐 Staff Access** is where the owner manages this:
  **add** a staff member (name + 4-digit PIN + tick tabs), **edit** name /
  PIN / tabs, **remove** a member, and **change the owner's own PIN**
  (Edit the Owner row). One person may hold **multiple tabs** (e.g. a
  trusted person gets Canteen + Grocery). Safety: the **owner account
  can never be removed and can never lose the Owner Dashboard tab** —
  the shop can never lock itself out; `loadStaff()` also self-heals a
  missing owner.
- **`/online` stays public** — it is the customer page (table QR, remote
  accounts) and needs no staff login; in customer mode it shows no staff
  tabs at all. A logged-in staff member sees the Online Order tab only
  if the owner ticked it for them (the owner has it by default).
- ⚠️ **Honesty:** staff PINs are **demo-grade and stored locally in
  plain form** in this prototype, like the customer accounts. **Real
  per-user staff accounts with hashed passwords arrive with the
  PostgreSQL backend in Phase 2.** The old standalone Owner-Dashboard
  PIN gate is gone — the owner PIN (1234) is now simply the Owner's
  staff-login PIN, changeable in Staff Access.

## Stack (Latest, NOT Python)

- **TypeScript** full-stack
- **React 19 + Next.js 16** (App Router) on **Node.js**
- **Tailwind CSS 4** for styling
- **PostgreSQL** — the intended production database (see "Data layer" below)
- **Redis** — planned as a cache in Phase 2 only. It is **not** used or faked in Phase 1.
- Font: **Inter** (system fallback), rounded cards

Approved colours: Header Dark Slate `#0F172A`, Primary Orange `#F97316`,
warm-white background `#FFF7ED` family, Success `#16A34A`, Pending `#F59E0B`,
Cancel `#DC2626`. Category colours: Chai brown, Cold Drink blue,
Fast Food red/orange, Nashta green, Snacks purple.

## How to run

```bash
cd ~/workspace/canteen-pos
npm install
npm run build
npm start
```

Then open: **http://localhost:3007**

(Dev mode alternative: `npm run dev` — same port, http://localhost:3007)

## Screens

**🍽️ Canteen POS (`/`)** — One screen: menu tiles (left ~70%) + always-visible
bill (right ~30%). Category tabs, big +/− qty, total in largest text. No sidebar.
Payment: 4 big buttons — Cash, JazzCash, Easypaisa, Udhaar. Cash: quick
Rs 100 / 500 / 1000 buttons, Exact, automatic change (baqaya). Udhaar: customer
name for khata. Completing creates a sequential **Token Number**, shows a
success/token screen, and sends the order to Kitchen.

**🛒 Grocery POS (`/grocery`)** — Same bill-panel pattern, grocery style:
- **Search box** + **Barcode / SKU scan field** — see "Barcode scanner"
  below (try barcode `8961000003001` or SKU `1001`)
- Product grid with SKU, price and **live stock** on every card
- **Weight items** (atta, cheeni, chawal, daal…) are priced **per kg** and
  added in 0.5 kg steps (+/− gives 0.5 / 1.0 / 1.5 kg…), price by weight
- **Retail / Wholesale toggle** — now in the **bill panel header** as the
  bill's price type; it reprices the grid and the current bill
- **Wholesale minimum quantity** — in Wholesale mode, each bill line must
  meet a minimum quantity before the bill can be completed. The shop-wide
  defaults are **10 pieces/packs** and **5 kg** (Owner Dashboard → Shop
  Settings); a product's own **Wholesale Min Qty** overrides the default.
  Below-minimum lines are flagged in the bill and checkout stays disabled
  until every line reaches its minimum. Retail bills have no minimum.
- Same 4 payment methods; **Udhaar records the customer's name** for the khata
- On sale, **stock is deducted automatically**; grocery orders are handed
  over at the counter (they do NOT go to Kitchen)

### 🔫 Barcode scanner (Grocery POS)

Walk-in grocery customers pick their items themselves; **the bill is
made at the counter by staff scanning** — that is the flow this supports
(no self-checkout).

- **Hardware scanner (counter standard):** USB/Bluetooth scanners act as
  a keyboard that types the code + Enter. The scan field is
  **auto-focused when the page opens and re-focused after every action**
  (after a scan the field clears instantly with focus kept; after a sale
  completes, "+ New Sale" refocuses it) — the cashier never has to click
  it. On Enter the product is matched by **BARCODE first, then SKU/PLU**
  and added to the bill immediately through the same add path as a tile
  tap (repeat scan = qty +1; per-kg items add their 0.5 kg step). The
  added bill line **flashes green**, a **"✓ Added: \<name\>" toast**
  shows, and a tiny **WebAudio beep** sounds (no audio file needed).
  Unknown code → red **"✕ Item not found"** toast + shake + low buzz;
  the field clears and focus stays.
- **Focus-safe burst listener:** if focus is lost entirely (no field
  focused), a page-level listener still catches scanner-style key
  bursts (fast keys ending in Enter, ≥3 chars) and adds the item. If
  ANY input has focus (search box, scan field, udhaar name…) typing is
  left completely alone — the scan field's own submit handles its scans.
- **Product barcodes:** grocery products carry a **`barcode`** field
  (editable in Owner Dashboard → Grocery Products). Packed / branded
  piece items are seeded with **sample EAN-13-style codes** (`896…` —
  Pakistan's GS1 prefix; samples, not real product codes). **Loose
  per-kg items** (atta, cheeni, chawal, daal) have **no barcode** — they
  are sold by typing their **SKU/PLU code** in the same field or by tile
  tap, which is standard practice for loose goods.
- **📷 Camera Scan (testing / tablets):** the button next to the scan
  field opens the camera (`getUserMedia`) and reads EAN/UPC/Code-128/QR
  codes with the browser's built-in **`BarcodeDetector`** (Chrome /
  Android). A read behaves exactly like a hardware scan; the camera
  stays open for continuous scanning (1.5 s per-code cooldown so one
  product doesn't add repeatedly). Browsers without `BarcodeDetector`
  show a clear message — *"Is browser mein camera scan nahi — code type
  kar dein"* — and typing/scanning carries on. No external scanning
  library, no network dependency.

### 🗂️ Grocery structure — Main Head → Sub Head → Product (3 levels)

A real grocery has hundreds of items, so the catalogue is organised in
**three levels**: every product lives in exactly ONE **sub-head**, and
every sub-head lives in exactly ONE **main head** (`headId` + `subId`
fields in `lib/store.ts`; sub-head ids are namespaced `headId:subSlug`
so they can never collide across heads).

The catalogue itself is **Talha's own list** (approved 2026-11-14):
**20 main heads, 39 sub-heads, 390 products**. The machine-readable seed
is `lib/catalog-seed.json` (flattened into the store on first run); the
same list as plain text lives in **`categories-source.txt`** in the
project root. All prices and stock figures in the seed are **SAMPLE**
values — the owner sets the real ones in Owner Dashboard → Grocery
Products → Edit. Units follow the goods: **per kg** for loose staples
(aata, rice/chawal, daalain, sugar, dry fruits and similar), **per
piece** for everything else.

**Filtering — two chip rows.** The **Grocery POS** and the **online
grocery view** both show a **head chips row** (🛒 Sab (All) + one chip
per head with its total product count; chips appear only for heads that
have at least one product). Selecting a head reveals a **second row**:
that head's sub-heads (plus All), each with its count — filtering then
applies head → sub-head. Typing in the **search box searches across ALL
heads** (with a "Search results — saare heads se" note), and **barcode
scans ignore the filters** entirely — a scanned item lands in the bill
wherever it lives.

**📦 Packings — a size is a packing of ONE product, not a separate
item.** A product may carry `packings` (e.g. **Surf Excel: 500g / 1kg /
2kg**, each with its own retail + wholesale price). Tapping such a tile
opens a small **chooser popup** listing every packing with its price
(following the POS Retail/Wholesale toggle); the chosen packing bills
as a line named **`Product Name (Label)`** at that packing's price.
Scanning a product that has packings adds its **first packing** (the
toast shows the label). In this prototype, **stock is tracked per
PRODUCT, not per packing** — selling any packing decrements the
product's single stock figure.

**Owner management.** In Owner Dashboard → Grocery Products →
**🗂️ Grocery Heads — apna head khud banayein**, every head is listed
with its product count and its sub-heads indented underneath (each with
its own count). The owner can **add a head** (name + emoji from a preset
row, tint auto-assigned), **add a sub-head** (head selector + name),
**rename** a head or sub-head inline, and **delete** a head or sub-head
**only when it contains 0 products** (otherwise shift its products to
another head/sub-head first, via product Edit; deleting an empty head
also removes its empty sub-heads). The product add/edit form has a
**Head dropdown → Sub-Head dropdown** (the sub-head options depend on
the chosen head) plus a simple **Packings editor** — rows of label +
retail + wholesale with add/remove; leave it empty for a product
without packings.

**Storage keys.** Products: `canteen-pos-grocery-v2` · Heads:
`canteen-pos-heads-v1` · Sub-heads: `canteen-pos-subheads-v1` (seeds on
first run; invalid saved data falls back to the seeds).

**Replacement note:** the old 2-level "sections" demo catalogue (23
sample items) is **replaced wholesale** by this 390-product catalogue —
the old v1 storage keys simply stop being read. Nothing real was ever
entered in the demo data, so nothing is lost.

### 🏷️ Barcode label printing (Owner Dashboard) — label printer is REQUIRED hardware

**Required hardware for the grocery (Talha, 2026-11-14 — mandatory, not
optional):** a **barcode label printer** (50mm × 30mm sticker labels)
alongside the counter barcode scanner. Loose and unbranded goods reach
the shelf with shop-printed stickers, and the counter scans those
stickers — so the grocery does not run without one.

Owner Dashboard → Grocery Products has a **🏷️ Barcode Labels** panel:
tick products (checkboxes, filterable by **Head / Sub-Head** or search),
set **how many stickers per product**, and open the **print sheet** —
the screen preview is the same grid that prints. A single product's
sheet also opens from its **🏷️ Label** button in the product list.
Each sticker (standard **50mm × 30mm**) shows the **product name**, the
**retail price**, and a **real, scannable Code128 barcode** encoding
the product's `barcode` value — or its **SKU** when the product has no
barcode. The barcode is drawn by a small local encoder
(`lib/code128.ts` + `components/Barcode128.tsx`, pure code rendering
SVG — no library, no CDN), so the printed sticker scans at the Grocery
POS exactly like a factory-printed one. Printing uses `window.print`
with label print CSS (only the sheet prints) — in this prototype the
browser's print dialog sends it to the label printer; direct
label-printer drivers are a Phase 2 item.

### 🖼️ Product pictures — fallback hierarchy

Products, sub-heads and main heads all carry an optional **`image`**
field (URL/path), and the canteen menu items have one too. Tiles and
cards (Grocery POS, Online, Canteen POS) resolve the picture in this
order: **product image → its Sub-Head image → its Head image → the
emoji 3D tile** (the resolver is `groceryImage()` in `lib/store.ts`).
So one good picture on a head covers its whole range until individual
product photos arrive. Images render **inside the existing 3D tile
frame** (`object-cover`, rounded) — layout and cashier speed are
unchanged, and with no images set anywhere the app looks exactly as
before. The owner can set or replace any picture manually in the Owner
Dashboard: an **Image URL** field on the product form, on head/sub-head
creation, and in their rename editors. (The seed ships with empty image
fields; the internet-sourced picture set is integrated separately.)

### 🤖 AI Assistant — role-aware, answers from real system data

A **🤖 AI Assistant** button sits in the TopBar for staff, and a
floating 🤖 button on `/online` for customers. It opens a drawer with
per-role suggestion chips and a free-text box. **It is not a fake
chatbot**: a deterministic local query engine (`lib/assistant.ts`)
pattern-matches Roman Urdu + English questions and computes every
answer from the app's real local data (products, stock, bills, orders,
stock entries). The panel footer says so honestly — *"Abhi ye
assistant system ke data se jawab deta hai; asal AI (Gemini) Phase 2
mein lagega."* The chat renders only when opened, so POS screens never
slow down.

- **Owner (full access):** today's sales total (canteen/grocery/online
  split), low-stock list, best-selling items, pending orders count,
  udhaar summary, wholesale prices, product/stock lookups.
- **Canteen / Grocery staff:** product finder (Head › Sub-Head, retail
  price, stock), packing info, pending orders for their area, how-to
  hints. **Wholesale prices, profit and udhaar totals are refused**
  politely — owner-only info.
- **Stock keeper:** low-stock and out-of-stock lists, recent stock
  entries, which head has the most low items.
- **Kitchen:** pending token count, the oldest pending order, Dine-In
  vs Takeaway counts.
- **Online customer:** catalogue search (name + retail price +
  available/sold-out), budget suggestions ("Rs 500 mein snacks"), and
  **their own** order status only — no wholesale, no exact stock
  counts, no other customers' data.

**👨‍🍳 Kitchen (`/kitchen`)** — Pending **canteen** tokens as very large cards
with a big **READY** button. Auto-refreshes every second.

**📦 Stock (`/stock`)** — the **stock keeper's** screen (he does NOT
sell). One place for BOTH inventories with a **Canteen / Grocery
switch**: every item with unit (pcs / kg), current stock and selling
price (read-only — **price changes are the owner's job only**), and
items at/under their low-stock threshold (≤5 pcs, ≤2 kg; per item
adjustable in data) highlighted **amber/red** (KHATAM when 0).
- **➕ Stock IN entry:** pick item (search, or type barcode/SKU + Enter
  to jump straight to it) → qty → **purchase rate (Rs)** → optional
  supplier → save. Stock increases.
- **🗑️ Wastage entry:** pick item → qty → reason (Expired / Damaged /
  Spilled / Other) → stock decreases (never below what exists).
- **Entries log** on the same screen: every entry with date/time, item,
  ±qty, rate/supplier or reason, and **entered-by = the logged-in staff
  member's name**.
- Stock is **one shared state**: canteen menu items now carry stock too
  (seeded sample quantities), and **every sale — canteen counter, online
  canteen, grocery counter, online grocery — decrements the same stock**
  the Stock screen shows. The Owner Dashboard strip shows a **Low Stock
  count** across both inventories.

**📊 Owner Dashboard (`/owner`)** — Owner staff login (demo PIN:
**1234**, see Staff Access above). Combined today's totals with a
**Canteen vs Grocery sales split**, cash vs online (JazzCash+Easypaisa)
split, Udhaar total, order count, best sellers, **Bill History**
(below), **🔐 Staff Access** (assign tabs + PINs per person),
**Menu Management** and **Grocery Products Management** (add / edit /
delete, incl. SKU, **EAN barcode**, retail + wholesale prices, stock
and per-piece/per-kg unit).

## 📱 Online Ordering (`/online`) — customer-facing

**There are TWO kinds of customers (Talha's rule) — the account rule
splits by where the customer is:**

### A) Walk-in / table-QR customers — NO account, NO login, ever

```
Scan QR  →  write NAME + TABLE NUMBER  →  Dine-In / Takeaway  →  order food
```

Every table has its **own printed QR** (Owner Dashboard → "Tables & QR",
Tables 1–8, each QR encodes `/online?table=N`; "Print Table Cards" prints
them ready to stick on tables). Scanning pre-fills that table number +
Dine-In (both stay editable; the customer can switch to Takeaway). In the
prototype, tapping a table number simulates the scan. A general canteen
QR (`/online`, no table) also works. The form is just **Name
(required)** + **Table Number** — there is **no ID field** in this flow.
An ID appears in exactly one place: if the customer chooses the
**Udhaar** payment option, a field opens — *"Udhaar ke liye ID likhein"*
— and the order cannot be placed on udhaar without it (money-safety:
otherwise anyone could put udhaar on someone else's name). The udhaar
khata is a ledger kept **by the shop** — the customer holds no account.

### B) Remote online orders (hostel room / office / anywhere) — ACCOUNT MANDATORY

A customer ordering from their room, office, or anywhere else online
**must create an account / log in first** ("wo lazmi ha account banana")
— this is the fake-order protection for remote orders. Walk-in customers
never touch this. Prototype accounts (stored locally, like all prototype
data):

- **Create Account:** Full Name, **Mobile Number (unique — it is the
  login ID)**, Password, Place type (Hostel Room / Office / Other) +
  Room/Office detail, and **Student/Staff ID — OPTIONAL** (the account
  is made with the mobile number; ID is only needed for Udhaar).
- **Login** with mobile + password; the session persists; **Logout** in
  the order form. No password reset / email verification in the
  prototype.
- Logged-in customers get name/mobile/place **pre-filled**, a **My
  Orders** list (their own remote orders with live status), and Udhaar
  only if their account has an ID saved.
- ⚠️ **Honesty:** these are demo-grade local accounts for the prototype.
  The app warns customers not to use a real personal password. In
  **Phase 2** real accounts move to the **PostgreSQL backend with proper
  password hashing**.

Remote orders are labelled everywhere with the account name + place —
e.g. Kitchen / bill / dashboard: **"🌐 Online — Ahmed — Hostel Room 12"**.

**Shop choice after login:** the logged-in remote customer picks
**🍔 Canteen Order** or **🛒 Grocery Order** — one order is always ONE
shop (never mixed, same rule as the POS tabs; a second order can be
placed for the other shop). The two shops keep **separate carts**.

- **Canteen online order** → Kitchen token, Received → Preparing →
  Ready, pickup at the canteen counter (as above).
- **Grocery online order** → the same grocery product data as the
  Grocery POS tab (one `loadGrocery()` source), search, per-kg weight
  quantities in 0.5 kg steps, stock auto-deducted. It does **NOT** go to
  the Kitchen — it lands in the **"🌐 Online Orders — Packing Queue"**
  panel inside the **Grocery POS tab**, where staff mark **Start
  Packing → ✓ Ready for Pickup**. The customer's My Orders mirrors the
  status (Received → Packing → Ready for Pickup at the grocery counter).
  Its bill is a normal grocery bill (grocery store name header, shared
  bill-number sequence) labelled **🌐 ONLINE ORDER**, and the dashboard
  counts it as a grocery sale with the Online split shown as
  **Online-Canteen vs Online-Grocery**. Table-QR ordering stays
  **canteen only**.

**Add to Cart (both online flows):** every item card has a clear
**＋ Add to Cart** button; once added it becomes a **− qty + stepper**
right on the card (grocery weight items step in kg). A sticky bottom
cart bar always shows item count (with a bump animation on add) +
running total; the cart screen has per-line qty steppers, remove,
per-line amounts and the grand total — and **one Place Order = one
order = one token for the whole cart**, with the full multi-item list
going to the Kitchen / packing queue exactly like a counter bill.

**3D picture cards (online flows):** online item cards (canteen menu +
grocery products, table-QR flow included) show a prominent **picture
plate in CSS 3D** — perspective tilt on hover/focus, press tilt on
touch (hover tilt disabled on touch so taps stay accurate), the artwork
pops forward (translateZ) over a deep soft shadow, and a glossy shine
sweeps the plate. Pure CSS — **no WebGL / Three.js** — and
`prefers-reduced-motion` turns it off. Prototype artwork is large emoji
on tinted plates (offline-safe). **Real item photos (Phase 2) drop into
the same 3D cards by setting the item's `image` — no layout change
needed.**

Orders from both kinds land in the **same orders data** as counter bills
(`source: "online"` + type + table/customer/place), get a normal bill
number + token, and count in the **Owner Dashboard** (Counter vs Online
split, with the Online-Canteen / Online-Grocery breakdown). Canteen
orders appear in **Kitchen** with a clear source label — 🏪 COUNTER ·
🌐 ONLINE — <place> · 🍽️ DINE-IN — TABLE N · 🥡 TAKEAWAY — while
grocery orders go to the Grocery POS packing queue instead. The
customer's screen shows live status (polling the shared state). Pickup
at the counter / served at the table — **no delivery** in this phase.
Both shops use ONE data source each, shared with their counter screens
(`loadMenu()` / `loadGrocery()`).

Multiple orders from the same table are each labelled with that table;
a **running table bill / settlement flow is Phase 2** (not built).

### 💳 Online payment — pehle payment, phir confirm (proof verification)

**Talha's rule (14 Nov 2026): an online order is confirmed only AFTER its
payment is verified.** The customer pays first and uploads a screenshot of
the payment as **proof**; the shop verifies the proof; only then is the
order confirmed.

- **Remote account orders (canteen + grocery): payment-first, always.**
  The customer is not physically present, so there is **no cash option**.
  Checkout shows a payment step: the order total, a method selector
  (**JazzCash / Easypaisa / Raast / Bank**), the shop's number for that
  method (from **Owner Dashboard → Shop Settings** — `jazzcashNumber`,
  `easypaisaNumber`, `raastInfo`; seeded with clearly-labelled **demo
  placeholders** `03XX-XXXXXXX (demo)` until Talha sets the real ones), an
  optional **Transaction ID** field, and a **REQUIRED proof-image upload**
  (file input; the image is compressed client-side via canvas to max
  1200px long side, JPEG ~0.72, so localStorage stays sane; preview +
  remove/replace). **Place Order stays disabled until a proof is
  attached.** (Udhaar remains available to remote customers whose account
  carries a student/staff ID — no proof flow, as before.)
- **Table-QR orders (Dine-In + Takeaway): the customer CHOOSES.**
  Two option cards at checkout: **💵 Cash** — the order is placed
  normally, goes to the Kitchen immediately with its token, and is marked
  Cash (pay at counter/table); no proof, no verification gate. Or
  **📱 Online Payment** — the same payment-first proof flow as remote
  orders.
- **What a proof order looks like:** it is saved with
  `paymentProof { method, txnId?, amount, proofImage, uploadedAt }` and
  `paymentStatus: "proof_pending"`, and **token 0** — the confirmation
  screen tells the customer the order has been received and will be
  confirmed after the proof is verified ("Payment Tasdeeq Baqi").
- **Fulfilment gating:** the **Kitchen** screen and the **Grocery POS
  packing queue EXCLUDE** `proof_pending` / `rejected` orders
  (`isPaymentCleared()` in `lib/store.ts`). A compact read-only
  **"⏳ Payment tasdeeq baqi (N)"** strip in **Canteen POS** and
  **Grocery POS** keeps counter staff aware of waiting orders.
- **Staff verification — Owner Dashboard → "💳 Online Payment
  Verification":** every `proof_pending` order (both shops) with customer
  name/place, items, total, method, txn id, an **amount-paid vs
  order-total match indicator**, and the proof thumbnail (click → full
  size). **✅ Confirm** assigns the order's **token at that moment** and
  releases it to the Kitchen / packing queue (`paymentStatus:
  "confirmed"`). **❌ Reject** asks for a reason (stored as
  `rejectReason`, shown to the customer) and **restores the order's
  stock** (placement had deducted it).
- **Customer side:** My Orders shows payment chips (**⏳ TASDEEQ BAQI /
  ✅ PAYMENT CONFIRM / ❌ PAYMENT REJECT + reason**). A rejected order
  offers **"🔁 Dobara Proof Upload Karein"** — a fresh proof (+ optional
  new txn id) sends it back to `proof_pending` and re-deducts the stock.
  Confirmed orders continue the normal Received → Preparing/Packing →
  Ready flow. The AI Assistant answers "mera order confirm hua?" from the
  order's `paymentStatus`, and owner/staff can ask how many verifications
  are pending ("tasdeeq baqi kitne hain?" — staff hear only their own
  shop's count).
- **Where proofs live (prototype honesty):** the compressed proof image
  is a **data URL stored with the order in localStorage**, like all
  prototype data. **Phase 2** moves proofs to **server-side file
  storage** with the PostgreSQL backend; **automatic gateway verification
  is a later step** — in this phase a human always eyeballs the
  screenshot, which is exactly the point of the flow.

### 🔔 Online-order alerts — voice ke sath (staff)

**Talha's rule: staff must never miss an online order — har online order
par lazmi notification, voice ke sath.** (`lib/alerts.ts` +
`components/OrderAlerts.tsx`, mounted on Owner Dashboard, Canteen POS,
Grocery POS and Kitchen.)

- **Triggers:** (a) a new online order lands as `proof_pending` → the
  **Owner** (verification needed) **and the relevant shop's staff screen**
  get a 💳 proof alert; (b) an order gets **confirmed** → **Kitchen**
  (canteen) / **Grocery POS** (grocery) get a "naya order" alert; (c)
  **table-QR Cash orders** (and counter bills) are payment-cleared on
  placement → **Kitchen** is alerted directly. A `proof_pending` order
  never alerts the Kitchen — its fulfil alert only exists once payment
  is cleared, which is what makes the confirmation transition fire it.
- **Form:** a prominent **persistent banner** (order summary — shop,
  customer/table, amount, item count) that **stays until staff tap
  "✓ Dekh Liya"**, **plus sound**: a loud WebAudio beep sequence **and** a
  spoken announcement via speechSynthesis — *"Naya online order aa gaya
  hai"* (lang `ur-PK`, falling back to the browser's default voice).
  Sound **repeats every ~15 seconds** while any alert is unacknowledged.
- **Sound toggle + browser arming:** the TopBar carries a
  **🔔 Sound: ON/OFF** toggle. Browsers block audio before the first user
  interaction, so the **first staff click/keypress arms the audio**; the
  toggle shows that state honestly ("🔔 Sound: ON — ek click karein"
  until armed). The banner itself is visual and needs no arming.
- **Delivery mechanism (prototype):** staff pages **poll the orders
  store every ~3s** and also listen to **BroadcastChannel + `storage`
  events**, so an order placed in another tab of the same browser alerts
  near-instantly. Last-seen alert keys are tracked **per role in
  sessionStorage** (baseline-seeded on first mount) so old orders don't
  re-alert on reload. **Cross-device push is Phase 2** (SSE from the
  backend) — in this prototype the alert fires on devices/tabs that have
  the staff screens open in the same browser.
- **Customers:** no sound. If a customer is watching their orders view
  when their payment is confirmed/rejected, they get a **visual toast**
  (plus the status chips in My Orders).

## Professional billing (latest standard)

Every completed sale produces a proper professional bill, on screen and
in print, with **proper line splits between every section**:

```
shop header ── line ── PAYMENT QR ── line ── bill meta (no / date / cashier)
── line ── items table header ── strong line ── item rows (hairline each)
── line ── Subtotal ── Discount ── ══ GRAND TOTAL (double line) ══
── Payment method ── Amount Paid ── Change (Baqaya) ── line ── Thank You
```

- **Bill number**: sequential & unique (`B-0001`, `B-0002`, …) across both modes
- **Discount**: Rs or % field in the payment step; shown on the bill
- **Items table**: Item | Qty | Rate | Amount, cleanly aligned columns
- **Token number** on canteen bills; **customer name** on grocery udhaar bills
- **Print**: "Print Bill (80mm)" on the success screen opens a clean
  thermal layout (dashed section dividers, double line around Grand Total)
  via `window.print()` + print CSS — only the bill prints
- **Bill History**: Owner Dashboard lists today's bills (number, time,
  mode, total, payment, status pill). Click any bill to open the full
  receipt again and **reprint** it — same line-split layout

### Payment QR — DEMO (honest status)

The bill carries **one QR only: the Payment QR** ("Scan to Pay — JazzCash /
Easypaisa / Raast"), printed near the top of the bill and also shown large
on the payment step so a customer can scan it live at the counter. It is
**dynamic per bill** — its payload encodes that bill's number + grand
total + a merchant id. There is no separate verification QR (on an 80mm
bill, the payment QR wins the space).

⚠️ **The merchant id in the payload is a DEMO placeholder
(`DEMO-POS-001`).** Talha's real JazzCash / Easypaisa / Raast merchant
number/ID has not been provided yet, so **no live payment can be received
through this QR yet**. Phase 2 swaps in the real merchant payload format.
The QR is tagged "Demo QR" on screen.

## Data layer — sample vs real, and the PostgreSQL path

- Phase 1 persistence is **browser localStorage**, so the prototype runs
  standalone with zero database setup. Open POS, Kitchen and Owner in
  different tabs of the **same browser** and they share the same orders/menu.
- All data access goes through `lib/store.ts` (`loadMenu/saveMenu`,
  `loadOrders/saveOrders`, `MenuItem`/`Order` types). **Phase 2 replaces
  only the inside of that file** with PostgreSQL queries (Next.js API
  routes / Server Actions) — no page component needs to change.
- Orders and the daily token counter are stored there; tokens reset each day.
- Also in `lib/store.ts`: the **staff list + staff session**
  (`loadStaff/saveStaff`, seeded demo staff), the **stock entries log**
  (`loadStockEntries/saveStockEntries`), and canteen **menu stock**
  (on `MenuItem.stock`, decremented by counter + online canteen sales).
  All move to PostgreSQL with everything else in Phase 2.

## ⚠️ Sample data

Both lists are **SAMPLES** with realistic Rs prices, so the prototype is
fully testable: the canteen menu (Doodh Patti Chai Rs 80, Chicken Biryani
Rs 300, Samosa Rs 50…) and the grocery catalogue (Talha's 390-product
list — prices/stock in the seed are sample values). The EAN-style
barcodes on packed grocery items are **samples too** (`896…`), and the
seeded stock quantities (canteen + grocery) are samples for testing the
Stock screen. **Real prices/stock are set by the owner in the Owner
Dashboard.** Edit/add/remove in the Owner Dashboard.

## 3D / animation touches (lightweight, CSS only)

Deliberately **CSS 3D transforms only — no WebGL, no 3D library**, and
nothing animates the core billing tap-flow, so the cashier is never slowed:

- **Menu + grocery tiles**: subtle 3D lift and slight tilt on hover,
  soft deep shadow; press settles back (`.tile-3d`)
- **Token / bill on the success screen**: gentle 3D flip-in when the
  token and receipt appear (`.flip-in`)
- **Owner KPI cards**: depth shadow + slight 3D hover, and the numbers
  **count up** when the dashboard opens (plain JS, no library)
- **Best-seller bars**: solid bars with a subtle 3D-ish darker depth edge
- All of it respects **`prefers-reduced-motion`** (animations off for
  users who ask for that) and **print is unaffected**

NOT done (deliberately): heavy/real 3D models, rotating food models,
WebGL scenes, header logo shine (looked gimmicky for a billing tool).

## Phase 2 will add

1. PostgreSQL wiring (replacing localStorage in `lib/store.ts`) + migrations
2. Redis cache for menu/products + today's totals
3. Direct thermal printer support (ESC/POS) — Phase 1 prints via the
   browser's print dialog on the 80mm layout
4. **Real merchant QR** — Talha's JazzCash / Easypaisa / Raast merchant
   number/ID replacing the demo payload
5. Talha's real menu and real grocery product list. **Shop/college names
   need no developer at all** — Talha sets them himself in **Owner
   Dashboard → Shop Settings** (College Name, Canteen Name, Grocery Store
   Name); they apply everywhere (header, bills, QR cards, online page)
   and are saved with the prototype data. Defaults are neutral
   placeholders ("College Canteen" / "Campus Grocery Store").
6. **Real staff accounts** — role-based tab access, per-person PINs and
   owner assignment are **already built in this prototype** (Staff
   Login + Staff Access, demo-grade local PINs). Phase 2 moves them to
   the PostgreSQL backend: individual accounts with **hashed
   passwords**, per-user audit (who sold / who entered stock), and
   server-side enforcement of the tab permissions. Logins stay for
   **staff only**; walk-in/table customers never log in (see the
   two-kinds rule above), and remote customers use the customer
   accounts described there
7. Udhaar khata ledger with per-customer balances and monthly settlement
8. **Hold / Park bill** (deliberately skipped in this phase to protect delivery)
9. Supplier purchases / stock-in for grocery, day-close report export
10. **Customer-facing promo display** — a second screen facing customers
    with rotating offers/items (the real home for heavier 3D/animation;
    kept out of the cashier's billing screens on purpose)
11. **Online Ordering Phase 2** — **real customer accounts on the
    PostgreSQL backend with proper password hashing** (the prototype's
    remote accounts are demo-grade and local — never use a real personal
    password in the demo), a real payment gateway replacing the demo QR,
    WhatsApp/SMS order notifications, the hosting/network rollout so
    hostel/office/table devices can actually reach the system
    (LAN/online hosting decision), a **running table bill / settlement**
    flow for dine-in tables, and — only if the college ever wants it —
    **optional ID verification with the college**. There is no college
    software/LMS integration in this design.

---

## Final Package (14 Nov 2026)

Complete final state of the project:

- **`final-package/Canteen-POS-Setup.zip`** — the full deployment bundle: Phase 2 server system source, Windows deployment pack, print agent, and all guides (START-HERE.txt inside).
- **`final-package/Final-Handover.pdf`** — what is built, where things live, decisions, total cost, deployment-day steps.
- **`final-package/Canteen-POS-Staff-Guide.pdf`** — 30-page staff guide (Roman Urdu).
- **`final-package/Deployment-Inputs.pdf`** — one-page sheet to fill for go-live (merchant numbers + QR images, staff PINs, printer models).

The code at the repo root is the Phase 1 test copy (live demo: https://canteen-pos.pages.dev). The production Phase 2 server system is inside the setup zip.
