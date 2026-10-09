const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../pipeline.js");

test("letterboxMeta lanskap 1280x960", () => {
  const m = P.letterboxMeta(1280, 960);
  assert.equal(m.scale, 0.5);
  assert.equal(m.newW, 640);
  assert.equal(m.newH, 480);
  assert.equal(m.padX, 0);
  assert.equal(m.padY, 80);
});

test("letterboxMeta potret 600x800", () => {
  const m = P.letterboxMeta(600, 800);
  assert.equal(m.newH, 640);
  assert.equal(m.newW, 480);
  assert.equal(m.padX, 80);
  assert.equal(m.padY, 0);
});

test("decode menolak bentuk salah", () => {
  assert.throws(() => P.decode(new Float32Array(10), [1, 10, 1]), /bentuk keluaran/);
  assert.throws(() => P.decode(new Float32Array(13), [13, 1]), /bentuk keluaran/);
});

test("decode: layout [1,13,N] kolom per kandidat, skor = maks kelas", () => {
  const N = 2, C = 9, data = new Float32Array(13 * N);
  // kandidat 0: cx=100 cy=100 w=20 h=40, kelas 4 skor 0.9 ; kandidat 1: skor maks 0.005 (dibuang)
  data[0 * N + 0] = 100; data[1 * N + 0] = 100; data[2 * N + 0] = 20; data[3 * N + 0] = 40; data[(4 + 4) * N + 0] = 0.9;
  data[0 * N + 1] = 50; data[1 * N + 1] = 50; data[2 * N + 1] = 10; data[3 * N + 1] = 10; data[(4 + 0) * N + 1] = 0.005;
  const c = P.decode(data, [1, 13, N], C);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].box, [90, 80, 110, 120]);
  assert.equal(c[0].cls, 4);
  assert.ok(Math.abs(c[0].score - 0.9) < 1e-6);
});

test("iou", () => {
  assert.equal(P.iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(P.iou([0, 0, 10, 10], [20, 20, 30, 30]), 0);
  assert.ok(Math.abs(P.iou([0, 0, 10, 10], [5, 0, 15, 10]) - 1 / 3) < 1e-9);
});

test("nms: tumpang tindih kelas sama -> satu; kelas beda -> dua; conf menyaring", () => {
  const c = [
    { box: [0, 0, 10, 10], cls: 0, score: 0.9 },
    { box: [1, 1, 10, 10], cls: 0, score: 0.8 },
    { box: [1, 1, 10, 10], cls: 1, score: 0.7 },
    { box: [50, 50, 60, 60], cls: 0, score: 0.2 },
  ];
  const r = P.nms(c, 0.25);
  assert.equal(r.kept.length, 2);
  assert.equal(r.dropped, 2);
  assert.equal(r.kept[0].score, 0.9);
});

test("nms MAX_DET", () => {
  const c = Array.from({ length: 400 }, (_, i) => ({ box: [i * 20, 0, i * 20 + 10, 10], cls: 0, score: 0.5 }));
  assert.equal(P.nms(c, 0.25).kept.length, P.MAX_DET);
});

test("unscale dan clamp", () => {
  const m = { ...P.letterboxMeta(1280, 960), w: 1280, h: 960 };
  assert.deepEqual(P.unscale([0, 80, 640, 560], m), [0, 0, 1280, 960]);
  assert.deepEqual(P.unscale([-10, 70, 650, 570], m), [0, 0, 1280, 960]);
});

test("loadImage: fallback tanpa opsi bila imageOrientation tidak didukung (Safari lama)", async () => {
  const calls = [];
  globalThis.createImageBitmap = (file, opts) => { calls.push(opts); return opts ? Promise.reject(new TypeError("unsupported")) : Promise.resolve("bitmap"); };
  try {
    assert.equal(await P.loadImage("file"), "bitmap");
    assert.deepEqual(calls, [{ imageOrientation: "from-image" }, undefined]);
  } finally { delete globalThis.createImageBitmap; }
});
