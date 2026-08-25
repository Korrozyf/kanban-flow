/* Kanban Flow — mini SVG chart library (no dependency) */
(function (global) {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function niceMax(v) {
    if (!v || v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const norm = v / mag;
    let step;
    if (norm <= 1) step = 1;
    else if (norm <= 2) step = 2;
    else if (norm <= 5) step = 5;
    else step = 10;
    return step * mag;
  }

  // Bar chart. opts: { labels, values, unit, highlightLast, color }
  function barChart(container, opts) {
    container.innerHTML = "";
    const W = 560, H = 260;
    const m = { top: 20, right: 16, bottom: 40, left: 44 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;
    const values = opts.values.map((v) => (v == null || isNaN(v) ? 0 : v));
    const max = niceMax(Math.max(1, ...values));
    const svg = el("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "chart",
      preserveAspectRatio: "xMidYMid meet",
    });

    // grid + Y axis
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const val = (max / ticks) * i;
      const y = m.top + ih - (val / max) * ih;
      svg.appendChild(el("line", {
        x1: m.left, y1: y, x2: m.left + iw, y2: y, class: "grid",
      }));
      svg.appendChild(el("text", {
        x: m.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end",
      }, String(Math.round(val))));
    }

    const n = values.length;
    const curIdx = opts.currentIndex != null
      ? opts.currentIndex
      : (opts.highlightLast ? n - 1 : -1);
    const band = iw / n;
    const bw = Math.min(70, band * 0.6);
    values.forEach((v, i) => {
      const x = m.left + band * i + (band - bw) / 2;
      const h = (v / max) * ih;
      const y = m.top + ih - h;
      const isCurrent = i === curIdx;
      svg.appendChild(el("rect", {
        x, y, width: bw, height: Math.max(0, h),
        rx: 4, class: "bar" + (isCurrent ? " bar-current" : ""),
      }));
      svg.appendChild(el("text", {
        x: x + bw / 2, y: y - 6, class: "bar-value", "text-anchor": "middle",
      }, String(v)));
      svg.appendChild(el("text", {
        x: x + bw / 2, y: m.top + ih + 18, class: "axis-label", "text-anchor": "middle",
      }, opts.labels[i]));
    });
    svg.appendChild(el("line", {
      x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih, class: "axis",
    }));
    container.appendChild(svg);
  }

  // Grouped bar chart (several series side by side per week).
  // opts: { labels, series: [{ values, className }], currentIndex }
  // The current week is highlighted with a yellow background band.
  function groupedBarChart(container, opts) {
    container.innerHTML = "";
    const W = 560, H = 260;
    const m = { top: 20, right: 16, bottom: 40, left: 44 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;
    const series = opts.series || [];
    const clean = (v) => (v == null || isNaN(v) ? 0 : v);
    let peak = 1;
    series.forEach((s) => s.values.forEach((v) => (peak = Math.max(peak, clean(v)))));
    const max = niceMax(peak);
    const svg = el("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "chart",
      preserveAspectRatio: "xMidYMid meet",
    });

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const val = (max / ticks) * i;
      const y = m.top + ih - (val / max) * ih;
      svg.appendChild(el("line", {
        x1: m.left, y1: y, x2: m.left + iw, y2: y, class: "grid",
      }));
      svg.appendChild(el("text", {
        x: m.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end",
      }, String(Math.round(val))));
    }

    const n = opts.labels.length;
    const curIdx = opts.currentIndex != null ? opts.currentIndex : -1;
    const band = iw / n;
    const groupW = Math.min(band * 0.72, 96);
    const ns = Math.max(1, series.length);
    const bw = groupW / ns;

    for (let i = 0; i < n; i++) {
      const gx = m.left + band * i + (band - groupW) / 2;
      // Background band for the current week.
      if (i === curIdx) {
        svg.appendChild(el("rect", {
          x: m.left + band * i + 2, y: m.top,
          width: band - 4, height: ih, rx: 6, class: "band-current",
        }));
      }
      const isCur = i === curIdx;
      series.forEach((s, si) => {
        const v = clean(s.values[i]);
        const h = (v / max) * ih;
        const x = gx + bw * si;
        const y = m.top + ih - h;
        // The current week uses a dedicated warm colour per series.
        const barCls = isCur && s.currentClassName ? s.currentClassName : (s.className || "");
        svg.appendChild(el("rect", {
          x: x + 1, y, width: Math.max(1, bw - 2), height: Math.max(0, h),
          rx: 3, class: "bar " + barCls,
        }));
        svg.appendChild(el("text", {
          x: x + bw / 2, y: y - 5,
          class: "bar-value" + (isCur ? " bar-value-current" : ""),
          "text-anchor": "middle",
        }, String(v)));
      });
      svg.appendChild(el("text", {
        x: m.left + band * i + band / 2, y: m.top + ih + 18,
        class: "axis-label" + (isCur ? " axis-label-current" : ""), "text-anchor": "middle",
      }, opts.labels[i]));
    }
    svg.appendChild(el("line", {
      x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih, class: "axis",
    }));
    container.appendChild(svg);
  }

  // Line chart. opts: { labels, values, unit }
  function lineChart(container, opts) {
    container.innerHTML = "";
    const W = 560, H = 260;
    const m = { top: 20, right: 16, bottom: 40, left: 44 };
    const iw = W - m.left - m.right;
    const ih = H - m.top - m.bottom;
    const raw = opts.values;
    const nums = raw.filter((v) => v != null && !isNaN(v));
    const max = niceMax(Math.max(1, ...(nums.length ? nums : [1])));
    const svg = el("svg", {
      viewBox: `0 0 ${W} ${H}`, class: "chart", preserveAspectRatio: "xMidYMid meet",
    });

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const val = (max / ticks) * i;
      const y = m.top + ih - (val / max) * ih;
      svg.appendChild(el("line", { x1: m.left, y1: y, x2: m.left + iw, y2: y, class: "grid" }));
      svg.appendChild(el("text", {
        x: m.left - 8, y: y + 4, class: "axis-label", "text-anchor": "end",
      }, val.toFixed(val < 10 ? 1 : 0)));
    }

    const n = raw.length;
    const curIdx = opts.currentIndex != null ? opts.currentIndex : -1;
    const band = iw / n;
    const cx = (i) => m.left + band * i + band / 2;
    const cy = (v) => m.top + ih - (v / max) * ih;

    // Segments connecting valid points; the segment leading to the current
    // week is drawn as a yellow dashed line (incomplete data).
    let prev = null;
    raw.forEach((v, i) => {
      if (v == null || isNaN(v)) { prev = null; return; }
      if (prev !== null) {
        const toCurrent = i === curIdx;
        svg.appendChild(el("line", {
          x1: cx(prev.i), y1: cy(prev.v), x2: cx(i), y2: cy(v),
          class: toCurrent ? "line-current" : "line",
        }));
      }
      prev = { i, v };
    });
    raw.forEach((v, i) => {
      const isCurrent = i === curIdx;
      svg.appendChild(el("text", {
        x: cx(i), y: m.top + ih + 18,
        class: "axis-label" + (isCurrent ? " axis-label-current" : ""),
        "text-anchor": "middle",
      }, opts.labels[i]));
      if (v == null || isNaN(v)) return;
      svg.appendChild(el("circle", {
        cx: cx(i), cy: cy(v), r: isCurrent ? 5.5 : 4,
        class: "dot" + (isCurrent ? " dot-current" : ""),
      }));
      svg.appendChild(el("text", {
        x: cx(i), y: cy(v) - 10,
        class: "bar-value" + (isCurrent ? " bar-value-current" : ""),
        "text-anchor": "middle",
      }, v.toFixed(1)));
    });
    svg.appendChild(el("line", {
      x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih, class: "axis",
    }));
    container.appendChild(svg);
  }

  global.JKDCharts = { barChart, groupedBarChart, lineChart };
})(typeof self !== "undefined" ? self : this);
