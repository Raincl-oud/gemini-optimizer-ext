# Design Document: Gemini Web Optimizer Extension

**Date:** 2026-11-18  
**Project Size:** Full Project (Chrome / Edge Manifest V3 Browser Extension)  
**Target URL:** `https://gemini.google.com/*`

---

## 1. General (Inti Project & Nilai Utama)

### Core Purpose & Value
Ekstensi browser Manifest V3 untuk `gemini.google.com` yang menyelesaikan dua masalah utama pengguna aktif Gemini Web:
1. **Performa & Navigasi Chat Panjang:** Mengatasi lag, *freeze*, dan kegagalan membuka thread panjang akibat ribuan node DOM, rendering kode/LaTeX, dan animasi streaming berat, sekaligus menyediakan navigasi instan antar pesan user.
2. **Kebersihan Referensi (Toggle Sumber):** Memberikan sakelar (*toggle*) On/Off instan untuk menyembunyikan atau memunculkan kembali seluruh indikator *"Gemini mengambil dari mana"* (chip kutipan *inline*, kartu *Sources*, serta badge konteks/memori/aplikasi).

### Target Users & Use Cases
- Pengguna aktif Gemini Web untuk sesi panjang (coding, riset mendalam, penulisan berantai) yang ingin UI tetap responsif, ringan, dan bebas gangguan visual kutipan saat membaca.

### Constraints, Non-Goals & Anti-Goals
- **Non-Goals:** Tidak mempercepat inferensi/generasi token dari server Google, tidak mengubah batas kuota/context window, dan tidak melakukan scraping/automasi agresif.
- **Anti-Goals:**
  - Tidak memutus event listener/state Angular asli Gemini (tombol *Copy*, *Edit*, *Regenerate*, *Canvas*, dll. harus tetap bekerja normal).
  - Tidak menjejalkan toolbar/floating bar yang memenuhi area baca Gemini (kontrol pengaturan dipusatkan di Popup ekstensi).

---

## 2. More Specific (Fitur, Alur, Edge Cases & Arsitektur)

### Selected Technical Approach: Hybrid CSS-First + Selective DOM Observer
- **Alasan Pemilihan:** Kombinasi CSS injection sejak `document_start` dan `MutationObserver` yang di-*debounce* pada container percakapan adalah pendekatan paling ringan dan paling aman untuk SPA Angular Gemini. Tidak melepaskan (*detach*) node DOM secara agresif sehingga integritas tombol dan state bawaan Gemini tetap terjaga.
- **Isolasi Selector:** Seluruh selector elemen Gemini (turn container, pesan user, respons model, citation chips, kartu Sources, badge konteks/memori) dipusatkan di satu modul `selectors.js` berbasis atribut semantik (`tagName`, `role`, `aria-label`, `data-*`, serta pola struktur yang stabil) agar mudah dirawat bila Google memperbarui UI.

### Core Features (MVP)
1. **Auto-Collapse Pesan Lama & `content-visibility: auto`:**
   - **Definisi 1 Turn:** 1 pasangan **Prompt User + Jawaban Gemini** (`1:1` dengan item di Left Strip Navigator).
   - CSS `content-visibility: auto` + `contain-intrinsic-size` disuntikkan sejak `document_start` pada container turn agar browser tidak dipaksa me-layout/paint seluruh thread sekaligus saat membuka chat panjang.
   - Turn lama di atas ambang batas turn terbaru otomatis diringkas (*collapsed*) menjadi 1 bar ringkas berisi nomor turn + cuplikan awal prompt user, sedangkan konten dalamnya disembunyikan dari render tree tanpa menghapus node Angular aslinya.
   - Turn yang ter-*collapse* dapat dibuka kembali dengan mengklik bar ringkasnya atau mengklik strip-nya di Left Strip Navigator.
   - **Siklus Turn yang Dibuka Manual:** Turn yang dibuka manual **tetap dipertahankan terbuka** saat pesan baru masuk/streaming (tidak ditutup paksa oleh observer), dan dilengkapi tombol kecil **"Tutup lagi"** di sudut turn tersebut agar bisa langsung dilipat ulang di halaman (selain aksi global *Ringkas Lama* di Popup).
2. **Master Toggle Indikator Sumber ("Mengambil dari mana"):**
   - Satu toggle utama di Popup untuk menyembunyikan/menampilkan secara instan elemen atribusi sumber:
     - Chip/link kutipan *inline* di dalam teks jawaban.
     - Kartu/panel *Sources* di bawah atau samping jawaban.
     - Badge/banner atribusi konteks, memori, atau asal aplikasi (*"Menggunakan info dari..."*, label atribusi `@Drive`/`@Gmail`).
   - **Batas Aman (Tetap Tampil):** Kartu hasil file/konten `@Drive`/`@Gmail` yang diminta user dalam jawaban dan panel *"Show thinking"* / proses berpikir model **tidak** ikut disembunyikan.
   - Status tersimpan secara persisten di `chrome.storage.local` dan diterapkan langsung lewat CSS root class tanpa perlu reload halaman.
3. **Popup-Only Control Center:**
   - Seluruh sakelar dan pengaturan ditempatkan di Popup ikon ekstensi sehingga area chat Gemini tetap bersih (satu-satunya elemen in-page selain navigator kiri hanyalah bar turn ter-*collapse* dan tombol kecil *"Tutup lagi"* pada turn yang dibuka manual).

### Expansion Features (Disepakati)
1. **Left Horizontal Strip Navigator (Minimap):**
   - Deretan strip horizontal tipis tersusun secara vertikal di tepi kiri container utama chat; **tetap 1:1 untuk setiap pesan user** (jika daftar melebihi tinggi layar pada 100+ pesan, rail dapat di-scroll secara internal dan otomatis *auto-centering* mengikuti strip aktif, dengan layer tooltip overlay terpisah di luar container `overflow` agar pratinjau hover tidak pernah terpotong).
   - **Hover:** Strip yang disentuh membesar secara proporsional dan mendorong strip tetangga di atas/bawahnya, sekaligus memunculkan tooltip pratinjau isi pesan user.
   - **Click:** Jika turn target sedang dalam status *collapsed*, sistem otomatis meng-*expand* turn tersebut terlebih dahulu (dan menandainya sebagai terbuka manual), lalu melakukan scroll menuju posisi pesan target.
   - **Scroll-Spy Ringan:** Menandai strip yang sedang berada di viewport aktif.
2. **Pengaturan Batas Turn Terbuka + Expand All / Collapse Old:**
   - User dapat memilih jumlah turn terbaru yang selalu dibiarkan terbuka (`2`, `4`, atau `8` turn terakhir) serta menekan tombol *Buka Semua* atau *Ringkas Lama* (yang juga mereset flag buka-manual) dari Popup.
3. **Mode Render Ringan (3-State: `Auto | On | Off`):**
   - Menekan animasi streaming/fade teks berat dan menonaktifkan `backdrop-filter` / efek blur berat pada UI Gemini.
   - Mendukung **3 mode di Popup (`Auto` | `Selalu Aktif` | `Mati`)**: pada mode `Auto`, aktif otomatis saat jumlah turn melewati ambang `>= 10` turn; pada mode `Selalu Aktif` / `Mati`, pilihan user dipatuhi penuh tanpa ditimpa oleh observer.
4. **Quick Jump Top / Bottom & Status Indikator di Popup:**
   - Tombol lompat instan ke awal/akhir percakapan di Popup, disertai ringkasan status real-time (contoh: `14/18 turn diringkas • Sumber: Tersembunyi • Render Ringan: Auto`).
5. **Default Awal Saat Pemasangan (`chrome.storage.local`):**
   - Langsung aktif otomatis (`autoCollapse: true`, `openTurnLimit: 4`, `hideSources: true`, `lightRenderMode: 'auto'`, `animationsEnabled: true`) agar manfaat anti-lag dan penyembunyian sumber langsung terasa tanpa setup manual, sementara seluruh opsi tetap dapat diubah kapan saja lewat Popup.

### Key User Flows & Edge Cases
- **Cold Load Chat Sangat Panjang:** CSS `content-visibility: auto` aktif sebelum DOM penuh ter-render; observer langsung meringkas turn lama begitu batch DOM awal muncul agar tab tidak sempat *hang*.
- **Streaming Aktif:** Turn terakhir yang sedang menerima *streaming* dikecualikan dari auto-collapse dan observer membatasi pemrosesan ulang agar tidak membebani CPU saat token masuk.
- **Navigasi SPA Gemini:** Perpindahan antar percakapan (`/app` ↔ `/app/<id>`) atau klik *New Chat* dideteksi via URL/history watcher + observer root chat untuk menyegarkan daftar strip horizontal dan hitungan turn tanpa duplikasi listener.
- **Sidebar Gemini Buka/Tutup:** Posisi horizontal navigator strip menempel di tepi kiri area utama chat (`ResizeObserver`) sehingga otomatis bergeser saat sidebar dibuka/tutup, tampil agak redup saat diam dan jelas saat di-hover, serta **tetap tampil** di berbagai lebar layar tanpa otomatis disembunyikan.

---

## 3. Themes & Design (UI/UX Popup & Elemen Halaman)

### Visual Direction: Adaptive Gemini-Native (`Operate` Mode)
- Mengikuti tema aktif `gemini.google.com` (Light/Dark Mode) secara otomatis menggunakan token warna adaptif (permukaan netral bersih, border halus, kontras teks aksesibel) sehingga terasa seperti fitur bawaan Gemini.
- **Popup Extension:**
  - Tata letak ringkas, jelas, dan cepat dipindai (*high scanability*):
    - **Header & Status Pill:** Nama ekstensi + ringkasan status tab aktif (jumlah turn diringkas & status sumber).
    - **Sakelar Utama:**
      - Toggle *Sembunyikan Sumber & Referensi*
      - Toggle *Auto-Collapse Chat Panjang* + segmented selector batas turn (`2` | `4` | `8`)
      - Segmented selector *Mode Render Ringan* (`Auto` | `Aktif` | `Mati`)
      - Toggle *Animasi Ekstensi* (On/Off)
    - **Aksi Cepat:** Grid tombol *Buka Semua*, *Ringkas Lama*, *Ke Atas*, dan *Ke Bawah*.
- **Left Horizontal Strip Navigator:**
  - Tersusun rapi vertikal di tepi kiri area utama chat (`overflow-y` internal + auto-center untuk 100+ turn); setiap item berupa strip horizontal ringkas (`height: 3px`, `width` pendek saat diam, sudut kapsul `999px`, agak redup saat diam & penuh saat di-hover).
  - Strip aktif memiliki warna aksen lebih jelas & sedikit lebih panjang dibanding strip pasif; strip untuk turn ter-collapse sedikit lebih redup.
  - Tooltip pratinjau dirender pada layer overlay terpisah (bebas *clipping* scroll) di sebelah kanan strip saat di-hover, menampilkan nomor prompt + cuplikan 2–3 baris isi pesan user dengan shadow halus dan border kontras ringan.
- **Collapsed Turn Header & Tombol "Tutup lagi":**
  - Setiap turn lama diringkas menjadi 1 baris tipis (`~36px`) berisi nomor turn (`#1`), cuplikan 1 baris prompt user, dan label *"Buka"* sehingga tetap bisa diklik buka satu per satu langsung di halaman.
  - Turn lama yang dibuka manual menampilkan tombol kecil *"Tutup lagi"* di sudut atasnya agar dapat langsung dilipat ulang di halaman.

---

## 4. Animation (Motion & Performance Guardrails)

### Motion Personality & Restraint
- **Halus, Smooth, & Premium — namun Hemat GPU dan Bisa Dimatikan:**
  - Menggunakan kurva `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` dan `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` dengan durasi cepat `150–220ms` agar terasa responsif dan tidak kaku.
  - Dilengkapi **Toggle Animasi On/Off** di Popup untuk menonaktifkan seluruh transisi ekstensi secara instan, serta otomatis menghormati `@media (prefers-reduced-motion: reduce)`.
- **Left Strip Magnification & Neighbor Push (Zero Reflow):**
  - Efek strip membesar dan mendorong tetangganya saat di-hover diimplementasikan **murni menggunakan `transform` (`scaleX`, `scaleY`, `translateY`) dan `opacity`** (dengan `transform-origin: left center`), **tanpa menganimasikan `width`, `height`, atau `margin`**.
  - Dengan begitu, efek gelombang/dorongan tetangga tetap 60 FPS mulus tanpa memicu *layout recalculation* pada DOM Gemini yang berat.
- **Tooltip & State Transitions:**
  - Tooltip masuk/keluar menggunakan `opacity` + `transform: translateX(-4px -> 0) scale(0.96 -> 1)` (bukan `scale(0)`), tanpa `transition: all`, dan dibatasi dengan `@media (hover: hover) and (pointer: fine)`.
  - Scroll navigasi menggunakan smooth scroll saat animasi aktif, dan langsung melompat instan (`auto`) saat toggle animasi dimatikan atau `prefers-reduced-motion` aktif.

---

## 5. Open / Left to Builder
- Struktur file internal ekstensi (Vanilla JS + CSS + Manifest V3 tanpa bundler berat agar siap langsung *Load Unpacked* di Chrome/Edge).
- Parameter teknis detail: nilai `contain-intrinsic-size`, interval debounce observer (`~150ms`), jarak piksel dorongan antar strip saat hover, serta pemetaan selector DOM defensif untuk `gemini.google.com`.
