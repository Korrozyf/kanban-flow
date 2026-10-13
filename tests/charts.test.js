"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeSvgElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this._textContent = "";
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    assert.equal(value, "");
    this._textContent = "";
    this.children = [];
  }
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

const context = vm.createContext({
  document: { createElementNS: (_namespace, tagName) => new FakeSvgElement(tagName) },
});
context.self = context;
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "lib", "charts.js"), "utf8"),
  context,
  { filename: "lib/charts.js" }
);

test("monthly grouped chart omits bar-value labels but retains accessible data text", () => {
  const container = new FakeSvgElement("div");
  const description = "Jan: 2026 created 5, closed 3; 2025 created 4, closed 2.";

  context.JKDCharts.groupedBarChart(container, {
    title: "Tickets created and closed by month: 2026 vs 2025",
    description,
    labels: ["Jan"],
    series: [
      { label: "Opened / created 2026", values: [5] },
      { label: "Closed 2026", values: [3] },
      { label: "Opened / created 2025", values: [4] },
      { label: "Closed 2025", values: [2] },
    ],
    currentIndex: -1,
    showValues: false,
  });

  const svg = container.children[0];
  const nodes = descendants(svg);
  const valueLabels = nodes.filter((node) =>
    node.tagName === "text" && (node.getAttribute("class") || "").split(/\s+/).includes("bar-value")
  );
  const title = nodes.find((node) => node.tagName === "title");
  const desc = nodes.find((node) => node.tagName === "desc");

  assert.equal(valueLabels.length, 0);
  assert.equal(svg.getAttribute("role"), "img");
  assert.ok(svg.getAttribute("aria-labelledby").includes(title.getAttribute("id")));
  assert.ok(svg.getAttribute("aria-labelledby").includes(desc.getAttribute("id")));
  assert.equal(title.textContent, "Tickets created and closed by month: 2026 vs 2025");
  assert.equal(desc.textContent, description);
});
