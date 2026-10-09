// Skema grading biji kopi hijau. Porting 1:1 dari grade_counts di coffee_grading.ipynb.
// Bobot mengikuti SNI 01-2907-2008, dinormalisasi per 100 biji.
(function (root) {
  const CLASS_NAMES = ["black", "broken", "foreign", "fraghusk", "green", "husk", "immature", "infested", "sour"];

  // kelas dataset -> nilai cacat SNI
  const WEIGHTS = {
    black: 1.0,      // biji hitam
    sour: 0.25,      // biji coklat (padanan terdekat)
    broken: 0.2,     // biji pecah
    immature: 0.2,   // biji muda
    infested: 0.2,   // biji berlubang lebih dari satu
    husk: 0.5,       // kulit kopi ukuran sedang
    fraghusk: 0.2,   // kulit kopi ukuran kecil
    foreign: 1.0,    // benda asing ukuran kecil
    green: 0.0,      // biji normal
  };

  // grade -> batas atas nilai cacat per 100 biji (inklusif); di atas C = D
  const GRADE_THRESHOLDS = { A: 1.0, B: 3.0, C: 6.0 };

  const MIN_BEANS = 50;

  function gradeCounts(counts) {
    const entries = Object.entries(counts || {});
    const total = entries.reduce((s, [, n]) => s + n, 0);
    if (!entries.length || total === 0) throw new Error("tidak ada biji terdeteksi");
    const unknown = entries.map(([c]) => c).filter((c) => !(c in WEIGHTS)).sort();
    if (unknown.length) throw new Error(`kelas tidak dikenal: ${unknown.join(", ")}`);

    const defectBeans = entries.reduce((s, [c, n]) => s + (WEIGHTS[c] > 0 ? n : 0), 0);
    const perClass = entries
      .slice()
      .sort((a, b) => WEIGHTS[b[0]] - WEIGHTS[a[0]])
      .map(([c, n]) => ({ class: c, count: n, weight: WEIGHTS[c], subtotal: n * WEIGHTS[c] }));
    const weighted = perClass.reduce((s, r) => s + r.subtotal, 0);
    const per100 = (weighted / total) * 100;

    let grade = "D";
    for (const [g, limit] of Object.entries(GRADE_THRESHOLDS)) {
      if (per100 <= limit) { grade = g; break; }
    }

    return {
      per_class: perClass,
      total_beans: total,
      defect_beans: defectBeans,
      defect_pct: (defectBeans / total) * 100,
      defect_per_100: per100,
      grade,
      warning: total < MIN_BEANS ? `Sampel kecil (${total} biji, disarankan minimal ${MIN_BEANS}); hasil kurang andal.` : null,
    };
  }

  const api = { CLASS_NAMES, WEIGHTS, GRADE_THRESHOLDS, MIN_BEANS, gradeCounts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Grading = api;
})(typeof window !== "undefined" ? window : globalThis);
