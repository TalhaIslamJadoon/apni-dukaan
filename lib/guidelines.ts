export type GuidelineKey =
  | "canteen"
  | "grocery"
  | "kitchen"
  | "stock"
  | "online"
  | "owner-overview"
  | "owner-menu"
  | "owner-grocery"
  | "owner-heads"
  | "owner-labels"
  | "owner-staff"
  | "owner-settings"
  | "owner-tables"
  | "owner-udhaar";

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
  "owner-heads",
  "owner-labels",
  "owner-staff",
  "owner-settings",
  "owner-tables",
  "owner-udhaar",
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
      "Packing wale product par packing chunein, phir chooser ya bill line mein − / + se quantity set karein aur ✓ Ho gaya — Bill dekhein dabayein.",
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
    title: "📦 Stock — Stock IN aur Wastage",
    steps: [
      "Apne naam aur PIN se login karein; pehle 🍽️ Canteen Stock ya 🛒 Grocery Stock chunein.",
      "Stock IN ke liye green ➕ Stock IN (kharid) chunein; Wastage ke liye red 🗑️ Wastage (zaya) chunein.",
      "Barcode wala product ho to upar 🔫 Barcode Scan box mein scanner se scan karein ya packing EAN, product barcode ya SKU/PLU likh kar Enter dabayein — green toast ke sath product khud select ho jayega.",
      "Selected wala khana aur mojooda stock check karein; yahi selection Stock IN aur Wastage dono mein use hogi. Quantity, Purchase Rate/Supplier ya Wastage ki wajah phir bhi manual bharni hai.",
      "Stock IN mein QUANTITY aur PURCHASE RATE (Rs) lazmi bharein; SUPPLIER ho to likh dein, phir ➕ Stock IN — Save Entry dabayein.",
      "Wastage mein QUANTITY aur REASON (Expired, Damaged, Spilled ya Other) chunein, phir 🗑️ Wastage — Save Entry dabayein.",
      "Save ke baad green ✓ message aur right side Stock Entries — Recent mein apni entry zaroor check karein.",
      "Neeche 📋 Mojooda Stock mein LOW ya KHATAM items dekhein aur Owner ko bata dein; prices yahan badalne ki koshish na karein.",
    ],
    tips: [
      "Dhyaan dein: Wastage mojooda stock se zyada nahi ho sakti; ghalat quantity save karne se pehle dobara gin lein.",
      "Unknown barcode par ✕ Product system mein nahi hai aye to yahan product add na karein — Owner se product add karwayein; selling price badalna bhi Owner ka kaam hai.",
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
      "Agar payment wale hisay mein shop ka bara QR code dikh raha ho to number likhne ki zaroorat nahi: apne JazzCash / Easypaisa / banking app se usi QR ko scan karke payment karein — phir bhi neeche screenshot (proof) upload karna lazmi hai.",
      "✓ Place Order dabayein. Payment proof wale order par ⏳ Payment Tasdeeq Baqi ayega; shop confirm karegi to token aur status milega, reject ho to wajah ke sath My Orders se Dobara Proof Upload Karein.",
      "Status screen ya 📦 My Orders mein apna order dekhein; Ready hone par canteen ya grocery counter se pickup karein. Udhaar sirf tab hoga jab account/table flow mein required ID mojood ho.",
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
      "Overview tab par red badge ho to 💳 Online Payment Verification mein pending orders pehle check karein.",
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
      "ADD karna: labeled boxes bharein — PRODUCT NAME, SKU, EAN BARCODE (packed item ho to), RETAIL PRICE RS, WHOLESALE PRICE RS, WHOLESALE MIN QTY (khali = shop default), STOCK QTY, UNIT (per piece ya per kg), MAIN HEAD, SUB-HEAD, EMOJI aur IMAGE URL (optional).",
      "Size add karna ho to 📦 Packings mein + Packing dabayein; har row mein PACKING SIZE, RETAIL PRICE RS aur WHOLESALE PRICE RS likhein. Ghalat row ka red ✕ dabayein; koi size na ho to Packings khali chhor dein.",
      "Phir green + Add Product dabayein; product table mein aa jayega. List lambi ho to search, Head/Sub-Head filter aur Prev / Next se dhoondein.",
      "UPDATE karna: product ki row se Edit dabayein — poora form usi product se bhar jayega, Packings bhi wapas aa jayengi.",
      "Jo rate ya detail badalni ho labeled box mein change karein aur green Save Edit dabayein; na badalna ho to Cancel dabayein.",
      "DELETE karna: product ki row ka red ✕ dabayein — pehle naam aur SKU dobara check kar lein.",
      "Stock ka farq yaad rakhein: rates/details Edit se badalte hain; roz ki Stock IN aur Wastage hamesha Stock tab se karein. Form ka STOCK QTY sirf naya product banate waqt ibtidayi quantity ke liye use karein.",
    ],
    tips: [
      "Dhyaan dein: Packing alag product nahi hoti — 500g / 1kg / 2kg usi product ke sizes hain, aur har size ki price alag likhi jati hai.",
      "Product tabhi form mein sahi ayega jab us ka Main Head aur Sub-Head mojood ho; pehle Heads tab se structure bana lein.",
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
      "Phir + Add Staff dabayein; naya banda apne naam wale card aur naye PIN se login karega.",
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
      "Shop band karna ho to 🔴 Shop BAND kar dein dabayein; ye switch foran save hota hai aur /online par Closed popup aa jata hai. Dobara kholna ho to 🟢 Shop KHOL dein dabayein.",
      "Closed popup ka number badalna: CONTACT NUMBER (BAND HONE PAR) box mein asal number likhein — ye wala change neeche 💾 Save Settings dabane se save hota hai.",
      "COLLEGE NAME, CANTEEN NAME aur GROCERY STORE NAME bharein; ye naam header, bills, online page aur table QR cards par khud update ho jate hain.",
      "Online Payment Numbers mein JAZZCASH NUMBER, EASYPAISA NUMBER aur RAAST / BANK (IBAN) asal values likhein; demo numbers par asal payment na mangwayein.",
      "Payment QR Codes mein har method ka ASAL QR lagayein: us method ke card par 📷 QR Upload Karein dabakar apne payment app (My QR / Receive Money) wali QR picture chunein — QR foran save ho jata hai aur preview mein ✓ QR LAGA HAI aa jata hai. Ghalat lag jaye to 🔁 QR Badlein, hatana ho to 🗑️ Remove dabayein.",
      "Har method ke card mein ACCOUNT TITLE bhi likh dein (bilkul waisa naam jaisa account par hai) aur neeche 💾 Save Settings dabayein — title sirf QR Stand par chhapta hai. Raast aur Bank ke QR alag alag lag sakte hain, number dono ka wohi RAAST / BANK wala hai.",
      "QR lag jaye to usi card ke 🖨️ QR Stand button se A5 stand card print karein (shop ka naam, method, QR, title aur number) aur counter par lagayein — walk-in customer bhi scan karke pay kar sakega. Online customer ko wahi QR payment wale step par bara nazar ata hai.",
      "Wholesale Minimums mein pieces aur kg ki default limit set karein; kisi ek product ki alag limit Grocery product form ke WHOLESALE MIN QTY se lagti hai.",
      "Saari values check karke 💾 Save Settings dabayein aur ✓ Saved wala message zaroor dekhein.",
      "Settings ke baad Online page ek dafa khol kar naam, payment number aur Shop Open/Band wali surat khud test karein.",
    ],
    tips: [
      "Dhyaan dein: Shop Status switch foran save hota hai, lekin contact number, naam, payment numbers, QR account titles aur wholesale minimums ke liye Save Settings lazmi hai.",
      "Sirf APNE account ka asal QR lagayein — internet se uthaya ya kisi aur ka QR lagane se payment ghalat jagah chali jayegi.",
      "Jab shop band ho to customers ko sirf Closed popup, contact number aur Call / WhatsApp button nazar ate hain — koi order place nahi hota.",
    ],
  },

  "owner-tables": {
    title: "🪑 Owner — Tables aur QR Cards",
    steps: [
      "Owner Dashboard ke 🪑 Tables QR tab par ayen; 🪑 Kul Tables ke samne abhi saved tadaad dekhein.",
      "Tadaad badalna: − ya + dabayein, ya box mein 1 se 100 tak number likhein — abhi ye sirf draft hai.",
      "✓ Apply dabayein aur ✓ Saved dekhein; is ke baad neeche bilkul utne hi table QR cards bante hain jitni tadaad save ki hai.",
      "🖨️ Print Table Cards dabayein, cards print karein aur har card ko usi number wali table par chipkayein.",
      "Customer Table 1 ka QR scan kare to Online page par Table 1 khud select hota hai; woh chahe to number ya Dine-In/Takeaway badal sakta hai.",
      "Tadaad kam karne se us se upar wala table number online order mein invalid ho jayega, lekin purane orders aur bills bilkul nahi badalte.",
      "Tadaad change karne ke baad purane extra cards tables se hata dein aur naye cards ka ek QR khud scan karke test karein.",
    ],
    tips: [
      "Dhyaan dein: Apply dabaye baghair sirf − / + karne se saved tadaad aur online page nahi badalta.",
      "Aam canteen QR (baghair table ke) ke liye /online wala general link use hota hai; har table ke liye usi table ka apna card chipkayein.",
    ],
  },

  "owner-udhaar": {
    title: "💰 Owner — Udhaar Khata aur Wasooli",
    steps: [
      "Owner Dashboard ke 💰 Udhaar Khata tab par ayen; upar teen kul hisaab nazar ayenge — Kul Udhaar, Kul Wasooli aur Kul Baqaya. Ye ALL-TIME hisaab hai (Overview wala Udhaar card sirf aaj ka hota hai).",
      "Neeche har customer ka khata ek row mein hai: naam, ID (agar bill par likha tha), Kul Udhaar, Kul Wasooli aur Baqaya. Jiska baqaya zyada hai woh pehle ata hai; ✅ Clear wale khate band hain.",
      "Customer dhoondna ho to 🔍 Search mein naam ya ID likhein — list foran chhanti jayegi.",
      "Kisi customer ki row par click karein — us ka poora khata (ledger) khul jayega: har Udhaar bill date, bill number aur amount ke sath, aur har wasooli date, amount, method aur note ke sath; aakhri column mein har entry ke baad ka chalta hua Baqaya.",
      "Wasooli darj karna: khata khula ho to 💰 Wasooli Darj Karein wale form mein AMOUNT (RS) likhein — raqam Rs 0 se zyada aur baqaya se kam ya barabar honi chahiye, warna system saaf message ke sath rok dega.",
      "METHOD chunein — Cash, JazzCash, Easypaisa, Raast ya Bank — aur chahein to NOTE likh dein (masalan: aadhi raqam mili, baqi hafta).",
      "💰 Wasooli Darj Karein dabayein; ✓ wala message ayega, Baqaya foran kam ho jayega aur entry ledger mein aap (login staff) ke naam ke sath aa jayegi.",
      "Poori wasooli ho jaye to khata ✅ Clear ho jayega aur form ki jagah clear wala message ayega; khata phir bhi list mein apne poore record ke sath rahega.",
    ],
    tips: [
      "Dhyaan dein: Baqaya hamesha Udhaar bills − Wasooli se khud banta hai — kahin haath se kuch likhne ki zaroorat nahi, aur wasooli darj karne se koi bill change nahi hota.",
      "Counter par Udhaar ka naam har dafa EK jaisa likhein (aur ID ho to wohi ID): naam ya ID mukhtalif likha to usi customer ke do alag khate ban jayenge.",
      "Wasooli dabane se pehle amount aur method dobara check kar lein — galat wasooli khata kharab kar degi, pehle gin kar phir darj karein.",
    ],
  },
};
