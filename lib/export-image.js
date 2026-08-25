/* Kanban Flow — export du tableau de bord en image (PNG / JPEG)
 *
 * Principe : html2canvas (vendorisé dans lib/html2canvas.min.js, MIT) rasterise
 * le noeud DOM demandé, y compris la partie hors écran — la capture couvre donc
 * la page entière, pas seulement la zone visible.
 *
 * Deux préparations sont indispensables avant la capture :
 *  1. inlineSvgStyles() : nos graphiques SVG tirent leurs couleurs de classes CSS
 *     (.bar-done, .grid, …) définies dans dashboard.css. html2canvas sérialise
 *     chaque <svg> en image indépendante, donc sans la feuille de style : sans
 *     recopie des styles calculés en attributs inline, les barres sortiraient
 *     noires. Les styles sont posés sur le DOM réel puis retirés (aucun effet
 *     visible : les valeurs recopiées sont celles déjà appliquées).
 *  2. openAllDetails() : les listes de tickets sont dans des <details> repliés ;
 *     html2canvas ne rasterise pas ce qui n'est pas affiché. On les ouvre le
 *     temps de la capture, puis on restaure l'état initial.
 */
(function (global) {
  "use strict";

  // Propriétés à recopier en inline sur les noeuds SVG avant sérialisation.
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

  function openAllDetails(root) {
    const closed = Array.prototype.slice.call(
      root.querySelectorAll("details:not([open])")
    );
    closed.forEach((d) => {
      d.open = true;
    });
    return () => closed.forEach((d) => {
      d.open = false;
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
          (b) => (b ? resolve(b) : reject(new Error("canvas vide"))),
          mime,
          quality
        );
      } else {
        // Repli (très anciens moteurs) : data URL → Blob.
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
   * Capture un élément et déclenche le téléchargement de l'image.
   * @param {HTMLElement} node    élément à capturer (toute sa hauteur)
   * @param {Object} opts
   *   format     "png" (défaut) | "jpeg"
   *   scale      facteur de résolution (défaut 2 → image « retina »)
   *   background couleur de fond (obligatoire en JPEG, qui n'a pas d'alpha)
   *   name       base du nom de fichier (nom de l'équipe)
   *   quality    qualité JPEG 0-1 (défaut 0.95)
   * @returns {Promise<{fileName:string,width:number,height:number,bytes:number}>}
   */
  async function exportNode(node, opts) {
    const o = opts || {};
    if (!node) throw new Error("Aucun contenu à exporter.");
    if (typeof global.html2canvas !== "function") {
      throw new Error("Bibliothèque de capture indisponible (html2canvas).");
    }
    const format = o.format === "jpeg" ? "jpeg" : "png";
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const bg =
      o.background ||
      getComputedStyle(document.body).backgroundColor ||
      "#0f1419";

    const restoreDetails = openAllDetails(node);
    const restoreSvg = inlineSvgStyles(node);
    let canvas;
    try {
      canvas = await global.html2canvas(node, {
        backgroundColor: bg,
        scale: o.scale || 2,
        useCORS: false,
        allowTaint: false,
        logging: false,
        // La capture doit couvrir tout le noeud, pas la fenêtre.
        width: node.scrollWidth,
        height: node.scrollHeight,
        windowWidth: Math.max(node.scrollWidth, document.documentElement.clientWidth),
        scrollX: 0,
        scrollY: 0,
      });
    } finally {
      restoreSvg();
      restoreDetails();
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
