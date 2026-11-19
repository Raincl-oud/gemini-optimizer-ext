# Design Document: Gemini Web Optimizer v1.0 (Major Update)

**Date:** 2026-11-19  
**Target Version:** Major `1.0.0` (`+1M` via `version-manager`)  
**Project Root:** `.` (repository root)  
**Target URL:** `https://gemini.google.com/*`

---

## 1. General (Tujuan Pembaruan Major v1.0)

Pembaruan Major v1.0 mengubah ekstensi dari *utility anti-lag dasar* menjadi paket optimisasi baca, tata letak, dan navigasi lengkap untuk Gemini Web, sekaligus membereskan bug visual yang ditemukan pada pemakaian nyata:
1. **Terminologi & Kontrol Lebih Jelas:** Mengganti istilah `Turn` menjadi **`Past Chat`** di seluruh UI/aria-label, menyederhanakan Popup dengan menjadikan **Mode Render Ringan** & **Animasi** *always-on* (menghapus kedua toggle/menu), menyembunyikan penuh opsi jumlah *Past Chat* terbuka saat ringkasan dimatikan, dan mengubah batas terbuka menjadi input angka bebas (`0` = hanya chat aktif/terbaru yang tetap terbuka).
2. **Perbaikan Visual & Bug Inti:** Menghilangkan gap lebar antar ringkasan *Past Chat*, menghilangkan duplikasi teks prompt di bar ringkasan, memberi jarak aman antara Strip Navigator kiri dan bar ringkasan, serta menghaluskan perpindahan posisi Strip Navigator & ringkasan saat sidebar Gemini dibuka/ditutup.
3. **Kenyamanan Baca & Navigasi Baru:**
   - **Text Optimization:** Pengaturan ukuran teks, jarak baris, jarak antar paragraf, *letter spacing*, jenis font, dan tombol reset di dalam accordion ringkas Popup.
   - **Full-Width Workspace:** Area chat, kotak input, dan bar pemilih model melebar penuh menyesuaikan lebar layar (dengan padding aman di sisi kiri untuk Strip Navigator).
   - **Dynamic Sticky `"Tutup lagi"`:** Tombol *Tutup lagi* pada *Past Chat* yang dibuka manual tidak lagi diam di pojok atas, melainkan menempel di sebelah kanan teks dan bergerak dinamis mengikuti scroll (mentok di atas teks, tengah layar secara vertikal saat di tengah teks panjang, dan mentok di bawah teks).
   - **Tombol Lingkaran "Ke Bawah":** Tombol bulat sejajar rata kiri tepat di atas kotak input & pemilih model, bergaya identik dengan UI composer Gemini, hanya muncul ketika scroll tidak berada di dasar percakapan.

---

## 2. More Specific (Rincian Teknis, Alur & Edge Cases)

### A. Settings & Terminologi (`src/shared/settings.js`)
- `openPastChats` (menggantikan `openTurnLimit`): bilangan bulat non-negatif bebas (`min: 0`, `max: 999`, default `4`).
  - **Aturan `Past Chat terbuka`:** Total percakapan terbaru yang tetap terbuka adalah `openPastChats + 1` (1 chat aktif/terbaru + `N` *Past Chat*). Jika diisi `0`, hanya 1 chat terbaru/aktif yang tetap terbuka; begitu user mengirim chat baru, chat sebelumnya langsung diringkas.
- **Mode Render Ringan Always-On (`gopt-light-render`):** Aktif tanpa syarat sejak turn pertama (`always on`), tidak lagi memiliki toggle/menu di Popup ataupun ambang 10 turn.
- **Animasi Always-On:** Selalu aktif secara permanen (toggle di Popup dihapus), sambil tetap mematuhi `@media (prefers-reduced-motion: reduce)` dari OS untuk aksesibilitas.
- **Objek `textOpt` Independen (persisten di `chrome.storage.local`):**
  - Setiap properti bekerja secara **independen** (default `null` / `'default'` = tidak menimpa style bawaan Gemini sampai user menggeser atau memilihnya):
    - `fontFamily`: `'default' | 'sans' | 'serif' | 'mono'` (default `'default'`)
    - `fontSize`: `null` atau `13..22` (px)
    - `lineHeight`: `null` atau `1.2..2.2`
    - `paragraphGap`: `null` atau `4..28` (px)
    - `letterSpacing`: `null` atau `-0.03..0.08` (em)
  - **Cakupan Elemen:** Berlaku pada **teks percakapan** (prosa jawaban Gemini `.markdown` + prompt user `user-query`). **Blok kode (`pre`, `code`, `code-block`) dan tabel tetap dilindungi** dari override `font-family` dan `letter-spacing`, sementara `fontSize` membuat ukuran font blok kode ikut menyesuaikan secara proporsional (`~88%` dari ukuran teks chat, tetap *monospace*).
  - Tombol **Reset Default Teks** mengembalikan seluruh field `textOpt` ke `'default'` / `null`.

### B. Anti-Gap, Anti-Duplikasi Teks & Full-Width Layout (`early-perf.css`, `ui-overlay.css`, `selectors.js`)
1. **Hilangkan Gap Antar Ringkasan:**
   - Pada `.gopt-turn-collapsed`: paksa `content-visibility: visible !important`, `contain-intrinsic-size: none !important`, `min-height: 0 !important`, `margin-top: 0 !important`, `margin-bottom: 0 !important`, `padding-top: 0 !important`, `padding-bottom: 0 !important` agar container Gemini tidak menyisakan ruang kosong `640px` atau margin/padding bawaan.
   - Rapikan `.gopt-collapsed-bar` dengan jarak vertikal minimal (`margin: 2px 0`).
2. **Hapus Duplikasi Teks di Bar Ringkasan & Tooltip:**
   - Pada `selectors.js#ownTextOf` / `getPromptText`: buang node aksesibilitas/tersembunyi bawaan Gemini (`.cdk-visually-hidden`, `[aria-hidden="true"]`, `.sr-only`) dan prioritaskan container teks baris tunggal/utama agar tidak membaca teks dua kali (mis. `"lanjut 4.6 lanjut 4.6"`).
3. **Full-Width Chat, Input Box & Pemilih Model (Always-On):**
   - Lebarkan wrapper percakapan, *conversation container*, area *composer* / kotak input (`input-area-v2`, `.input-area-container`, `rich-textarea`, `.text-input-field`, bar pemilih model) dengan `max-width: none !important; width: 100% !important` di dalam viewport utama chat, sambil memberi `padding-left` aman (`~44px`) untuk Left Strip Navigator dan `padding-right` rapi (`~48px`) agar konten tetap terasa penuh kanan-kiri dan tidak bertabrakan dengan kontrol sisi kanan.

### C. Smooth Sidebar Transition (#9)
- Ketika sidebar Gemini dibuka atau ditutup (dideteksi lewat `ResizeObserver` / `transitionstart` pada sidenav/main area):
  - Jalankan *frame tracking* (`requestAnimationFrame` selama `~360ms`) untuk menyelaraskan posisi `left` Strip Navigator tepat mengikuti pergeseran tepi kiri area chat per-frame secara halus (bukan menunggu observer selesai lalu teleport).
  - Tambahkan transisi CSS halus pada pergeseran konten/bar ringkasan agar perubahan lebar akibat buka-tutup sidebar terasa mulus.

### D. Dynamic Sticky `"Tutup lagi"` (#10)
- Pada *Past Chat* yang dibuka manual (`.gopt-turn-manual-open`):
  - Tombol `.gopt-recollapse-btn` tidak lagi memakai `position: absolute; top: 6px; right: 6px`.
  - Diubah menjadi **sticky dinamis menempel mengambang di tepi kanan teks** (dengan padding kanan rapi `~48px`): secara vertikal berada di tengah layar (`50%` tinggi viewport) saat pengguna sedang membaca bagian tengah teks panjang, mentok tepat di tepi atas teks saat awal blok terlihat, dan mentok tepat di tepi bawah teks saat mencapai akhir blok (`position: sticky` / per-frame clamped terhadap bounding rect Past Chat).
  - **Bentuk & Animasi Hover:** Saat diam berupa **pil/lingkaran ikon super ringkas** (hanya ikon panah lipat ke atas, sedikit transparan agar tidak menutupi teks); saat di-hover (`@media (hover: hover) and (pointer: fine)`), teks **`"Tutup lagi"`** muncul mulus sambil **menggeser ikon panah ke kiri** menggunakan animasi GPU (`transform` & `opacity`, `--ease-out`).

### E. Tombol Lingkaran "Ke Bawah" di Atas Composer (#11)
- Elemen `<button class="gopt-scroll-bottom-btn">` berbentuk lingkaran (`border-radius: 9999px`) berisi ikon panah ke bawah (`SVG`).
- **Posisi:** Tepat di atas area tempat mengetik chat & pemilih model, **sejajar rata kiri** dengan kotak input tersebut.
- **Visual:** Menggunakan gaya permukaan, border, warna teks, dan elevasi/shadow yang menyatu identik dengan kotak input & pemilih model Gemini (adaptif Light/Dark).
- **Visibilitas & Deduplikasi:** Hanya muncul ketika scroller **tidak** berada di paling bawah (mis. jarak dari dasar `scrollHeight - scrollTop - clientHeight > 80px`), dan otomatis menghilang saat sudah berada di paling bawah. Jika tombol scroll-to-bottom bawaan Gemini muncul, tombol bawaan tersebut disembunyikan agar tidak ada dua tombol panah ke bawah. Klik tombol menggulir halus ke paling bawah.

---

## 3. Themes & Design (UI/UX Popup & Komponen Baru)

- **Popup (`src/popup/popup.html` & `popup.css`):**
  - Status pill memperbarui istilah ke **Past Chat**: mis. `14 Past Chat · 10 diringkas · Sumber disembunyikan`.
  - Pengaturan utama yang tersisa (super ringkas & fokus):
    1. Toggle **Sembunyikan sumber & referensi**
    2. Toggle **Ringkas chat panjang**
       - Sub-baris **Past Chat terbuka** (input angka bebas `min=0`, **hilang total (`hidden`)** saat *Ringkas chat panjang* OFF)
    3. **Accordion "Optimisasi Teks"** (default tertutup, header klikabel dengan indikator chevron + status aktif ringkas):
       - Pilihan Font (`Default` | `Sans` | `Serif` | `Mono`)
       - Slider **Ukuran Teks** (`13–22px`, tabular value)
       - Slider **Jarak Baris** (`1.2–2.2`, tabular value)
       - Slider **Jarak Paragraf** (`4–28px`, tabular value)
       - Slider **Spasi Huruf** (`-0.03–0.08em`, tabular value)
       - Tombol **Reset Default Teks**
  - Aksi Cepat 2x2 tetap dipertahankan (*Buka Semua*, *Ringkas Lama*, *Ke Atas*, *Ke Bawah*).

---

## 4. Animation (Motion & Performance Guardrails)

- **Animasi Ekstensi Always-On** (tetap patuh `@media (prefers-reduced-motion: reduce)` untuk aksesibilitas; toggle di Popup dihapus).
- **Tombol Lingkaran "Ke Bawah":** Muncul/hilang dengan transisi `opacity`, `transform: translateY(6px -> 0) scale(0.92 -> 1)` dalam `180ms` `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`), pointer-events nonaktif saat tersembunyi.
- **Accordion "Optimisasi Teks" di Popup:** Buka/tutup mulus tanpa melanggar aturan reflow berat (transisi ikon chevron `160ms --ease-out`, panel konten `opacity` + `translateY`).
- **Transisi Sidebar & Strip Navigator:** Penyelarasan posisi berbasis `rAF` mengikuti frame gerak sidebar Gemini + tetap menjaga efek dock-wave GPU-only (`scaleX`/`scaleY`/`translateY`) pada strip.

---

## 5. Open / Left to Builder
- Pemetaan selector spesifik pada composer Gemini (`input-area-v2`, `.input-area-container`, `.bottom-container`) untuk penjangkaran posisi tombol lingkaran *Ke Bawah* yang tetap aman terhadap perubahan minor DOM Gemini (disentralkan di `selectors.js`).
- Nilai piksel padding kiri spesifik (`~44px`) agar jarak antara Strip Navigator dan tepi kiri bar ringkasan / teks full-width terlihat proporsional di berbagai ukuran layar.
