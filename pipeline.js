// Pipeline inferensi YOLO11 di browser: letterbox, tensor, decode, NMS, unscale.
// Fungsi murni (letterboxMeta, decode, iou, nms, unscale) diuji di Node; sisanya butuh canvas.
(function (root) {
  const IMG_SIZE = 640;
  const PAD_COLOR = [114, 114, 114];
  const IOU_THRESHOLD = 0.7;
  const CANDIDATE_MIN_SCORE = 0.01;
  const MAX_DET = 300;

  // skala dan bantalan agar gambar w x h muat di IMG_SIZE x IMG_SIZE dengan rasio tetap (Ultralytics LetterBox)
  function letterboxMeta(w, h) {
    const scale = Math.min(IMG_SIZE / w, IMG_SIZE / h);
    const newW = Math.round(w * scale), newH = Math.round(h * scale);
    return { scale, newW, newH, padX: (IMG_SIZE - newW) / 2, padY: (IMG_SIZE - newH) / 2 };
  }

  // browser: gambar img ke canvas IMG_SIZE x IMG_SIZE di atas bantalan abu-abu
  function letterbox(img, canvas) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const meta = { ...letterboxMeta(w, h), w, h };
    canvas.width = IMG_SIZE; canvas.height = IMG_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `rgb(${PAD_COLOR.join(",")})`;
    ctx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);               // PNG transparan jatuh ke abu-abu, bukan hitam
    ctx.drawImage(img, Math.round(meta.padX), Math.round(meta.padY), meta.newW, meta.newH);
    return meta;
  }

  // browser: canvas -> Float32Array [1,3,640,640], RGB, CHW, 0..1
  function toTensor(canvas) {
    const { data } = canvas.getContext("2d").getImageData(0, 0, IMG_SIZE, IMG_SIZE);
    const n = IMG_SIZE * IMG_SIZE, out = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      out[i] = data[i * 4] / 255;
      out[n + i] = data[i * 4 + 1] / 255;
      out[2 * n + i] = data[i * 4 + 2] / 255;
    }
    return out;
  }

  // keluaran [1, 4+C, N] -> kandidat {box xyxy (koordinat 640), cls, score}
  function decode(data, dims, numClasses = 9) {
    if (!dims || dims.length !== 3 || dims[0] !== 1 || dims[1] !== 4 + numClasses) {
      throw new Error(`bentuk keluaran model tidak dikenal: [${(dims || []).join(", ")}], diharapkan [1, ${4 + numClasses}, N]`);
    }
    const N = dims[2], out = [];
    for (let i = 0; i < N; i++) {
      let cls = 0, score = data[4 * N + i];
      for (let c = 1; c < numClasses; c++) {
        const s = data[(4 + c) * N + i];
        if (s > score) { score = s; cls = c; }
      }
      if (score < CANDIDATE_MIN_SCORE) continue;
      const cx = data[i], cy = data[N + i], w = data[2 * N + i], h = data[3 * N + i];
      out.push({ box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], cls, score });
    }
    return out;
  }

  function iou(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy;
    const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return union > 0 ? inter / union : 0;
  }

  // greedy NMS per kelas; mengembalikan kotak yang dipertahankan dan jumlah yang dibuang
  function nms(cands, conf, iouThr = IOU_THRESHOLD) {
    const sorted = cands.filter((c) => c.score >= conf).sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of sorted) {
      if (kept.length >= MAX_DET) break;
      if (kept.every((k) => k.cls !== c.cls || iou(k.box, c.box) <= iouThr)) kept.push(c);
    }
    return { kept, dropped: cands.length - kept.length };
  }

  // kotak 640 -> koordinat foto asli, di-clamp ke ukuran foto
  function unscale(box, meta) {
    const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
    return [
      clamp((box[0] - meta.padX) / meta.scale, meta.w),
      clamp((box[1] - meta.padY) / meta.scale, meta.h),
      clamp((box[2] - meta.padX) / meta.scale, meta.w),
      clamp((box[3] - meta.padY) / meta.scale, meta.h),
    ];
  }

  // browser: File/Blob -> ImageBitmap dengan orientasi EXIF diterapkan
  function loadImage(file) {
    // Safari lama tidak mengenal "from-image" dan melempar TypeError; jatuh ke tanpa opsi
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  }

  const api = { IMG_SIZE, PAD_COLOR, IOU_THRESHOLD, CANDIDATE_MIN_SCORE, MAX_DET,
                letterboxMeta, letterbox, toTensor, decode, iou, nms, unscale, loadImage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pipeline = api;
})(typeof window !== "undefined" ? window : globalThis);
