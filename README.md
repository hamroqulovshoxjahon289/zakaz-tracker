# Zakaz Tracker — Ishlab chiqarish liniyalari va TV monitoring tizimi

Admin panel orqali zakaz kiritiladi, u avtomatik ravishda ishlab chiqarish
bosqichlari (masalan Ara → Kromka → Prisadka → Upakovka) bo'ylab suriladi,
va har bir bo'lim/sex uchun alohida TV ekranda (login talab qilinmaydi)
jonli ko'rinadi.

## 1. O'rnatish

Kompyuteringizda **Node.js** (18-versiyadan yuqori) o'rnatilgan bo'lishi kerak:
https://nodejs.org — "LTS" versiyani yuklab oling va o'rnating.

Zip faylni oching, terminal/cmd oching va papkaga kiring:

```bash
npm install
npm start
```

Server ishga tushgach, terminalda shunday yozuv chiqadi:

```
Zakaz Tracker ishga tushdi: http://localhost:3000
TV ekran: http://localhost:3000/tv
Admin/Xodim kirish: http://localhost:3000/login
```

## 2. Birinchi kirish

- Admin panel: `http://localhost:3000/login`
  - Login: `admin`
  - Parol: `admin123`
- **Birinchi ishingiz — shu parolni almashtiring!** ("Foydalanuvchilar"
  bo'limida "Parolni almashtirish" tugmasi orqali)
- TV ekran (login kerak emas): `http://localhost:3000/tv`

## 3. Ishxonada qanday ishlatish

### Kompyuter / serverni ishga tushirish
- Bu dastur sizning ichki kompyuteringizda (yoki kichik serverda) ishlaydi.
- Boshqa qurilmalardan (TV, boshqa xodim kompyuteri) kirish uchun **lokal IP
  manzilidan** foydalaning, masalan: `http://192.168.1.25:3000/tv` (IP
  manzilni `ipconfig` / `ifconfig` orqali bilib olasiz). Hammasi bitta
  Wi-Fi/LAN tarmog'ida bo'lishi kerak.

### TV'ga ulash
1. TV'ga brauzer ochiladigan qurilma ulang (Smart TV brauzeri, Android TV
   box, yoki oddiy noutbuk/mini-PC HDMI orqali).
2. Brauzerda kerakli kanal manzilini oching (pastga qarang).
3. To'liq ekran (F11) rejimiga o'tkazing.
4. Sahifa avtomatik jonli yangilanadi — hech narsani qayta yuklash shart emas.

### Kunlik ish tartibi
1. Admin (yoki xodim) tizimga kiradi, **"Kunni boshlash"** bosiladi.
2. Zakaz kiritilganda, qaysi liniyadan (masalan "Korpus") boshlanishi
   tanlanadi.
3. Har bir stansiya o'z ishini tugatgach, o'sha zakaz qatoridagi yashil
   tugmani ("...ga →") bosib, keyingi bosqichga o'tkazadi.
4. Zakaz liniyaning oxirgi bosqichidan o'tgach, avtomatik ravishda keyingi
   liniyaga (odatda Labo'ga) ko'chadi.
5. Kun oxirida **"Kunni yakunlash"** bosiladi.

## 4. Liniyalar va stansiyalar (ishlab chiqarish zanjiri)

Bu tizimning eng muhim qismi.

### Standart o'rnatilgan liniyalar
- **Korpus** — Ara → Kromka → Prisadka → Upakovka bosqichlari, guruhi
  `korpus`, oxirida avtomatik **Labo**ga o'tadi.
- **Fasad** — bitta "Ishlov berish" bosqichi, guruhi `fasad`, oxirida
  Labo'ga o'tadi.
- **Labo** — bitta "Yuklash" bosqichi, guruhi `labo` — bu yakuniy nuqta.

"Liniyalar" bo'limida siz istalgancha yangi liniya qo'sha olasiz, har
biriga xohlagan sonda bosqich (stanok) bera olasiz, va liniyalarni
bir-biriga zanjir qilib ulay olasiz ("Keyingi liniya" tanlovi orqali).

### Qanday ishlaydi
1. Zakaz kiritilganda qaysi liniyadan boshlanishi tanlanadi (masalan
   "Korpus").
2. Zakaz avtomatik shu liniyaning birinchi bosqichida (Ara) paydo bo'ladi.
3. Ara operatori ishni tugatgach, "Kromkaga →" tugmasini bosadi — zakaz
   avtomatik Kromka bosqichiga o'tadi.
4. Xuddi shunday Kromka → Prisadka → Upakovka.
5. Upakovka'dan "Laboga →" bosilgach, zakaz **Labo** liniyasiga o'tadi va
   Korpus tarafdan butunlay yo'qoladi.

### "Yakunlanganda yangi material buyurtmasi (XDF)" funksiyasi
Korpus liniyasida bu sozlama standart yoqilgan. Upakovka bosqichi tugab,
zakaz Labo'ga jo'natilgan zahoti — **avtomatik ravishda xuddi shu model
nomi bilan yangi buyurtma Ara bosqichida paydo bo'ladi** ("Material
tayyorlash (XDF)" izohi bilan), Ara operatoriga navbatdagi material
tayyorlashni bildirish uchun. Har qanday liniyada bu funksiyani "Liniyalar"
bo'limidagi checkbox orqali yoqish/o'chirish mumkin.

### TV guruhlari (kanallar)
Har bir liniyaning "TV guruhi" bor. Bir xil guruh nomidagi barcha liniyalar
bitta TV havolasida birga chiqadi. Masalan, "Fasad-1" va "Fasad-2" nomli
2 ta liniya yaratib, ikkalasiga ham guruh sifatida `fasad` yozsangiz —
ular ikkalasi ham `/tv/fasad` sahifasida birga ko'rinadi, va fasad
bo'limiga faqat 1 ta jismoniy TV kifoya qiladi.

TV havolalari:
- `http://<server>:3000/tv` — barcha kanallar ro'yxati (tanlov sahifasi)
- `http://<server>:3000/tv/korpus` — faqat Korpus liniyasi
- `http://<server>:3000/tv/fasad` — faqat Fasad liniyasi(lari)
- `http://<server>:3000/tv/labo` — faqat Labo liniyasi

Admin panelning "Zakazlar" bo'limida yuqorida barcha TV havolalari
tugmachalar shaklida ham chiqadi.

### Zakazni tahrirlash va qo'lda ko'chirish
Har bir zakaz qatorida:
- Zakaz raqami va izoh — to'g'ridan-to'g'ri o'sha yerda tahrirlanadi
- **"Bosqich (qo'lda)"** tanlovi orqali zakazni istalgan liniya/bosqichga
  qo'lda ko'chirish mumkin (xato ketgan bo'lsa orqaga qaytarish uchun)
- ▲ / ▼ tugmalari — o'sha bosqich ichidagi navbatni o'zgartiradi
- Yashil tugma ("...ga →") — zakazni keyingi bosqichga avtomatik o'tkazadi

## 5. Foydalanuvchilarga lavozim berish

Xodim qo'shayotganda yoki mavjud xodimni tahrirlayotganda, unga bir nechta
stansiya biriktirish mumkin — masalan bitta xodimga Ara, Kromka va
Prisadka — barchasini belgilab qo'yish mumkin.

## 6. Shikoyatlar (muammolar)

- Har bir xodim o'z akkauntidan **"Shikoyatlar"** bo'limiga kirib, muammoni
  yozib yuborishi mumkin.
- Har bir shikoyat yonida **"Hal qilindi"** / **"Qayta ochish"** tugmasi bor.
- **Ochiq shikoyatlar TV ekranda pastki qizil panelda** avtomatik chiqib
  turadi, hal qilingach yo'qoladi.

## 7. Qora / Oq rejim (TV ekran uchun)

TV ekranning yuqori o'ng burchagida **"☾ Qorong'i / ☀ Yorug'"** tugmasi bor.
Tanlangan rejim shu qurilmada saqlanib qoladi.

## 8. Bildirishnomalar (har bir xodim uchun shaxsiy xabar)

- Har bir foydalanuvchi (admin panel ekranida, yuqori o'ng burchakda) 🔔
  qo'ng'iroq belgisini ko'radi.
- Zakaz kimningdir stansiyasiga tushganda (yoki unga to'g'ridan-to'g'ri
  biriktirilganda), o'sha xodimning qo'ng'irog'ida **jonli, real vaqtda**
  yangi xabar chiqadi va yumshoq ovozli signal eshitiladi.
- Har bir xabar yonida **"Ko'rdim"** tugmasi bor — bosilgach xabar
  "o'qilgan" deb belgilanadi.
- **"Hammasini o'qildi qilish"** tugmasi orqali bir zumda barcha xabarlarni
  tozalash mumkin.
- Bu — ilova ichidagi (in-app) bildirishnoma, telefon raqamiga haqiqiy SMS
  emas. Agar kelajakda haqiqiy SMS kerak bo'lsa (masalan Eskiz.uz orqali),
  bu alohida sozlash va oylik xarajat talab qiladi.

## 9. TV ekranda ovozli e'lonlar

- TV sahifasining yuqori chap burchagida **"🔇 Ovozni yoqish"** tugmasi bor.
  Brauzerlar avtomatik ovoz chiqarishni bloklagani uchun, TV ochilgach bir
  marta shu tugmani bosish kerak (keyin u "🔊 Ovoz yoqilgan" holatda qoladi
  va qurilmada eslab qolinadi).
- Zakaz bir bosqichdan ikkinchisiga o'tganda, TV **beep** ovozi va undan
  keyin **ovozli o'qish** ("Shkaf-99: Aradan Kromkaga o'tdi" kabi) orqali
  e'lon qiladi.
- E'lon faqat tegishli TV kanalida eshitiladi — masalan Ara→Kromka o'tishi
  haqidagi xabar `/tv/korpus` kanalida eshitiladi, `/tv/fasad` kanalida
  eshitilmaydi.
- **Eslatma:** brauzerning o'zbek tilidagi ovozi odatda mavjud emas, shuning
  uchun matn standart (ingliz/rus) ovozda o'qiladi — talaffuz mukammal
  bo'lmasligi mumkin, lekin matn tushunarli bo'ladi.

## 10. Muddati o'tgan zakazlar (qizil ogohlantirish)

Agar biror zakaz bitta stansiyada **2 soatdan ortiq** turib qolsa, u avtomatik
ravishda qizil rangda, pulsatsiya qiluvchi chegara bilan ajratiladi — ham
admin panelda, ham TV ekranda. Bu vaqt chegarasi kodda
(`server.js` va `public/js/dashboard.js` / `views/tv.html` fayllarida
`OVERDUE_MS`) o'zgartirilishi mumkin.

## 11. Hisobot (admin uchun)

"Hisobot" bo'limida:
- Jami yakunlangan, hozir faol va arxivlangan zakazlar soni
- Oxirgi 14 kunlik yakunlangan zakazlar grafigi
- Har bir stansiyada o'rtacha qancha vaqt (daqiqada) ketganini ko'rsatuvchi
  jadval — bu qaysi bosqich sekinroq ishlayotganini aniqlashga yordam beradi

## 12. Zakaz tarixi (arxiv)

Oldin "Kunni yakunlash" bosilganda barcha zakazlar butunlay o'chib ketardi.
Endi ular **arxivga** ko'chiriladi (`data/db.json` faylidagi
`archivedOrders`), shuning uchun "Hisobot" bo'limidagi statistikalar
o'tgan kunlarni ham hisobga oladi.

## 13. Shoshilinch zakazlar 🔴

Zakaz kiritish formasida yoki har bir zakaz qatorida **"🔴 Shoshilinch"**
belgisini yoqish mumkin. Shoshilinch zakaz:
- Admin panelda qizil "SHOSHILINCH" yorlig'i bilan ajratiladi
- TV ekranda ham qizil chegara va yorliq bilan ko'rinadi
- Istalgan vaqt oddiy holatga qaytarilishi mumkin

## 14. Mijozlar bazasi

"Mijozlar" bo'limida har bir mijozning ismi, telefon raqami va izohini
saqlash mumkin. Zakaz kiritishda "Mijoz" tanlovidan tanlab, o'sha zakazni
mijozga bog'lash mumkin — kelajakda qaysi mijoz nechta buyurtma bergani
kerak bo'lsa, shu yerdan boshlanadi.

## 15. Buyurtma shablonlari

Tez-tez takrorlanadigan zakaz turlarini (masalan "Standart shkaf 2x1.8")
shablon qilib saqlash mumkin. Keyingi safar zakaz kiritishda yuqoridagi
"Shablondan tanlash" ro'yxatidan tanlasangiz, izoh va liniya maydonlari
avtomatik to'ldiriladi — faqat zakaz raqamini yozib, "Qo'shish" bossangiz
bo'ldi.

## 16. Amallar jurnali (Jurnal)

Admin uchun "Jurnal" bo'limida — kim, qachon, qanday amal bajarganini
(zakaz yaratish/tahrirlash/o'chirish, xodim qo'shish, liniya yaratish,
shikoyatni hal qilish va h.k.) ko'rsatuvchi tarix. Oxirgi 300 ta yozuv
saqlanadi.

## 17. Avtomatik zaxira nusxa (backup)

- Ma'lumotlar bazasidan **har 30 daqiqada** avtomatik zaxira nusxa
  olinadi, shuningdek server har safar ishga tushganda ham.
- Oxirgi **30 ta** zaxira nusxa saqlanadi (eskilari avtomatik o'chadi).
- "Hisobot" bo'limida barcha zaxiralar ro'yxati va "Yuklab olish" havolasi
  bor, shuningdek **"Hozir zaxira olish"** tugmasi bilan istalgan vaqtda
  qo'lda zaxira olish mumkin.
- **Tiklash (restore):** agar ma'lumotlar buzilib qolsa, kerakli
  zaxira faylini yuklab oling va uni `data/db.json` nomiga o'zgartirib,
  serverni to'xtatib qayta ishga tushiring.

## 18. Excel'ga eksport

"Hisobot" bo'limida ikkita tugma bor:
- **"Zakazlar (Excel)"** — barcha (faol + arxivlangan) zakazlar ro'yxatini
  `.xlsx` fayl qilib yuklab beradi
- **"Hisobot (Excel)"** — stansiyalar bo'yicha statistikani va umumiy
  ko'rsatkichlarni `.xlsx` fayl qilib yuklab beradi

## 19. Foydalanuvchilar (login boshqaruvi)

- Faqat **admin** yangi xodim qo'sha oladi.
- Admin xohlagan xodimning **"Uning nomidan kirish"** tugmasi orqali uning
  akkauntiga kira oladi.
- Admin har qanday foydalanuvchining parolini almashtira yoki uni o'chira
  oladi.

## 20. Texnik ma'lumot

- Backend: Node.js + Express + Socket.io (jonli yangilanish uchun)
- Excel eksport: ExcelJS kutubxonasi
- Ma'lumotlar: `data/db.json` faylida saqlanadi, zaxiralar
  `data/backups/` papkasida
- Portni o'zgartirish: `PORT=4000 npm start`
