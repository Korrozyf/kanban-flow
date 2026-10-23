"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadExporter() {
  const createdCanvases = [];
  const downloads = [];
  const originalCanvas = {
    width: 600,
    height: 400,
  };
  let captureOptions;

  class FakeCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.drawCalls = [];
      this.fillRects = [];
      this.context = {
        fillStyle: "",
        fillRect: (...args) => this.fillRects.push(args),
        drawImage: (...args) => this.drawCalls.push(args),
      };
      createdCanvases.push(this);
    }

    getContext(type) {
      return type === "2d" ? this.context : null;
    }

    toBlob(callback, type) {
      callback(new Blob(["image"], { type }));
    }
  }

  const document = {
    documentElement: { clientWidth: 320 },
    body: {
      appendChild() {},
    },
    createElement(tagName) {
      if (tagName === "canvas") return new FakeCanvas();
      return {
        style: {},
        click() { downloads.push(this); },
        remove() {},
      };
    },
  };
  const context = vm.createContext({
    Blob,
    document,
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL() {},
    },
    getComputedStyle(element) {
      if (element === document.body) return { backgroundColor: "#0f1419" };
      return { getPropertyValue: () => "" };
    },
    setTimeout() {},
  });
  context.self = context;
  context.html2canvas = async (_node, options) => {
    captureOptions = options;
    return originalCanvas;
  };
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "lib", "export-image.js"), "utf8"),
    context,
    { filename: "lib/export-image.js" }
  );

  return {
    context,
    createdCanvases,
    downloads,
    originalCanvas,
    getCaptureOptions: () => captureOptions,
  };
}

function fakeNode() {
  return {
    scrollWidth: 300,
    querySelectorAll: () => [],
  };
}

test("image export adds a 10 CSS-pixel margin around the full dashboard", async () => {
  const harness = loadExporter();
  const result = await harness.context.JKDExport.exportNode(fakeNode(), { name: "Operations" });
  const padded = harness.createdCanvases[0];

  assert.equal(harness.getCaptureOptions().width, 300);
  assert.equal(harness.getCaptureOptions().scale, 2);
  assert.equal(padded.width, 640);
  assert.equal(padded.height, 440);
  assert.equal(padded.context.fillStyle, "#0f1419");
  assert.deepEqual(padded.fillRects[0], [0, 0, 640, 440]);
  assert.equal(padded.drawCalls.length, 1);
  assert.equal(padded.drawCalls[0][0], harness.originalCanvas);
  assert.equal(padded.drawCalls[0][1], 20);
  assert.equal(padded.drawCalls[0][2], 20);
  assert.equal(result.width, 640);
  assert.equal(result.height, 440);
  assert.equal(harness.downloads.length, 1);
});

test("image margin scales with the requested raster resolution", async () => {
  const harness = loadExporter();
  await harness.context.JKDExport.exportNode(fakeNode(), { scale: 1.5 });
  const padded = harness.createdCanvases[0];

  assert.equal(padded.width, 630);
  assert.equal(padded.height, 430);
  assert.equal(padded.drawCalls[0][1], 15);
  assert.equal(padded.drawCalls[0][2], 15);
});
