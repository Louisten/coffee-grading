// Orkestrasi demo: muat model, jalankan pipeline langkah demi langkah dengan animasi node,
// gambar kotak deteksi, grading, unduhan. Logika murni ada di pipeline.js dan grading.js.
(() => {
  const ORT_PATH = new URL("vendor/", document.baseURI).href;   // onnxruntime-web 1.20.1 lokal; harus URL absolut untuk import() wasm
  const MODEL_URL = "model/yolo11n.onnx";
  const DEFAULT_CONF = 0.25, MAX_UPLOAD = 20 * 1024 * 1024, MAX_DRAW_W = 1600;
  let STEP_DELAY = 600, BOX_DRAW_INTERVAL = 30;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (REDUCED) { STEP_DELAY = 0; BOX_DRAW_INTERVAL = 0; }

  const $ = (s) => document.querySelector(s);
  const CLASSES = Grading.CLASS_NAMES;
  const CLASS_COLOR = Object.fromEntries(CLASSES.map((c) => [c, getComputedStyle(document.documentElement).getPropertyValue(`--c-${c}`).trim()]));
  const fmt = (v, d = 2) => Number(v).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = { session: null, image: null, fileName: "", meta: null, candidates: [], boxes: [], grade: null,
                  inferMs: 0, conf: DEFAULT_CONF, usedConf: null, running: false, pendingConf: null };
  window.__demo = state;   // untuk inspeksi di console saat debugging

  // ---------- node helpers ----------
  const NODES = ["input", "pre", "yolo", "nms", "grade", "output"];
  const LINKS = { pre: "l-pre", yolo: "l-yolo", nms: "l-nms", grade: "l-grade", output: "l-output" };
  const BADGE = { idle: "MENUNGGU", running: "BERJALAN", done: "SELESAI", failed: "GAGAL" };

  function setNode(id, status, msg) {
    const node = $(`#n-${id}`); node.dataset.status = status;
    node.querySelector(".badge").textContent = BADGE[status];
    const link = LINKS[id] && $(`#${LINKS[id]}`);
    if (link) link.className.baseVal = "link " + (status === "running" ? "active" : status === "done" ? "done" : "");
    if (status === "failed" && msg) { const r = node.querySelector(".result"); if (r) r.innerHTML = `<span style="color:var(--fail)">${msg}</span>`; }
  }
  function resetNodes() {
    NODES.forEach((id) => setNode(id, "idle"));
    $("#pre-thumb").hidden = true; $("#pre-meta").textContent = ""; $("#yolo-meta").textContent = ""; $("#nms-meta").textContent = "";
    $("#class-table tbody").innerHTML = ""; setGrade(null);
    hideWarn(); $("#dl-csv").disabled = $("#dl-png").disabled = true;
  }
  function showWarn(text) { $("#warn-text").textContent = text; $("#n-warn").hidden = false; }
  function hideWarn() { $("#n-warn").hidden = true; }
  function lines(pairs) { return pairs.map(([k, v]) => `<div class="line"><span>${k}</span><span class="num">${v}</span></div>`).join(""); }

  function setGrade(g) {
    const el = $("#grade");
    if (!g) { el.textContent = "-"; delete el.dataset.grade; ["per100", "total", "defect"].forEach((k) => ($(`#m-${k}`).textContent = "-")); return; }
    el.textContent = g.grade; el.dataset.grade = g.grade;
    $("#m-per100").textContent = fmt(g.defect_per_100);
    $("#m-total").textContent = g.total_beans;
    $("#m-defect").textContent = `${g.defect_beans} (${fmt(g.defect_pct, 1)}%)`;
  }

  // ---------- model ----------
  async function loadModel() {
    const st = $("#model-status"); st.dataset.state = "loading"; st.textContent = "memuat model..."; $("#retry").hidden = true;
    try {
      ort.env.wasm.wasmPaths = ORT_PATH;
      state.session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
      st.dataset.state = "ready"; st.textContent = "model siap";
    } catch (e) {
      console.error(e); st.dataset.state = "error"; st.textContent = "model gagal dimuat"; $("#retry").hidden = false;
    }
  }

  // ---------- pipeline (orkestrasi sama dengan test/parity.html) ----------
  async function runPipeline(source, name) {
    if (!state.session) { alert("Model belum siap."); return; }
    if (state.running) return;
    state.running = true; $("#canvas").setAttribute("aria-busy", "true");
    try {
      resetNodes();
      // buang hasil foto sebelumnya agar kegagalan di tengah tidak mencampur kandidat lama dengan foto baru
      Object.assign(state, { image: null, meta: null, candidates: [], boxes: [], grade: null });
      // INPUT
      setNode("input", "running");
      const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
      state.image = await Pipeline.loadImage(blob); state.fileName = name;
      const url = URL.createObjectURL(blob); const thumb = $("#input-thumb"); thumb.src = url; thumb.hidden = false; $("#dropzone-text").hidden = true;
      $("#input-meta").innerHTML = lines([["berkas", name], ["ukuran", `${state.image.width} × ${state.image.height}`]]);
      // letterbox dan tensor dihitung SEBELUM foto digambar ke panel: ImageBitmap yang sudah pernah
      // digambar ke canvas (GPU) memberi piksel berbeda 1/255, cukup untuk menggeser kandidat di ambang.
      const work = document.createElement("canvas"); state.meta = Pipeline.letterbox(state.image, work);
      const tensor = new ort.Tensor("float32", Pipeline.toTensor(work), [1, 3, Pipeline.IMG_SIZE, Pipeline.IMG_SIZE]);
      drawPhoto([]); setNode("input", "done"); await delay(STEP_DELAY);

      // 1 PRAPROSES (tampilkan hasil letterbox yang sudah dihitung)
      setNode("pre", "running"); await delay(STEP_DELAY / 2);
      const preThumb = $("#pre-thumb"); preThumb.width = preThumb.height = Pipeline.IMG_SIZE; preThumb.getContext("2d").drawImage(work, 0, 0); preThumb.hidden = false;
      $("#pre-meta").innerHTML = lines([["skala", fmt(state.meta.scale, 3)], ["bantalan", `${Math.round(state.meta.padX)} / ${Math.round(state.meta.padY)} px`]]);
      setNode("pre", "done"); await delay(STEP_DELAY);

      // 2 YOLO
      setNode("yolo", "running"); $("#yolo-meta").textContent = "menjalankan model...";
      const t0 = performance.now();
      const out = await state.session.run({ [state.session.inputNames[0]]: tensor });
      state.inferMs = performance.now() - t0;
      const o = out[state.session.outputNames[0]];
      state.candidates = Pipeline.decode(o.data, o.dims, CLASSES.length);
      $("#yolo-meta").innerHTML = lines([["keluaran", `[${o.dims.join(", ")}]`], ["kandidat", state.candidates.length], ["waktu", `${fmt(state.inferMs, 0)} ms`]]);
      setNode("yolo", "done"); await delay(STEP_DELAY);

      await runFromNms();
    } catch (e) {
      console.error(e);
      const active = NODES.find((id) => $(`#n-${id}`).dataset.status === "running") || "yolo";
      setNode(active, "failed", e.message);
    } finally { finish(); }
  }

  // satu pintu keluar untuk runPipeline dan applyConf: lepas kunci, lalu terapkan conf yang
  // berubah selama proses berjalan (hanya bila berbeda dari yang terakhir dipakai NMS)
  function finish() {
    state.running = false; $("#canvas").setAttribute("aria-busy", "false");
    const pending = state.pendingConf; state.pendingConf = null;
    if (pending !== null && pending !== state.usedConf && state.candidates.length) applyConf(pending);
  }

  async function runFromNms() {
    // 3 NMS
    hideWarn(); setNode("nms", "running"); await delay(STEP_DELAY / 2);
    state.usedConf = state.conf;
    const { kept, dropped } = Pipeline.nms(state.candidates, state.conf);
    state.boxes = kept.map((k) => ({ ...k, box: Pipeline.unscale(k.box, state.meta) }));
    $("#nms-meta").innerHTML = lines([["ambang", fmt(state.conf)], ["dipertahankan", kept.length], ["dibuang", dropped]]);
    setNode("nms", "done");
    await drawBoxes(state.boxes, true);
    if (!state.boxes.length) {
      state.grade = null; setGrade(null); $("#class-table tbody").innerHTML = "";
      setNode("grade", "idle"); setNode("output", "idle");
      showWarn("Tidak ada biji terdeteksi; coba turunkan ambang confidence. Foto di luar domain pelatihan (bukan biji di latar putih) sering tidak terdeteksi.");
      return;
    }
    await delay(STEP_DELAY);

    // 4 GRADING
    setNode("grade", "running");
    const counts = {}; for (const b of state.boxes) counts[CLASSES[b.cls]] = (counts[CLASSES[b.cls]] || 0) + 1;
    state.grade = Grading.gradeCounts(counts);
    const tbody = $("#class-table tbody"); tbody.innerHTML = "";
    for (const r of state.grade.per_class) {
      const tr = document.createElement("tr"); tr.dataset.cls = r.class;
      tr.innerHTML = `<td><span class="swatch" style="background:${CLASS_COLOR[r.class]}"></span>${r.class}</td><td class="r"><span class="dim">${r.count} × ${fmt(r.weight)} =</span> ${fmt(r.subtotal)}</td>`;
      tr.addEventListener("mouseenter", () => drawPhoto(state.boxes, r.class)); tr.addEventListener("mouseleave", () => drawPhoto(state.boxes));
      tbody.appendChild(tr); await delay(STEP_DELAY ? 120 : 0); tr.classList.add("in");
    }
    setNode("grade", "done"); await delay(STEP_DELAY);

    // OUTPUT
    setNode("output", "running"); await delay(STEP_DELAY / 2);
    setGrade(state.grade); $("#dl-csv").disabled = $("#dl-png").disabled = false;
    setNode("output", "done");
    if (state.grade.warning) showWarn(state.grade.warning);
  }

  function applyConf(c) {
    state.conf = c; $("#conf-label").textContent = fmt(c);
    if (!state.candidates.length || !state.meta) return;
    if (state.running) { state.pendingConf = c; return; }
    state.running = true; $("#canvas").setAttribute("aria-busy", "true");
    ["grade", "output"].forEach((id) => setNode(id, "idle")); $("#dl-csv").disabled = $("#dl-png").disabled = true;
    runFromNms().catch((e) => { console.error(e); setNode("nms", "failed", e.message); }).finally(finish);
  }

  // ---------- panel foto ----------
  function drawPhoto(boxes, highlight) {
    const img = state.image; if (!img) return;
    const c = $("#photo"); $("#photo-empty").hidden = true; c.hidden = false;
    const s = Math.min(1, MAX_DRAW_W / img.width);           // foto sangat besar digambar diperkecil
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height);
    const lw = Math.max(1.5, c.width / 400), fs = Math.max(11, c.width / 60);
    ctx.font = `600 ${fs}px "JetBrains Mono", monospace`; ctx.textBaseline = "top";
    for (const b of boxes) {
      const name = CLASSES[b.cls], col = CLASS_COLOR[name], dimmed = highlight && name !== highlight;
      const [x1, y1, x2, y2] = b.box.map((v) => v * s);
      ctx.globalAlpha = dimmed ? 0.2 : 1; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const label = `${name} ${fmt(b.score)}`, tw = ctx.measureText(label).width + 8, th = fs + 6, ty = y1 - th < 0 ? y1 : y1 - th;
      ctx.fillStyle = col; ctx.fillRect(x1, ty, tw, th); ctx.fillStyle = "#fff"; ctx.fillText(label, x1 + 4, ty + 3);
    }
    ctx.globalAlpha = 1;
  }
  async function drawBoxes(boxes, progressive) {
    if (!progressive || !BOX_DRAW_INTERVAL) { drawPhoto(boxes); return; }
    for (let i = 1; i <= boxes.length; i++) { drawPhoto(boxes.slice(0, i)); await delay(BOX_DRAW_INTERVAL); }
    if (!boxes.length) drawPhoto([]);
  }
  function buildLegend() {
    $("#legend").innerHTML = CLASSES.map((c) => `<li><span class="swatch" style="background:${CLASS_COLOR[c]}"></span>${c}</li>`).join("");
  }

  // ---------- unduhan (format CSV sama dengan grade_image di notebook) ----------
  function csvText() {
    const g = state.grade;
    const head = "class,count,weight,subtotal\n" + g.per_class.map((r) => `${r.class},${r.count},${r.weight},${r.subtotal}`).join("\n") + "\n";
    const summary = "total_biji,biji_cacat,persen_cacat,nilai_cacat_per_100,grade,peringatan\n" +
      `${g.total_beans},${g.defect_beans},${g.defect_pct.toFixed(2)},${g.defect_per_100.toFixed(3)},${g.grade},${g.warning ? `"${g.warning}"` : ""}\n`;
    return head + "\n" + summary;
  }
  function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  function downloadCsv() { download("hasil_grading.csv", new Blob([csvText()], { type: "text/csv" })); }
  function downloadPng() { drawPhoto(state.boxes); $("#photo").toBlob((b) => download("beranotasi.png", b), "image/png"); }

  // ---------- input ----------
  function acceptFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { $("#input-meta").innerHTML = `<span style="color:#FF8A80">Berkas bukan gambar.</span>`; return; }
    if (file.size > MAX_UPLOAD) { $("#input-meta").innerHTML = `<span style="color:#FF8A80">Berkas melebihi 20 MB.</span>`; return; }
    runPipeline(file, file.name);
  }

  function bind() {
    const dz = $("#dropzone"), fi = $("#file");
    fi.addEventListener("change", () => { acceptFile(fi.files[0]); fi.value = ""; });
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); } });
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => acceptFile(e.dataTransfer.files[0]));
    // foto yang dijatuhkan di luar zona: jangan biarkan peramban membuka berkasnya dan meninggalkan demo
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => { e.preventDefault(); if (!dz.contains(e.target)) acceptFile(e.dataTransfer.files[0]); });
    document.querySelectorAll(".sample").forEach((b) => b.addEventListener("click", () => runPipeline(b.dataset.src, b.dataset.src.split("/").pop())));
    const slider = $("#conf");
    slider.addEventListener("input", () => ($("#conf-label").textContent = fmt(parseFloat(slider.value))));
    slider.addEventListener("change", () => applyConf(parseFloat(slider.value)));
    $("#fast").addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", String(on));
      STEP_DELAY = on || REDUCED ? 0 : 600; BOX_DRAW_INTERVAL = on || REDUCED ? 0 : 30;
    });
    $("#retry").addEventListener("click", loadModel);
    $("#dl-csv").addEventListener("click", downloadCsv); $("#dl-png").addEventListener("click", downloadPng);
  }

  document.addEventListener("DOMContentLoaded", () => { buildLegend(); bind(); loadModel(); });
})();
