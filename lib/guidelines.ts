export type GuidelineKey =
  | "canteen"
  | "grocery"
  | "kitchen"
  | "stock"
  | "online"
  | "owner-overview"
  | "owner-menu"
  | "owner-grocery"
  | "owner-udhaar"
  | "owner-heads"
  | "owner-labels"
  | "owner-staff"
  | "owner-settings"
  | "owner-tables"
  | "owner-pnl"
  | "owner-setup";

export interface GuidelineEntry {
  title: string;
  steps: string[];
  tips?: string[];
}

export const GUIDELINE_KEYS: GuidelineKey[] = [
  "canteen",
  "grocery",
  "kitchen",
  "stock",
  "online",
  "owner-overview",
  "owner-menu",
  "owner-grocery",
  "owner-udhaar",
  "owner-heads",
  "owner-labels",
  "owner-staff",
  "owner-settings",
  "owner-tables",
  "owner-pnl",
  "owner-setup",
];

export const GUIDELINES: Record<GuidelineKey, GuidelineEntry> = {
  canteen: {
    title: "🍽️ Canteen POS — Bill Banana",
    steps: [
      "Apne naam wale card aur PIN se login karein; upar Canteen POS tab khula rakhein.",
      "Pehle Category chip chunein, phir item ki tile dabayein — item Current Bill mein add ho jayega.",
      "Quantity tile par ya bill line mein − / + se badlein; ek line hatani ho to ✕ aur poora bill saaf karna ho to Clear dabayein.",
      "Payment se pehle items, Subtotal aur GRAND TOTAL customer ke samne check karein.",
      "PAY / Charge dabayein; agar discount dena hai to Payment window mein Rs ya % chunein aur value likhein.",
      "Cash mein + Rs 100 / 500 / 1000 ya Exact dabayein aur Change (Baqaya) bata dein; JazzCash ya Easypaisa mein payment milne ki tasdeeq ke baad aage barhein.",
      "Udhaar ho to Customer / Student / Staff name (khata) lazmi likhein — baghair naam ke Complete nahi hoga.",
      "✓ Complete — Get Token dabayein; customer ko Token Number batayein, chahein to Print Bill (80mm) karein, phir + New Order se agla bill shuru karein.",
    ],
    tips: [
      "Dhyaan dein: upar Sound ON rakhein taake online order ki awaaz aur banner miss na ho.",
      "⏳ Payment tasdeeq baqi wala order Kitchen nahi jata; Owner ke confirm karne ke baad hi token banta hai.",
    ],
  },

  grocery: {
    title: "🛒 Grocery POS — Counter Sale",
    steps: [
      "Apne naam aur PIN se login karein; scan box par focus rehne dein, taake scanner ki entry seedha bill mein jaye.",
      "Bill shuru karne se pehle Current Bill ke Bill Price Type mein 🏷️ Retail ya 📦 Wholesale chunein — prices isi ke hisaab se badalti hain.",
      "Barcode scanner se scan karke Enter karein; packed item barcode se aur loose item SKU/PLU code ya tile se add karein. Camera ho to 📷 Camera Scan bhi use kar sakte hain.",
      "Search, Main Head aur Sub-Head chips se product dhoondein; tile dabane se item bill mein aayega.",
      "Flavour/packing wale product par pehle variant (flavour) chunein, phir packing (size); chooser ya bill line mein − / + se quantity set karein aur ✓ Ho gaya — Bill dekhein dabayein.",
      "Per-kg item 0.5 kg steps mein add hota hai; bill line ke − / + se 0.5, 1.0 ya 1.5 kg waghera theek karein.",
      "🌐 Online Orders — Packing Queue aye to pehle 📦 Start Packing, samaan tayyar hone par ✓ Ready for Pickup dabayein; ye orders Kitchen nahi jate.",
      "PAY / Charge dabayein, zaroorat ho to Discount likhein, phir Cash, JazzCash, Easypaisa ya Udhaar chunein; Udhaar par customer name (khata) lazmi hai.",
      "✓ Complete Sale dabayein; Print Bill (80mm) ya + New Sale chunein. Sale complete hote hi stock khud kam ho jata hai.",
    ],
    tips: [
      "Dhyaan dein: Wholesale line par red minimum warning aye to pehle quantity poori karein — warning ke sath bill complete nahi hoga.",
      "Unknown code par red Item not found aye to code dobara check karein; search se product dhoond kar hi bill mein add karein.",
    ],
  },

  kitchen: {
    title: "👨‍🍳 Kitchen — Tokens Tayyar Karna",
    steps: [
      "Apne naam aur PIN se login karein; Kitchen screen khuli rakhein — naye tokens khud aa jate hain.",
      "Naya order aane par awaaz/banner aye to pehle ✓ Dekh Liya dabayein, phir token card par items aur quantity dhyaan se parhein.",
      "Card ka source label check karein: 🏪 COUNTER, 🍽️ DINE-IN — TABLE, 🥡 TAKEAWAY ya 🌐 ONLINE; dine-in ka khana sahi table ke hisaab se alag rakhein.",
      "Khana banana shuru karte hi 🍳 Start Preparing dabayein, taake status PENDING se PREPARING ho jaye.",
      "Poora order tayyar ho jaye to bara ✓ READY button dabayein; sirf usi token ko Ready karein jo mukammal ho.",
      "Ready today wali list se token dobara check karke counter/table par bhejein.",
    ],
    tips: [
      "Dhyaan dein: Grocery orders Kitchen nahi aate — woh Grocery POS ki packing queue mein jate hain.",
      "Payment proof pending online order yahan nazar nahi ayega; Owner confirm karega to token ke sath khud aa jayega.",
    ],
  },

  stock: {
    title: "📦 Stock — Scan / Stock IN aur Wastage",
    steps: [
      "Apne naam aur PIN se login karein; pehle 🍽️ Canteen Stock ya 🛒 Grocery Stock chunein.",
      "Stock IN ke liye green ➕ Stock IN (kharid) chunein; Wastage ke liye red 🗑️ Wastage (zaya) chunein.",
      "SAB SE ASAAN TAREEQA — barcode scan: upar scan wala box khud focus mein rehta hai; scanner se product ya packing ka barcode scan karein, sahi item khud select ho jayega. Packing ka barcode scan ho to wahi variant/packing bhi sath select ho jati hai.",
      "Scanner na ho to Search box mein naam likh kar item chunein; Grocery mein barcode ya SKU likh kar Enter karne se bhi sahi item select ho jata hai.",
      "Item select hone ke baad mojooda stock check karein — ghalat item select ho to pehle sahi item par click karein.",
      "Stock IN mein QUANTITY aur PURCHASE RATE (Rs) lazmi bharein; SUPPLIER ho to likh dein, phir ➕ Stock IN — Save Entry dabayein.",
      "Wastage mein QUANTITY aur REASON (Expired, Damaged, Spilled ya Other) chunein, phir 🗑️ Wastage — Save Entry dabayein.",
      "Save ke baad green ✓ message aur right side Stock Entries — Recent mein apni entry zaroor check karein.",
      "Neeche 📋 Mojooda Stock mein LOW ya KHATAM items dekhein aur Owner ko bata dein; prices yahan badalne ki koshish na karein.",
      "Medical Store setup mein Stock IN karte waqt EXPIRY (mahina/saal) bhi bhar dein — upar ⏰ Expiry Qareeb wali list mein woh dawaiyan khud ayengi jin ki expiry 30 din ke andar hai ya guzar chuki hai.",
      "Medical expiry sirf WARNING hai — batch-wise hisaab (konsi batch ki dawai pehle biki) is version mein nahi hai; expiry ke qareeb wali dawai pehle nikaalna staff ki zimmedari hai.",
    ],
    tips: [
      "Dhyaan dein: Scan par '✕ Product nahi mila' aye to woh product system mein hai hi nahi — pehle Owner ko Dashboard se add karna hoga; stock wala banda naya product nahi bana sakta.",
      "Wastage mojooda stock se zyada nahi ho sakti; ghalat quantity save karne se pehle dobara gin lein. Selling price yahan sirf dikhti hai — rate ya product ki detail badalna Owner Dashboard ka kaam hai.",
    ],
  },

  online: {
    title: "📱 Online Order — Customer Guide",
    steps: [
      "Table par hon to table ka QR scan karein ya I am at a Table chunein; hostel/office se hon to Order Online — Hostel / Office chunein.",
      "Table flow mein apna Name aur sahi Table Number likhein, phir 🍽️ Dine-In ya 🥡 Takeaway chunein — is flow mein account nahi chahiye.",
      "Remote order ke liye Login karein ya Create Account mein Full Name, Mobile Number, Password aur Place/Room ya Office detail bharein; mobile hi login hota hai.",
      "Ek order mein sirf ek shop chunein: Canteen Order ya Grocery Order. Doosri shop ke liye alag order karein.",
      "Items par ＋ Add to Cart dabayein aur − / + se quantity theek karein; neeche cart bar se Your Cart khol kar items aur TOTAL check karein.",
      "Table order mein 💵 Cash chunein to order seedha Kitchen jata hai aur token milta hai; 📱 Online Payment chunein to pehle shop number par payment karna hoti hai.",
      "Online Payment mein JazzCash, Easypaisa, Raast ya Bank chunein, payment karein, Transaction ID ho to likhein aur payment screenshot (proof) lazmi upload karein — baghair proof Place Order nahi chalega.",
      "✓ Place Order dabayein. Payment proof wale order par ⏳ Payment Tasdeeq Baqi ayega; shop confirm karegi to token aur status milega, reject ho to wajah ke sath My Orders se Dobara Proof Upload Karein.",
      "Status screen ya 📦 My Orders mein apna order dekhein; Ready hone par canteen ya grocery counter se pickup karein. Udhaar sirf tab hoga jab account/table flow mein required ID mojood ho.",
      "Agar payment wale hisay mein shop ka bara QR code dikh raha ho to number likhne ki zaroorat nahi: apne JazzCash / Easypaisa / banking app se usi QR ko scan karke payment karein — phir bhi neeche screenshot (proof) upload karna lazmi hai.",
    ],
    tips: [
      "Dhyaan dein: Agar 🛑 Abhi band hai wala popup aye to online order nahi hoga — screen par diye number par 📞 Call ya 💬 WhatsApp karein, ya 🔄 Dobara check karein dabayein.",
      "Remote order mein Cash option nahi hota; pehle payment aur proof, phir shop ki tasdeeq lazmi hai.",
    ],
  },

  "owner-overview": {
    title: "📊 Owner Overview — Sale, Bills aur Tasdeeq",
    steps: [
      "Owner PIN se login karke Owner Dashboard ke 📊 Overview tab par ayen; upar Today strip mein Canteen, Grocery, Counter, Online aur Low Stock ka khulasa dekhein.",
      "KPI cards mein Today's Total Sales, Orders Today, Cash, Online (JazzCash + Easypaisa) aur Udhaar (Khata) check karein.",
      "Overview tab par ⏳ badge ho to 💳 Online Payment Verification mein pending orders pehle check karein.",
      "Har verify card par customer, items, total, Method aur Txn ID dekhein; proof ki chhoti picture par click karke 🔍 Bara dekhein.",
      "Customer ne bheja wala amount order total se match ho aur proof sahi ho to ✅ Confirm — Order Aage Bhejein dabayein; is waqt token banta hai aur order Kitchen ya packing queue mein jata hai.",
      "Proof ghalat ho ya amount match na ho to ❌ Reject dabayein aur prompt mein saaf wajah likhein; stock wapas ho jayega aur customer ko wajah nazar ayegi.",
      "🏆 Best Sellers Today se zyada bikne wali items dekhein; kisi purani entry ko dekhna ho to 🧾 Bill History — Today mein bill par click karein.",
      "Bill khul jaye to receipt check karein aur zaroorat ho to 🖨️ Reprint (80mm) dabayein; kaam khatam ho to ✕ Close karein.",
    ],
    tips: [
      "Dhyaan dein: ⚠️ AMOUNT MATCH NAHI wali warning par Confirm bilkul na karein — pehle asal payment verify karein.",
      "Overview sirf aaj ka khulasa dikhata hai; Low Stock ki tafseel ke liye Stock tab dekhein.",
    ],
  },

  "owner-menu": {
    title: "🍽️ Owner — Canteen Item ADD / UPDATE",
    steps: [
      "Owner Dashboard ke 🍽️ Canteen Menu tab par ayen — upar item form aur neeche menu table hai.",
      "ADD karna: form ke labeled boxes bharein — ITEM NAME, PRICE RS, EMOJI aur CATEGORY — phir green + Add Item dabayein; item table aur Canteen POS dono par aa jayega.",
      "UPDATE karna: neeche table mein sahi item ki row se Edit dabayein.",
      "Edit dabate hi wahi item upar form mein bhar jayega; sirf jo box badalna hai — naam, price, emoji ya category — usi ko change karein.",
      "UPDATE save karna: green Save Edit dabayein. Agar irada badal jaye to Cancel dabayein, baghair save kiye wapas aa jayenge.",
      "DELETE karna: item ki row ka red ✕ dabayein — ye kaam soch kar karein, delete ke baad item POS par nahi rahega.",
      "Table ke Stock column mein mojooda stock dekhein; roz ki stock entry kabhi yahan se na karein.",
      "DEAL banana (🎁 Deals section, isi tab mein neeche): DEAL NAME aur DEAL PRICE RS likhein, phir neeche picker mein har item ki qty rakhein jo ek deal mein jayegi (0 = deal mein nahi). Neeche readout mein kul qeemat, deal price aur bachat live dikhta hai — phir green + Add Deal dabayein.",
      "Deal UPDATE karna: Deals list mein us deal ki Edit dabayein — naam, price aur picker ki qty form mein bhar jayengi; badal kar Save Edit dabayein. Deal band karna ho to usi row ka Active wala button Off kar dein — deal POS, Online aur Menu Board teeno se ghayab ho jayegi, delete karne ki zaroorat nahi.",
    ],
    tips: [
      "Dhyaan dein: Canteen rates aur item details yahin Edit se badalte hain; Stock IN / Wastage ki asal entry Stock tab se hoti hai taake entries log banay rahe.",
      "Current menu sample hai — asal dukaan ka menu aur rates pehle yahin se set karein.",
    ],
  },

  "owner-grocery": {
    title: "🛒 Owner — Grocery Product ADD / UPDATE",
    steps: [
      "Owner Dashboard ke 🛒 Grocery tab par ayen — upar product form, neeche search/filter wali products table aur pagination hai.",
      "ADD karna: labeled boxes bharein — PRODUCT NAME, BRAND / COMPANY (e.g. Sunsilk), SKU, EAN BARCODE (packed item ho to), RETAIL PRICE RS, WHOLESALE PRICE RS, WHOLESALE MIN QTY (khali = shop default), UNIT (per piece ya per kg), MAIN HEAD, SUB-HEAD, EMOJI aur IMAGE URL (optional).",
      "STOCK QTY wala box is form mein band (read-only) hai — stock yahan se NAHI badalta; naya product 0 stock ke sath banta hai, phir Stock tab se Stock IN karein.",
      "Size add karna ho to 📦 Packings mein + Packing dabayein; har row mein PACKING SIZE, RETAIL PRICE RS, WHOLESALE PRICE RS, BARCODE, CONTAINS (PACKS) aur WS MIN (PACKS) likhein. Ghalat row ka red ✕ dabayein; koi size na ho to Packings khali chhor dein.",
      "Phir green + Add Product dabayein; product table mein aa jayega. List lambi ho to search, Head/Sub-Head filter aur Prev / Next se dhoondein.",
      "UPDATE karna: product ki row se Edit dabayein — poora form usi product se bhar jayega, Packings bhi wapas aa jayengi.",
      "Jo rate ya detail badalni ho labeled box mein change karein aur green Save Edit dabayein; na badalna ho to Cancel dabayein.",
      "FLAVOUR add karna (Edit ke doran): neeche 🎨 Variants wale hisse mein NEW VARIANT NAME likh kar + Variant Add dabayein, phir us variant ki packing — size, rates aur apna barcode — + Variant Packing se add karein. Jis product ke flavours na hon us ka sirf Standard variant rehta hai.",
      "DELETE karna: product ki row ka red ✕ dabayein — pehle naam aur SKU dobara check kar lein.",
    ],
    tips: [
      "Dhyaan dein: Packing alag product nahi hoti — 500g / 1kg / 2kg usi product ke sizes hain; CONTAINS batata hai ke dabbe mein kitne sealed packs hain, stock unhi base packs mein ginta hai.",
      "Company alag = product alag (Sunsilk alag, Pantene alag); ek hi company ke flavours usi product ke VARIANTS hain. Product tabhi sahi bane ga jab us ka Main Head aur Sub-Head pehle Heads tab mein mojood ho.",
      "Rates/details hamesha Edit se badalte hain; roz ki Stock IN aur Wastage hamesha Stock tab se hoti hai — wahan barcode scan se entry sab se tez hai.",
    ],
  },

  "owner-udhaar": {
    title: "💰 Owner — Udhaar Khata aur Wasooli",
    steps: [
      "Owner Dashboard ke 💰 Udhaar Khata tab par ayen; upar Kul Baqaya — Sab Khaatay mein tamam customers ka total baqaya nazar ata hai.",
      "Khata kholna: list mein customer ki row dabayein (Naam, ID/Mobile, Kul Udhaar, Wasool aur Baqaya wali row). Naam, Student/Staff ID ya mobile likh kar 🔍 search se khata jaldi bhi dhoonda ja sakta hai.",
      "Khaata khulte hi neeche 📜 Khata Ledger mein har entry tareekh ke sath ati hai — 🧾 Udhaar Charge (Bill number ke sath), 💰 Wasooli (method ke sath), har entry ke baad wala Baqaya aur Darj Kiya (kis ne darj ki).",
      "Wasooli darj karna: 💰 Wasooli Darj Karein wale hisse mein RAQAM (Rs) likhein — aadhi wasooli ho to sirf utni hi raqam likhein jitni asal mili hai.",
      "METHOD chunein: 💵 Cash, 📱 JazzCash, 📱 Easypaisa, 🏦 Raast ya 🏦 Bank Transfer; zaroorat ho to NOTE (Optional) mein tafseel likh dein.",
      "✓ Wasooli Darj Karein dabayein; ✓ wala message ayega aur khaatay ka naya baqaya foran nazar ayega — ledger mein nayi wasooli entry bhi aa jayegi.",
      "Baqaya check karna: list ki har row par Baqaya laal rang mein aur Clear khata sabz ✓ Clear mein dikhta hai; kisi khaatay ka poora hisaab ledger ke aakhri Baqaya se match karein.",
    ],
    tips: [
      "Dhyaan dein: Wasooli baqaya se zyada darj nahi ho sakti — system rok dega. Zyada raqam mili ho to pehle customer se wajah confirm karein, ghalti ho to Owner adjustment alag entry se hoti hai.",
      "Wasooli hamesha isi screen se darj karein — bill ko edit/delete karke udhaar kabhi adjust na karein; ledger hi asal khata hai.",
    ],
  },

  "owner-heads": {
    title: "🗂️ Owner — Heads aur Sub-Heads",
    steps: [
      "Owner Dashboard ke 🗂️ Heads tab par ayen; structure hamesha Main Head → Sub Head → Product hoti hai.",
      "Naya Main Head add karna: head ka naam likhein, emoji chunein, image ho to Head Image URL likhein aur + Add Head dabayein.",
      "Naya Sub-Head add karna: pehle sahi Main Head chunein, sub-head ka naam likhein, image ho to URL likhein aur + Add Sub-Head dabayein.",
      "Head ki tafseel dekhna ho to us ki row ka ▶ dabayein; andar us ke sub-heads aur har ek ki product count nazar ayegi.",
      "Rename karna: Head ya Sub-Head ki row se Rename dabayein, naam ya image badlein aur Save dabayein; Cancel se purana naam wapas rahega.",
      "Delete se pehle Grocery tab mein us head/sub-head ke products ko Edit karke doosre head/sub-head mein shift karein.",
      "DELETE tabhi hoga jab product count 0 ho; row ka Delete dabayein. Khali head delete ho to us ke khali sub-heads bhi sath khatam ho jate hain.",
    ],
    tips: [
      "Dhyaan dein: Jis head mein koi sub-head nahi, us mein product add nahi ho sakta — pehle kam az kam ek sub-head banayein.",
      "Naam chhota aur saaf rakhein taake POS chips aur reports mein asaani se parha jaye.",
    ],
  },

  "owner-labels": {
    title: "🏷️ Owner — Barcode Stickers Print Karna",
    steps: [
      "Owner Dashboard ke 🏷️ Labels tab par ayen; ek product ka sticker Grocery table ki row ke 🏷️ Label button se bhi khul sakta hai.",
      "Search, Head aur Sub-Head filter se products shortlist karein.",
      "Har product ke checkbox ko tick karein; ☑️ Visible sab select se screen par nazar ane wale sab select aur ✕ Clear se sab clear ho jate hain.",
      "Select shuda product ke samne Stickers wale box mein tadaad likhein — jitni likhein ge, print sheet mein utne stickers banenge.",
      "🖨️ Print Labels dabayein; sheet khul jaye to Har product ke stickers wali quantity dobara check karein.",
      "🖨️ Print dabayein aur print dialog mein label printer chunein; sticker size 50mm × 30mm hai.",
      "Kaam khatam ho to sheet ke ✕ Band karein button se wapas ayen aur ek sticker counter scanner se test scan zaroor karein.",
    ],
    tips: [
      "Dhyaan dein: Sticker par product ka naam aur retail price ata hai; barcode na ho to SKU hi Code128 barcode ban jata hai.",
      "Loose ya shop-packed cheezon par sticker pehle lagayein, phir shelf par rakhein — baghair sticker scan mushkil hoga.",
    ],
  },

  "owner-staff": {
    title: "🔐 Owner — Staff Access aur PIN",
    steps: [
      "Owner Dashboard ke 🔐 Staff tab par ayen; list mein har banday ka naam, masked PIN aur us ke tabs ke chips nazar ayenge.",
      "Naya staff ADD karna: Naam likhein, theek 4 digits ka PIN likhein aur sirf wohi tabs tick karein jo us ke kaam ke hain.",
      "Phir + Add Staff dabayein; naya banda apne naam wale card aur naye PIN se login karega — PIN server par check hota hai, kisi ek device par nahi.",
      "UPDATE karna: staff ki row se Edit dabayein; form bhar jayega. Naam, PIN ya tabs badlein aur Save Access dabayein; Cancel se koi change save nahi hoga.",
      "Ek banday ko kai tabs mil sakte hain, masalan Canteen + Grocery; Owner ke Owner Dashboard wala tab hamesha locked rehta hai.",
      "Apna Owner PIN badalna ho to Owner wali row ko Edit karein aur Save Access dabayein.",
      "Staff hatana ho to us ki row se Remove dabayein aur confirm karein — us ka login band ho jayega. Owner ko remove nahi kiya ja sakta.",
    ],
    tips: [
      "Dhyaan dein: Har banday ko sirf usi ke kaam ke tabs dein aur PIN kisi doosre se share na karne ki hidayat dein.",
      "PIN bhool jaye to Owner isi tab mein Edit karke naya 4-digit PIN set kar sakta hai.",
    ],
  },

  "owner-settings": {
    title: "⚙️ Owner — Shop Settings",
    steps: [
      "Owner Dashboard ke ⚙️ Settings tab par sab se upar Shop Status dekhein: 🟢 Shop KHULI hai ya 🔴 Shop BAND hai.",
      "Shop band karna ho to 🔴 Shop BAND kar dein dabayein; ye switch foran server par save hota hai aur /online par Closed popup aa jata hai. Dobara kholna ho to 🟢 Shop KHOL dein dabayein.",
      "Closed popup ka number badalna: CONTACT NUMBER (BAND HONE PAR) box mein asal number likhein — ye wala change neeche 💾 Save Settings dabane se save hota hai.",
      "COLLEGE NAME, CANTEEN NAME aur GROCERY STORE NAME bharein; ye naam header, bills, online page aur table QR cards par khud update ho jate hain.",
      "Online Payment Numbers mein JAZZCASH NUMBER, EASYPAISA NUMBER aur RAAST / BANK (IBAN) asal values likhein; demo numbers par asal payment na mangwayein.",
      "Merchant QR lagana: neeche 📷 Merchant QR Codes mein har method (JazzCash, Easypaisa, Raast, Bank) ke card par ACCOUNT TITLE aur NUMBER / IBAN check karke 💾 Title/Number dabayein, phir 📷 QR Upload se us method ki asal QR image (PNG/JPG) lagayein — preview aa jayega aur customer ko Online Payment mein wahi QR bara nazar ayega. QR badalna ho to 📷 QR Badlein, hatana ho to 🗑️ Remove dabayein; counter ke liye usi card se 🖨️ QR Stand print karke laga dein. QR upload foran save hota hai — Save Settings ki zaroorat nahi.",
      "Wholesale Minimums mein pieces aur kg ki default limit set karein; kisi ek product ki alag limit Grocery product form ke WHOLESALE MIN QTY se lagti hai.",
      "Saari values check karke 💾 Save Settings dabayein aur ✓ Saved wala message zaroor dekhein.",
      "Settings ke baad Online page ek dafa khol kar naam, payment number aur Shop Open/Band wali surat khud test karein.",
      "Sab se upar 🏪 Business Setup block mein apni maujooda business type (Sirf Canteen / Sirf Dukaan / Dono + dukaan ki qisam) dekhein; badalna ho to 🔁 Tabdeel karein dabayein — type badalne se koi data delete NAHI hota, sirf andar nazar ane wale hisse badalte hain.",
    ],
    tips: [
      "Dhyaan dein: Shop Status switch foran save hota hai, lekin contact number, naam, payment numbers aur wholesale minimums ke liye Save Settings lazmi hai.",
      "Jab shop band ho to customers ko sirf Closed popup, contact number aur Call / WhatsApp button nazar ate hain — koi order place nahi hota.",
    ],
  },

  "owner-tables": {
    title: "🪑 Owner — Tables aur QR Cards",
    steps: [
      "Owner Dashboard ke 🪑 Tables QR tab par ayen; 🪑 Kul Tables ke samne abhi saved tadaad dekhein.",
      "Tadaad badalna: − ya + dabayein, ya box mein 1 se 100 tak number likhein — abhi ye sirf draft hai.",
      "✔ Apply dabayein aur '✓ Saved — ab N tables active hain' wala message dekhein; server par tables isi tadaad ke hisaab se active ho jati hain aur neeche bilkul utne hi table QR cards bante hain.",
      "🖨️ Print Table Cards dabayein, cards print karein aur har card ko usi number wali table par chipkayein.",
      "Customer Table 1 ka QR scan kare to Online page par Table 1 khud select hota hai; woh chahe to number ya Dine-In/Takeaway badal sakta hai.",
      "Tadaad kam karne se us se upar wali tables server par inactive ho jati hain — un par naya online order nahi aye ga, lekin purane orders aur bills ki table history bilkul nahi badalti.",
      "Tadaad change karne ke baad purane extra cards tables se hata dein aur naye cards ka ek QR khud scan karke test karein.",
    ],
    tips: [
      "Dhyaan dein: Apply dabaye baghair sirf − / + karne se saved tadaad, server ki tables aur online page — kuch nahi badalta.",
      "Aam canteen QR (baghair table ke) ke liye /online wala general link use hota hai; har table ke liye usi table ka apna card chipkayein.",
    ],
  },

  "owner-setup": {
    title: "🏪 Business Setup — Dukaan Ki Qisam",
    steps: [
      "Ye system pehli dafa chale to sab se pehle Business Setup ata hai: Step 1 mein 🍔 Sirf Canteen, 🛒 Sirf Dukaan ya 🏪 Dono chunein.",
      "Dukaan ho to Step 2 mein us ki qisam chunein — Grocery, Supermarket, Medical Store, Mobile Shop, Shoes, Kapre, Bakery waghera (14 qisamein). Har qisam ke sath us trade ke Heads aur kuch demo products khud aa jate hain taake system foran chal kar dikhe.",
      "Andar ka view isi choice se banta hai: jo dukaan off hai us ki tabs, Owner sections aur TV screens nahi dikhtein — direct link kholo to 'Ye Hissa On Nahi Hai' wala polite notice ata hai.",
      "Baad mein type badalna ho: Owner Dashboard → ⚙️ Settings → 🏪 Business Setup → 🔁 Tabdeel karein. Wahan maujooda choice pehle se selected hoti hai aur warning bhi likhi hoti hai.",
      "Type badalne se KOI data delete nahi hota — purane products, orders, bills aur hisaab mehfooz rehte hain; sirf nazar ane wale hisse badalte hain. Wapas purani type par ao to sab kuch waisa hi milega.",
      "Nayi qisam ka demo catalogue sirf TAB seed hota hai jab product list bilkul khali ho (fresh install) — data maujood ho to seeding kabhi nahi hoti, kuch overwrite nahi hota.",
      "Dukaan ka naam setup par template wala aam naam (masalan 'Medical Store') lagta hai agar naam abhi default ho — asal naam Settings mein CANTEEN/GROCERY NAME se apna likh dein.",
      "Do khaas extra: 💊 Medical Store mein stock-IN par dawai ki Expiry (mahina/saal) bhar sakte hain aur ⏰ Expiry Qareeb warning Stock screen aur Owner Overview par ati hai. 📱 Mobile Shop mein phone par 'Serial/IMEI wala product' tick karein — bikri par har unit ka IMEI lazmi likhna hoga aur bill par print hoga.",
    ],
    tips: [
      "Setup ek dafa hi karna hota hai — ghalat type chun li ho to ghabrayen nahi, Settings se kabhi bhi badal sakte hain, data mehfooz rehta hai.",
      "Demo products sirf sample hain — Owner Dashboard ke Grocery tab se apni asal products, rates aur stock daalein.",
      "Medical expiry sirf warning hai: batch-wise hisaab (konsi batch pehle biki) is version mein track nahi hota.",
    ],
  },

  "owner-pnl": {
    title: "📈 Owner — Munafa Nuqsan (Profit & Loss)",
    steps: [
      "Upar se period chunein — Aaj, Is Hafta, Is Mahina, Pichla Mahina, ya Custom tareekhein (From–To) rakhein. Saare hisaab usi period ke hain.",
      "Summary table parhein: Kul Bikri − Lagat = Gross Munafa; phir Kharchay aur Wastage Nuqsan minus hokar aakhir mein Khaals Munafa (Net) ata hai. Har dukaan ka column alag hai aur teesra Dono Mila Kar hai.",
      "Grocery ki lagat hamesha WHOLESALE price hai (wahi khareed rate hai) — is liye wholesale bills par munafa takreeban 0 ata hai, ye theek hai.",
      "Canteen item ka munafa tabhi gina jata hai jab us ki LAGAT bhari ho (Canteen Menu tab mein item Edit karke Lagat / Cost likhein). Jis item ki lagat nahi bhari, us ki bikri amber wale 'Lagat Baqi' hisse mein alag dikhti hai — munafa mein shamil NAHI hoti.",
      "Deal ka munafa us ke andar ki cheezon ki lagaton se banta hai — ek bhi cheez ki lagat missing ho to poori deal lagat-baqi mein jati hai.",
      "Kharcha darj karna: neeche form mein Tareekh, Kharcha kis cheez ka, Raqam aur Dukaan (Canteen / Grocery / Dono Dono) likh kar Add karein. 'Dono Dono' wala kharcha sirf combined column mein ginta hai. Galat entry Edit ya Delete kar sakte hain.",
      "Neeche per-item list mein har cheez ki bikri, lagat aur munafa hai — sab se zyada munafa dene wali cheez pehle; nuqsan wali lines red hain.",
      "Udhaar wali line sirf maloomat hai: is period mein kitna udhaar diya, kitni wasooli ayi, aur kul baqaya kitna hai (baqaya hamesha all-time hota hai). Udhaar ki bikri Kul Bikri mein pehle se shamil hai.",
    ],
    tips: [
      "Munafa tabhi sahi ayega jab lagat aur kharchay sahi bhare hon — canteen items ki lagat pehle din hi bhar dein, aur kharchay roz darj karein.",
      "Payment tasdeeq baqi (proof pending) ya reject hue online orders bikri mein NAHI ginte — confirm honay par hi woh sale banti hai.",
    ],
  }
};
