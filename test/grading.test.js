const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gradeCounts, WEIGHTS, GRADE_THRESHOLDS, MIN_BEANS, CLASS_NAMES } = require("../grading.js");

test("contoh spec: 2 black, 5 broken, 93 green -> 3.0 grade B", () => {
  const r = gradeCounts({ black: 2, broken: 5, green: 93 });
  assert.equal(r.total_beans, 100);
  assert.equal(r.defect_beans, 7);
  assert.ok(Math.abs(r.defect_pct - 7) < 1e-9);
  assert.ok(Math.abs(r.defect_per_100 - 3) < 1e-9);
  assert.equal(r.grade, "B");
  assert.equal(r.warning, null);
});

test("semua green -> 0, A", () => {
  const r = gradeCounts({ green: 60 });
  assert.equal(r.defect_per_100, 0);
  assert.equal(r.grade, "A");
});

test("sampel kecil -> peringatan dan D", () => {
  const r = gradeCounts({ green: 10, black: 1 });
  assert.ok(r.warning);
  assert.equal(r.grade, "D");
});

test("kosong -> error", () => {
  assert.throws(() => gradeCounts({}), /tidak ada biji/);
  assert.throws(() => gradeCounts({ green: 0 }), /tidak ada biji/);
});

test("kelas tak dikenal -> error", () => {
  assert.throws(() => gradeCounts({ purple: 1 }), /kelas tidak dikenal/);
});

test("baris per kelas", () => {
  const r = gradeCounts({ black: 2, green: 8 });
  const rows = Object.fromEntries(r.per_class.map((x) => [x.class, x]));
  assert.deepEqual(rows.black, { class: "black", count: 2, weight: 1, subtotal: 2 });
  assert.equal(rows.green.weight, 0);
  assert.equal(r.per_class[0].class, "black");
});

test("batas ambang 1/3/6/7", () => {
  assert.equal(gradeCounts({ black: 1, green: 99 }).grade, "A");
  assert.equal(gradeCounts({ black: 3, green: 97 }).grade, "B");
  assert.equal(gradeCounts({ black: 6, green: 94 }).grade, "C");
  assert.equal(gradeCounts({ black: 7, green: 93 }).grade, "D");
});

test("konstanta", () => {
  assert.deepEqual(new Set(Object.keys(WEIGHTS)), new Set(CLASS_NAMES));
  assert.deepEqual(Object.keys(GRADE_THRESHOLDS), ["A", "B", "C"]);
  assert.equal(MIN_BEANS, 50);
  assert.deepEqual(CLASS_NAMES, ["black", "broken", "foreign", "fraghusk", "green", "husk", "immature", "infested", "sour"]);
});
