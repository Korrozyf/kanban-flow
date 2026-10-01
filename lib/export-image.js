/* Kanban Flow — dashboard image export (PNG / JPEG)
 *
 * Principle: html2canvas (vendored in lib/html2canvas.min.js, MIT) rasterises the
 * requested DOM node, including the part that is off-screen — so the capture
 * covers the whole page, not just the visible area.
 *
 * Two preparation steps run before every capture:
 *  1. inlineSvgStyles(): our SVG charts get their colours from CSS classes
 *     (.bar-done, .grid, …) defined in dashboard.css. html2canvas serialises each
 *     <svg> as a standalone image, therefore without the stylesheet: without
 *     copying the computed styles into inline attributes, the bars would come out
 *     black. The styles are applied to the real DOM then removed again (no
 *     visible effect: the copied values are the ones already in force).
 *  2. prepareTicketLists(): native closed <details> content can leak into
 *     html2canvas output in some browsers. Ticket lists are therefore opened or
 *     removed in html2canvas's cloned document only; the live page is untouched.
 */
(function (global) {
  "use strict";

  // Properties copied inline onto the SVG nodes before serialisation.
  const SVG_PROPS = [
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-dasharray",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "letter-spacing",
    "dominant-baseline",
  ];

  function inlineSvgStyles(root) {
    const nodes = root.querySelectorAll("svg, svg *");
    const saved = [];
    nodes.forEach((n) => {
      saved.push([n, n.getAttribute("style")]);
      const cs = getComputedStyle(n);
      for (const p of SVG_PROPS) {
        const v = cs.getPropertyValue(p);
        if (v) n.style.setProperty(p, v);
      }
    });
    return () => {
      for (const [n, prev] of saved) {
        if (prev == null) n.removeAttribute("style");
        else n.setAttribute("style", prev);
      }
    };
  }

  function prepareTicketLists(root, includeLists) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll("details.list-details").forEach((details) => {
      details.open = includeLists;
      if (!includeLists) {
        // html2canvas may paint part of a closed <details> body despite its
        // native hidden state. Remove ticket-list content from the capture
        // clone rather than relying on CSS/display rules to suppress it.
        Array.from(details.children).forEach((child) => {
          if (child.tagName !== "SUMMARY") child.remove();
        });
      }
    });
  }

  function slug(s) {
    return String(s || "dashboard")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "dashboard";
  }

  function stamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" + p(d.getMonth() + 1) +
      "-" + p(d.getDate()) +
      "_" + p(d.getHours()) + "h" + p(d.getMinutes())
    );
  }

  function buildFileName(name, format) {
    const ext = format === "jpeg" ? "jpg" : "png";
    return `kanban-flow_${slug(name)}_${stamp(new Date())}.${ext}`;
  }

  function toBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("empty canvas"))),
          mime,
          quality
        );
      } else {
        // Fallback (very old engines): data URL → Blob.
        try {
          const url = canvas.toDataURL(mime, quality);
          const bin = atob(url.split(",")[1]);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          resolve(new Blob([buf], { type: mime }));
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  function download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 10000);
  }

  /**
   * Capture an element and trigger the image download.
   * @param {HTMLElement} node    element to capture (its full height)
   * @param {Object} opts
   *   format     "png" (default) | "jpeg"
   *   scale      resolution factor (default 2 → "retina" image)
   *   background background colour (required for JPEG, which has no alpha)
   *   name       file name base (team name)
   *   quality    JPEG quality 0-1 (default 0.95)
   *   includeDetails include ticket lists in the image (default false),
   *                 independently of their on-screen open/closed state
   * @returns {Promise<{fileName:string,width:number,height:number,bytes:number}>}
   */
  async function exportNode(node, opts) {
    const o = opts || {};
    if (!node) throw new Error("Nothing to export.");
    if (typeof global.html2canvas !== "function") {
      throw new Error("Capture library unavailable (html2canvas).");
    }
    const format = o.format === "jpeg" ? "jpeg" : "png";
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const bg =
      o.background ||
      getComputedStyle(document.body).backgroundColor ||
      "#0f1419";

    const restoreSvg = inlineSvgStyles(node);
    let canvas;
    try {
      canvas = await global.html2canvas(node, {
        backgroundColor: bg,
        scale: o.scale || 2,
        useCORS: false,
        allowTaint: false,
        logging: false,
        // The cloned node's height is measured after ticket lists are prepared,
        // so included lists fit and excluded lists cannot leave stale blank space.
        width: node.scrollWidth,
        windowWidth: Math.max(node.scrollWidth, document.documentElement.clientWidth),
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc, clonedNode) => {
          const captureRoot = clonedNode || (node.id && clonedDoc.getElementById(node.id));
          prepareTicketLists(captureRoot, !!o.includeDetails);
        },
      });
    } finally {
      restoreSvg();
    }

    const blob = await toBlob(canvas, mime, o.quality == null ? 0.95 : o.quality);
    const fileName = buildFileName(o.name, format);
    download(blob, fileName);
    return {
      fileName,
      width: canvas.width,
      height: canvas.height,
      bytes: blob.size,
    };
  }

  global.JKDExport = { exportNode, buildFileName, slug };
})(typeof self !== "undefined" ? self : this);
