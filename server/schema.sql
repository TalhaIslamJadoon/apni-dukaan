-- ─────────────────────────────────────────────────────────────────────────────
-- Canteen + Grocery POS — Phase 2 PostgreSQL schema (plan §3)
-- Money = integer paisa. Stock/quantities = numeric(12,3).
-- Design notes folded in (Talha, 14 Nov 2026):
--   * brand is part of a product's identity (grocery_products.brand) — brands
--     are NEVER merged into one product.
--   * product_variants = flavour/type layer under a master product
--     (Sunsilk Shampoo → Black / Pink / White). Masters with no flavours get
--     one implicit variant named 'Standard'.
--   * packings belong to a VARIANT; the sellable SKU is variant + packing,
--     each with its own optional barcode + price, and its own stock level
--     when the owner tracks it there (grocery_packings.stock_qty NULL =
--     stock tracked at product level, the Phase 1 behaviour).
-- Idempotent: safe to run repeatedly (IF NOT EXISTS everywhere).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Settings / shops / tables ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  college_name text NOT NULL DEFAULT '',
  system_name text NOT NULL DEFAULT 'POS SYSTEM',
  timezone text NOT NULL DEFAULT 'Asia/Karachi',
  currency_code char(3) NOT NULL DEFAULT 'PKR',
  public_order_base_url text,
  staff_session_idle_minutes integer NOT NULL DEFAULT 720,
  owner_strong_auth_required boolean NOT NULL DEFAULT false,
  jazzcash_number text,
  easypaisa_number text,
  raast_info text,
  wholesale_min_pieces numeric(12,3) NOT NULL DEFAULT 10,
  wholesale_min_kg numeric(12,3) NOT NULL DEFAULT 5,
  shop_open boolean NOT NULL DEFAULT true,  -- closed-shop popup switch (owner toggle)
  closed_contact_number text NOT NULL DEFAULT '0300-0000000 (demo)',  -- number shown in the closed popup
  board_color text NOT NULL DEFAULT '#FFC61A',  -- display boards ka background rang (owner-selected, 16 Nov 2026)
  rentals_enabled boolean NOT NULL DEFAULT false,  -- Kiraya (dress rental) wala kaam ON/OFF (17 Nov 2026)
  rental_late_fine_per_day_paisa integer NOT NULL DEFAULT 50000,  -- late wapsi fine Rs 500/din (paisa mein)
  table_count integer NOT NULL DEFAULT 8,  -- dining tables 1..N (owner-adjustable, 1..100)
  -- Business Setup (SALE version, 15 Nov 2026): fresh CREATE gets
  -- setup_done=false so the /setup wizard runs on first open; databases
  -- that already exist get the column via the ALTERs below with
  -- setup_done=true (an install that already runs never sees the wizard).
  has_canteen boolean NOT NULL DEFAULT true,
  retail_type text DEFAULT 'grocery',
  setup_done boolean NOT NULL DEFAULT false,
  catalogue_customized boolean NOT NULL DEFAULT false,  -- owner saved grocery data → templates never seed
  template_key text,  -- retail template already applied (idempotency marker)
  deals_seeded boolean NOT NULL DEFAULT false,  -- demo deals seeded once; a saved empty list stays empty
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
-- Closed-shop popup fields on pre-existing databases (idempotent).
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS shop_open boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS closed_contact_number text NOT NULL DEFAULT '0300-0000000 (demo)';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS board_color text NOT NULL DEFAULT '#FFC61A';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS rentals_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS rental_late_fine_per_day_paisa integer NOT NULL DEFAULT 50000;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS table_count integer NOT NULL DEFAULT 8;
-- Business Setup fields on pre-existing databases: setup_done defaults
-- TRUE here (opposite of the fresh CREATE) — an install that already has
-- a settings row is by definition already set up (Phase 1 parity: saved
-- settings load as setupDone=true, hasCanteen=true, retailType='grocery').
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS has_canteen boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS retail_type text DEFAULT 'grocery';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS setup_done boolean NOT NULL DEFAULT true;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS catalogue_customized boolean NOT NULL DEFAULT false;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS template_key text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS deals_seeded boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL UNIQUE CHECK (kind IN ('canteen','grocery')),
  display_name text NOT NULL,
  tagline text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  table_no integer NOT NULL,
  label text NOT NULL,
  public_token_hash text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, table_no)
);

CREATE TABLE IF NOT EXISTS business_days (
  business_date date PRIMARY KEY,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by_staff_id uuid,
  closed_at timestamptz,
  closed_by_staff_id uuid,
  closing_note text
);

CREATE TABLE IF NOT EXISTS document_counters (
  counter_key text PRIMARY KEY,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Staff, grants, sessions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  display_name text NOT NULL,
  credential_hash text NOT NULL,
  credential_kind text NOT NULL DEFAULT 'pin4' CHECK (credential_kind IN ('pin4','password')),
  is_owner boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  must_change_credential boolean NOT NULL DEFAULT false,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_one_active_owner
  ON staff_users (is_owner) WHERE is_owner AND is_active;

CREATE TABLE IF NOT EXISTS staff_tab_grants (
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  tab_key text NOT NULL CHECK (tab_key IN ('canteen','grocery','rentals','kitchen','stock','owner','online')),
  granted_by_staff_id uuid REFERENCES staff_users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, tab_key)
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_label text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_staff_id uuid REFERENCES staff_users(id)
);

-- ── Customers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  mobile text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  place_type text NOT NULL CHECK (place_type IN ('Hostel Room','Office','Other')),
  place_detail text NOT NULL DEFAULT '',
  external_student_staff_id text,
  is_active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_label text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- ── Canteen catalogue ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canteen_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  legacy_key text NOT NULL,
  name text NOT NULL,
  bg_color text, ring_color text, chip_color text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (shop_id, legacy_key)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  shop_id uuid NOT NULL REFERENCES shops(id),
  category_id uuid NOT NULL REFERENCES canteen_categories(id),
  name text NOT NULL,
  price_paisa integer NOT NULL CHECK (price_paisa >= 0),
  emoji text NOT NULL DEFAULT '🍽️',
  image_url text,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,  -- multi photos (max 16); pehli = main — boards ka photo-spin (rental wala system)
  sku text,
  low_stock_qty numeric(12,3) NOT NULL DEFAULT 5,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_sku_shop ON menu_items (shop_id, sku) WHERE sku IS NOT NULL;

-- ── Grocery catalogue: Head → Sub-Head → Master Product → Variant → Packing ──
CREATE TABLE IF NOT EXISTS grocery_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  shop_id uuid NOT NULL REFERENCES shops(id),
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '🛒',
  tint text NOT NULL DEFAULT '#FFF7ED',
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS grocery_sub_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  head_id uuid NOT NULL REFERENCES grocery_heads(id) ON DELETE RESTRICT,
  name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_sub_heads_name ON grocery_sub_heads (head_id, lower(name));

CREATE TABLE IF NOT EXISTS grocery_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  sub_head_id uuid NOT NULL REFERENCES grocery_sub_heads(id),
  name text NOT NULL,             -- master item name, e.g. 'Sunsilk Shampoo'
  brand text,                     -- company/brand — part of product identity, never merged
  sku text NOT NULL,
  barcode text,
  unit text NOT NULL CHECK (unit IN ('piece','kg')),
  retail_price_paisa integer NOT NULL CHECK (retail_price_paisa >= 0),
  wholesale_price_paisa integer NOT NULL CHECK (wholesale_price_paisa >= 0),
  wholesale_min_qty numeric(12,3),  -- NULL = shop default (settings by unit)
  low_stock_qty numeric(12,3) NOT NULL DEFAULT 5,
  board_offer boolean NOT NULL DEFAULT false,  -- owner flag: show on the Grocery Board "🎉 Aaj ki Offers" slide
  offer_price_paisa integer CHECK (offer_price_paisa IS NULL OR offer_price_paisa > 0),  -- REAL offer price (Phase 1 offerPrice): active only when board_offer AND 0 < offer < retail_price_paisa; replaces the BASE retail price (and the one representative packing priced at it) at retail only — wholesale never
  emoji text NOT NULL DEFAULT '🛒',
  image_url text,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,  -- multi photos (max 16); pehli = main — boards ka photo-spin (rental wala system)
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_products_sku ON grocery_products (sku);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_products_barcode ON grocery_products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS grocery_products_brand ON grocery_products (lower(brand));

CREATE TABLE IF NOT EXISTS grocery_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  product_id uuid NOT NULL REFERENCES grocery_products(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Standard',  -- flavour/type: Black, Pink, Anti-Dandruff… 'Standard' = implicit
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_variants_name ON grocery_variants (product_id, lower(name));

CREATE TABLE IF NOT EXISTS grocery_packings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  variant_id uuid NOT NULL REFERENCES grocery_variants(id) ON DELETE CASCADE,
  label text NOT NULL,            -- '500g', '1kg', '2kg'…
  contains_qty numeric(12,3) NOT NULL DEFAULT 1,  -- base pieces per packing (Single=1, Full Box=N); inventory for such products is ONE pool of base pieces
  barcode text,                   -- each real brand packing carries its OWN EAN
  retail_price_paisa integer NOT NULL CHECK (retail_price_paisa >= 0),
  wholesale_price_paisa integer NOT NULL CHECK (wholesale_price_paisa >= 0),
  wholesale_min_qty numeric(12,3),  -- in PACKS; NULL = product min, else shop default pieces
  stock_qty numeric(12,3),        -- NULL = stock tracked at product level (Phase 1 behaviour); set = SKU-level stock
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_packings_label ON grocery_packings (variant_id, lower(label));
CREATE UNIQUE INDEX IF NOT EXISTS grocery_packings_barcode ON grocery_packings (barcode) WHERE barcode IS NOT NULL;

-- ── Inventory ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  menu_item_id uuid REFERENCES menu_items(id),
  grocery_product_id uuid REFERENCES grocery_products(id),
  quantity_on_hand numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((menu_item_id IS NOT NULL) <> (grocery_product_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS inv_menu ON inventory_balances (menu_item_id) WHERE menu_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inv_product ON inventory_balances (grocery_product_id) WHERE grocery_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- orders/order_lines are referenced by stock_entries; created below before use
-- in FK terms Postgres needs the referenced tables first, so orders come next
-- and stock_entries after them.

-- ── Orders ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id),
  table_id uuid NOT NULL REFERENCES dining_tables(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  guest_name text,
  opened_by_staff_id uuid REFERENCES staff_users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  cancelled_at timestamptz,
  settlement_bill_id uuid,
  version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_open
  ON table_sessions (table_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_request_id uuid NOT NULL UNIQUE,
  shop_id uuid NOT NULL REFERENCES shops(id),
  business_date date NOT NULL,
  token_no integer,
  source text NOT NULL CHECK (source IN ('counter','table_qr','remote_online')),
  fulfilment_type text NOT NULL DEFAULT 'counter' CHECK (fulfilment_type IN ('counter','dine_in','takeaway','pickup')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','preparing','ready','completed','cancelled')),
  price_type text NOT NULL DEFAULT 'retail' CHECK (price_type IN ('retail','wholesale')),
  table_session_id uuid REFERENCES table_sessions(id),
  table_id uuid REFERENCES dining_tables(id),
  customer_id uuid REFERENCES customers(id),
  customer_name_snapshot text,
  customer_mobile_snapshot text,
  customer_external_id_snapshot text,
  place_label_snapshot text,
  access_token_hash text,
  cashier_staff_id uuid REFERENCES staff_users(id),
  created_by_type text NOT NULL CHECK (created_by_type IN ('staff','customer','system')),
  subtotal_paisa integer NOT NULL DEFAULT 0 CHECK (subtotal_paisa >= 0),
  discount_paisa integer NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
  total_paisa integer NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),
  payment_method text,            -- Phase 1 DTO label: Cash/JazzCash/Easypaisa/Udhaar/Online/Counter
  tendered_paisa integer,
  change_paisa integer,
  payment_status text CHECK (payment_status IN ('proof_pending','confirmed','rejected')),
  proof_method text CHECK (proof_method IN ('JazzCash','Easypaisa','Raast','Bank')),
  proof_txn_ref text,
  proof_amount_paisa integer,
  proof_image text,               -- compressed data URL in the foundation build; file storage is a deployment step
  proof_uploaded_at timestamptz,
  reject_reason text,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
-- Per-shop tokens (Talha, 15 Nov 2026): canteen and grocery each run their
-- OWN daily token sequence starting at 1, so the uniqueness scope includes
-- shop_id. (The original all-shops index `orders_token_day` is dropped if
-- a pre-Part-A database still has it; it is never created any more — on a
-- database with per-shop data its CREATE would fail on legitimate
-- cross-shop token duplicates.)
DROP INDEX IF EXISTS orders_token_day;
CREATE UNIQUE INDEX IF NOT EXISTS orders_token_day_shop ON orders (business_date, shop_id, token_no) WHERE token_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_day_shop_status ON orders (business_date, shop_id, status, created_at);
CREATE INDEX IF NOT EXISTS orders_customer ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_session ON orders (table_session_id, created_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('menu_item','grocery_product')),
  menu_item_id uuid REFERENCES menu_items(id),
  grocery_product_id uuid REFERENCES grocery_products(id),
  grocery_variant_id uuid REFERENCES grocery_variants(id),
  grocery_packing_id uuid REFERENCES grocery_packings(id),
  item_name_snapshot text NOT NULL,
  variant_name_snapshot text,
  packing_label_snapshot text,
  unit_snapshot text NOT NULL DEFAULT 'piece',
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  contains_qty_snapshot numeric(12,3) NOT NULL DEFAULT 1,
  unit_price_paisa integer NOT NULL CHECK (unit_price_paisa >= 0),
  line_total_paisa integer NOT NULL CHECK (line_total_paisa >= 0),
  is_offer boolean NOT NULL DEFAULT false,  -- true when this line was charged at the product's active offer price (DTO appends " (Offer)" to the display name; receipts + print agent inherit it)
  UNIQUE (order_id, line_no)
);
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS is_offer boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS order_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users(id),
  actor_customer_id uuid REFERENCES customers(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES inventory_balances(id),
  entry_type text NOT NULL CHECK (entry_type IN ('opening','stock_in','wastage','sale','sale_reversal','adjustment')),
  qty_delta numeric(12,3) NOT NULL CHECK (qty_delta <> 0),
  qty_after numeric(12,3) NOT NULL CHECK (qty_after >= 0),
  order_line_id uuid REFERENCES order_lines(id),
  purchase_rate_paisa integer,
  supplier_id uuid REFERENCES suppliers(id),
  supplier_name_snapshot text,
  reason text,
  note text,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_entries_one_sale_per_line
  ON stock_entries (order_line_id) WHERE entry_type = 'sale' AND order_line_id IS NOT NULL;

-- ── Bills / payments / merchants ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no text NOT NULL UNIQUE,
  shop_id uuid NOT NULL REFERENCES shops(id),
  table_session_id uuid UNIQUE REFERENCES table_sessions(id),
  status text NOT NULL DEFAULT 'settled' CHECK (status IN ('open','settled','settled_on_credit','partially_settled','void')),
  subtotal_paisa integer NOT NULL DEFAULT 0,
  discount_paisa integer NOT NULL DEFAULT 0,
  total_paisa integer NOT NULL DEFAULT 0,
  amount_tendered_paisa integer NOT NULL DEFAULT 0,
  amount_on_udhaar_paisa integer NOT NULL DEFAULT 0,
  change_paisa integer NOT NULL DEFAULT 0,
  created_by_staff_id uuid REFERENCES staff_users(id),
  settled_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  voided_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bill_orders (
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  PRIMARY KEY (bill_id, order_id)
);

CREATE TABLE IF NOT EXISTS merchant_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES shops(id),
  provider text NOT NULL CHECK (provider IN ('jazzcash','easypaisa','raast','bank','other')),
  display_name text NOT NULL,
  merchant_ref_masked text,
  qr_payload text,
  qr_image_path text,
  qr_mode text NOT NULL DEFAULT 'static' CHECK (qr_mode IN ('static','dynamic_api')),
  is_active boolean NOT NULL DEFAULT true,
  config_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Merchant QR images (Talha's official JazzCash/Easypaisa/Raast/Bank QRs):
-- stored as bytea IN the database so the daily pg_dump backup carries them
-- with everything else — no upload-folder path to lose on the shop PC.
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS qr_image bytea;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS qr_image_mime text;
ALTER TABLE merchant_accounts DROP CONSTRAINT IF EXISTS merchant_accounts_provider_check;
ALTER TABLE merchant_accounts ADD CONSTRAINT merchant_accounts_provider_check CHECK (provider IN ('jazzcash','easypaisa','raast','bank','other'));

CREATE TABLE IF NOT EXISTS udhaar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id),
  external_id text,
  display_name text NOT NULL,
  mobile text,
  identity_key text NOT NULL UNIQUE,
  credit_limit_paisa integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid REFERENCES bills(id),
  udhaar_account_id uuid REFERENCES udhaar_accounts(id),
  payment_kind text NOT NULL CHECK (payment_kind IN ('tender','udhaar_charge','udhaar_repayment','refund')),
  method text NOT NULL CHECK (method IN ('cash','jazzcash','easypaisa','raast','bank','udhaar','other')),
  amount_paisa integer NOT NULL CHECK (amount_paisa > 0),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('initiated','pending_confirmation','confirmed','failed','refunded')),
  merchant_account_id uuid REFERENCES merchant_accounts(id),
  provider_reference text,
  qr_payload_snapshot text,
  confirmed_by_staff_id uuid REFERENCES staff_users(id),
  provider_event_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  failed_at timestamptz
);

-- Udhaar wasooli "Bank" method — older DBs were created without 'bank' in the
-- payments method CHECK; widen it idempotently (no-op content on fresh DBs).
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('cash','jazzcash','easypaisa','raast','bank','udhaar','other'));

CREATE TABLE IF NOT EXISTS payment_allocations (
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount_paisa integer NOT NULL CHECK (amount_paisa > 0),
  PRIMARY KEY (payment_id, bill_id)
);

CREATE TABLE IF NOT EXISTS udhaar_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  udhaar_account_id uuid NOT NULL REFERENCES udhaar_accounts(id),
  entry_type text NOT NULL CHECK (entry_type IN ('charge','payment','adjustment','reversal')),
  amount_paisa integer NOT NULL CHECK (amount_paisa <> 0),
  balance_after_paisa integer NOT NULL,
  bill_id uuid REFERENCES bills(id),
  payment_id uuid REFERENCES payments(id),
  note text,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Printing / realtime / audit / backups ────────────────────────────────────
CREATE TABLE IF NOT EXISTS print_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  machine_name text,
  token_hash text,
  last_seen_at timestamptz,
  version text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES shops(id),
  role text NOT NULL CHECK (role IN ('receipt','kitchen','label')),
  display_name text NOT NULL,
  connection_type text NOT NULL DEFAULT 'network_tcp' CHECK (connection_type IN ('network_tcp','windows_usb','windows_shared')),
  address text,
  agent_id uuid REFERENCES print_agents(id),
  paper_width_mm integer,
  label_width_mm integer,
  label_height_mm integer,
  command_language text CHECK (command_language IN ('escpos','tspl','zpl','driver')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  printer_id uuid REFERENCES printers(id),
  job_type text NOT NULL CHECK (job_type IN ('receipt','kitchen_ticket','barcode_label','table_card')),
  bill_id uuid REFERENCES bills(id),
  order_id uuid REFERENCES orders(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','printed','failed','cancelled')),
  is_reprint boolean NOT NULL DEFAULT false,
  reprint_of_job_id uuid REFERENCES print_jobs(id),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  requested_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  printed_at timestamptz
);
-- Print agent claim ownership (plan §1.5): set when an agent claims a job via
-- POST /api/v1/agent/jobs/next; complete/fail are accepted only from that agent.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS claimed_by_agent_id uuid REFERENCES print_agents(id);
-- Device Setup (owner "🖨️ Printers & Devices"): the agent reports the printers
-- it can reach in every heartbeat ([{ name, kind: 'windows'|'tcp'|'file',
-- address? }]) — the owner picks one per role (printers rows) from THIS list,
-- so nobody ever types a printer name or an IP by hand.
ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS available_printers jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS print_jobs_queue ON print_jobs (status, created_at);

-- Menu Board offers flag: owner marks a grocery product to appear on the
-- /menu-board "🎉 Aaj ki Offers" slide (Phase 1 boardOffer, ported).
ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS board_offer boolean NOT NULL DEFAULT false;

-- Offer price (Phase 1 offerPrice, ported): the REAL discounted retail the
-- owner sets for a board-offer product; charged at the till as well.
ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS offer_price_paisa integer CHECK (offer_price_paisa IS NULL OR offer_price_paisa > 0);

CREATE TABLE IF NOT EXISTS event_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text,
  shop_id uuid REFERENCES shops(id),
  audience_scope text NOT NULL DEFAULT 'staff',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_outbox_id ON event_outbox (id);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type text NOT NULL,
  actor_staff_id uuid REFERENCES staff_users(id),
  actor_customer_id uuid REFERENCES customers(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  file_name text,
  storage_location text,
  size_bytes bigint,
  sha256 text,
  database_from text,
  app_version text,
  error text,
  verified_restore_at timestamptz
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PORT B (15 Nov 2026): Deals · Profit & Loss · Business Setup extras ·
-- Account verification. All idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Canteen Deals (KFC-style combos: many menu items, ONE deal price) ──────
CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  shop_id uuid NOT NULL REFERENCES shops(id),
  name text NOT NULL,
  price_paisa integer NOT NULL CHECK (price_paisa > 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS deal_items (
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id),
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (deal_id, menu_item_id)
);

-- Deal order lines: item_kind gains 'deal'; the line carries the deal FK
-- plus a components snapshot (names + qtys at order time — the kitchen and
-- P&L read the SNAPSHOT, never the live deal) and mobile serials (IMEI).
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id);
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS components jsonb;
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS serials jsonb;
ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_item_kind_check;
ALTER TABLE order_lines ADD CONSTRAINT order_lines_item_kind_check
  CHECK (item_kind IN ('menu_item','grocery_product','deal'));

-- A deal line expands into one 'sale' stock entry PER COMPONENT inventory;
-- the exactly-once guard therefore scopes per (line, inventory), not per line.
DROP INDEX IF EXISTS stock_entries_one_sale_per_line;
CREATE UNIQUE INDEX IF NOT EXISTS stock_entries_one_sale_per_line_inv
  ON stock_entries (order_line_id, inventory_id) WHERE entry_type = 'sale' AND order_line_id IS NOT NULL;

-- ── Profit & Loss ───────────────────────────────────────────────────────────
-- Menu item LAGAT (cost): owner-entered; NULL = not filled (P&L treats the
-- item's sales as lagat-baqi, NEVER as zero cost).
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost_paisa integer CHECK (cost_paisa IS NULL OR cost_paisa >= 0);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  title text NOT NULL,
  amount_paisa integer NOT NULL CHECK (amount_paisa > 0),
  shop text NOT NULL CHECK (shop IN ('canteen','grocery','both')),
  expense_date date NOT NULL,
  note text,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS expenses_date ON expenses (expense_date);

-- ── Business Setup trade extras ─────────────────────────────────────────────
-- Mobile shops: serial-tracked products (IMEI lazmi at sale time).
ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS track_serial boolean NOT NULL DEFAULT false;
-- Medical shops: optional expiry (YYYY-MM) recorded on stock-IN entries.
ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS expiry text;

-- ── Customer account verification (Talha's final design, 15 Nov 2026) ──────
-- Email is MANDATORY at registration and its code MUST be confirmed before
-- the account can order; the mobile code is OPTIONAL (Skip allowed) and a
-- verified mobile is kept as a flag. Pre-existing accounts are grandfathered
-- as email-verified (the UPDATE below runs once — the column default for
-- NEW rows is false, and the UPDATE only fires while the column is fresh:
-- it is guarded by the ADD COLUMN having just created it on old databases;
-- on fresh databases there are no customers yet, so it is a no-op).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS mobile_verified boolean NOT NULL DEFAULT false;
UPDATE customers SET email_verified = true WHERE email IS NULL AND email_verified = false;

CREATE TABLE IF NOT EXISTS verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','mobile')),
  code_hash text NOT NULL,  -- sha256(code + customer_id); the code itself is never stored
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_codes_lookup ON verification_codes (customer_id, channel, created_at DESC);

-- ── Kiraya / Rentals (17 Nov 2026) ──────────────────────────────────────────
-- Har dress EK unique piece (rental_items) — grocery packings se alag
-- entity. Booking par paisa: advance + pickup baqaya + wapsi settlement
-- (late fine / damage, security deposit se katoti). Money hamesha paisa
-- mein. advance_date / balance_date / settled_date = woh business dates
-- jin par woh paisa wasool hua — P&L ki cash-basis rental aamdani inhi
-- se banti hai (Phase 1 rentalMoneyEvents parity).
CREATE TABLE IF NOT EXISTS rental_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  name text NOT NULL,
  size text,
  color text,
  rent_per_day_paisa integer NOT NULL DEFAULT 0,
  security_deposit_paisa integer NOT NULL DEFAULT 0,
  offer_rent_per_day_paisa integer,  -- offer wala roz ka kiraya (NULL = koi offer nahi)
  board_offer boolean NOT NULL DEFAULT false,  -- board-offer flag (grocery offerPrice parity)
  emoji text NOT NULL DEFAULT '👗',
  image_url text,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,  -- multi photos (max 4); pehli = main
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','booked','out','cleaning','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rental_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  booking_no text NOT NULL,
  item_id uuid NOT NULL REFERENCES rental_items(id),
  item_name text NOT NULL,
  customer_name text NOT NULL,
  customer_mobile text NOT NULL,
  customer_cnic text,
  pickup_date date NOT NULL,
  return_date date NOT NULL,
  days integer NOT NULL DEFAULT 1,
  rent_per_day_paisa integer NOT NULL DEFAULT 0,
  list_rent_per_day_paisa integer,  -- offer lagi ho to dress ka ASAL roz ka kiraya (snapshot)
  rent_total_paisa integer NOT NULL DEFAULT 0,
  security_deposit_paisa integer NOT NULL DEFAULT 0,
  security_kind text NOT NULL DEFAULT 'Cash' CHECK (security_kind IN ('Cash','CNIC','Cheque')),
  advance_paid_paisa integer NOT NULL DEFAULT 0,
  balance_paid_paisa integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','out','completed','cancelled')),
  advance_date date,
  balance_date date,
  settled_date date,
  picked_up_at timestamptz,
  returned_at timestamptz,
  actual_return_date date,
  late_days integer NOT NULL DEFAULT 0,
  late_fine_per_day_paisa integer NOT NULL DEFAULT 0,
  late_fine_paisa integer NOT NULL DEFAULT 0,
  damage_charges_paisa integer NOT NULL DEFAULT 0,
  damage_note text,
  return_condition text CHECK (return_condition IS NULL OR return_condition IN ('theek','damage','cleaning')),
  security_deducted_paisa integer NOT NULL DEFAULT 0,
  security_refunded_paisa integer NOT NULL DEFAULT 0,
  extra_due_paisa integer NOT NULL DEFAULT 0,
  created_by_staff_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_bookings_status ON rental_bookings (status, return_date);
CREATE INDEX IF NOT EXISTS rental_bookings_item ON rental_bookings (item_id);
-- Rental offers + multi-photo columns on pre-existing databases (idempotent).
ALTER TABLE rental_items ADD COLUMN IF NOT EXISTS offer_rent_per_day_paisa integer;
ALTER TABLE rental_items ADD COLUMN IF NOT EXISTS board_offer boolean NOT NULL DEFAULT false;
ALTER TABLE rental_items ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rental_bookings ADD COLUMN IF NOT EXISTS list_rent_per_day_paisa integer;
-- Rental categories + quantities on pre-existing databases (idempotent).
ALTER TABLE rental_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE rental_items ADD COLUMN IF NOT EXISTS total_qty integer NOT NULL DEFAULT 1;
ALTER TABLE rental_bookings ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1;
-- Multi-photo (photo-spin) columns on pre-existing databases (idempotent):
-- canteen menu items + grocery products bhi ab rental items ki tarah
-- images[] rakhte hain — boards ka "ghumta hua" view inhi par banta hai.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE grocery_products ADD COLUMN IF NOT EXISTS image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Rentals tab grant: purani databases par tab_key CHECK mein 'rentals'
-- shamil karo (idempotent — constraint dobara banana safe hai).
ALTER TABLE staff_tab_grants DROP CONSTRAINT IF EXISTS staff_tab_grants_tab_key_check;
ALTER TABLE staff_tab_grants ADD CONSTRAINT staff_tab_grants_tab_key_check
  CHECK (tab_key IN ('canteen','grocery','rentals','kitchen','stock','owner','online'));
