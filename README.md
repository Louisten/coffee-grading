# Demo Grading Biji Kopi Hijau (YOLO11n di peramban)

Website demo satu halaman untuk tugas Computer Vision. Model YOLO11n hasil training dijalankan
langsung di peramban melalui ONNX Runtime Web, dan setiap tahap alur (praproses, deteksi,
ambang + NMS, grading SNI 01-2907-2008) diperlihatkan sebagai kanvas bernode yang beranimasi.
Tidak ada server, tidak ada Colab saat demo.

## Isi folder

| Berkas | Keterangan |
|---|---|
| `index.html`, `style.css`, `app.js` | Halaman, gaya, dan orkestrasi alur |
| `pipeline.js` | Letterbox, tensor, decode, NMS, unscale (decode, NMS, unscale murni dan diuji di Node; letterbox, tensor, loadImage butuh peramban) |
| `vendor/` | onnxruntime-web 1.20.1 (ort.min.js dan berkas wasm) disalin lokal agar demo berjalan tanpa internet |
| `grading.js` | Bobot SNI, ambang grade, `gradeCounts` (sama dengan notebook) |
| `model/yolo11n.onnx` | Model hasil export dari Colab (imgsz 640, opset 12) |
| `samples/` | 4 foto contoh dan `expected.json` (hasil prediksi Python sebagai pembanding) |
| `test/` | Unit test Node dan uji kesetaraan di peramban |

## Menjalankan lokal

Halaman tidak bisa dibuka langsung sebagai berkas (`file://`) karena peramban memblokir pemuatan
model. Jalankan server statis sederhana dari folder ini:

```bash
cd demo
python3 -m http.server 8000
```

lalu buka `http://localhost:8000`.

## Menjalankan test

Unit test (perlu Node 18 atau lebih baru):

```bash
cd demo
node --test test/grading.test.js test/pipeline.test.js
```

Uji kesetaraan dengan Python: jalankan server lokal, lalu buka
`http://localhost:8000/test/parity.html`. Hasil harus `PARITY OK`.

## GitHub Pages

1. Buat repositori publik baru di GitHub, misalnya `coffee-grading-demo`.
2. Dari folder `demo`:

```bash
cd demo
git init
git add .
git commit -m "demo website grading biji kopi"
git branch -M main
git remote add origin https://github.com/<nama-pengguna>/coffee-grading-demo.git
git push -u origin main
```

3. Di GitHub: Settings → Pages → Source: branch `main`, folder `/ (root)` → Save.
4. Tunggu sekitar satu menit. Alamatnya `https://<nama-pengguna>.github.io/coffee-grading-demo/`.

Model berukuran sekitar 10 MB dan ikut di-push; itu masih jauh di bawah batas Pages.

## Memperbarui model

1. Jalankan seksi 7 pada `coffee_grading.ipynb` di Colab (`SKIP_TRAINING = True`).
2. Unduh `demo_assets.zip`, ekstrak, ganti `model/` dan `samples/`.
3. Buka `test/parity.html` dan pastikan `PARITY OK` sebelum di-push.

## Catatan

- Tidak butuh internet saat dijalankan lokal: model dan runtime ONNX ada di folder ini. Hanya font
  (Google Fonts) yang diambil dari internet; tanpa internet, peramban memakai font sistem.
- Model ONNX berukuran masukan tetap 640 x 640, sedangkan PyTorch di notebook memakai
  *rectangular inference*. Pada foto yang tidak persegi, hasil web bisa sedikit berbeda dari
  hasil PyTorch di laporan; `samples/expected.json` dibuat dari Ultralytics pada model ONNX agar
  sebanding dengan web.
- Ambang confidence default 0,25 (slider 0,10 sampai 0,90), NMS IoU 0,7.
- Model dilatih pada foto satu biji di atas latar putih; foto nampan atau genggaman berada di
  luar domain pelatihan dan hasilnya tidak dapat diandalkan (dibahas di laporan).
- Tombol MODE CEPAT mematikan jeda animasi antar-langkah.
