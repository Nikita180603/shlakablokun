(function () {
  const GROUT = "#e6dfd2";
  const CATS = [
    { id: "all", name: "Все" },
    { id: "tile", name: "Плитка" },
    { id: "block", name: "Шлакоблок" },
    { id: "border", name: "Бордюр" },
    { id: "bulk", name: "Сыпучие" },
  ];

  const state = {
    cat: "all",
    color: "all",
    thick: "all",
    sort: "pop",
    q: "",
    order: null,
    calc: {
      project: "yard",
      productId: "kirpich-60",
      colorId: "gray",
      amount: 40,
      reserve: 5,
      borderId: "border-garden",
      borderMeters: 24,
      withBase: true,
      delivery: "city",
      yardLength: 8,
      yardWidth: 5,
      pattern: "straight",
      houseLength: 10,
      houseWidth: 8,
      houseHeight: 3,
      houseOpenings: 12,
    },
  };

  let cart = [];
  let favs = [];
  let compare = [];
  let buyBarWatch = null;
  let promoTimer = 0;
  let promoWatch = null;

  function productById(id) {
    return PRODUCTS.find((p) => p.id === id) || null;
  }

  function colorObj(product, colorId) {
    return product.colors.find((c) => c.id === colorId) || product.colors[0];
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function t(key) {
    const bag = window.COPY || {};
    return bag[key] != null ? String(bag[key]) : "";
  }

  function lines(key) {
    return esc(t(key)).replace(/\n/g, "<br>");
  }

  function fill(key, map) {
    let s = esc(t(key));
    Object.keys(map || {}).forEach((name) => {
      s = s.split("{" + name + "}").join(esc(map[name]));
    });
    return s.replace(/\n/g, "<br>");
  }

  function raw(key, map) {
    let s = t(key);
    Object.keys(map || {}).forEach((name) => {
      s = s.split("{" + name + "}").join(String(map[name] ?? ""));
    });
    return s;
  }

  function safeHex(hex) {
    return /^#[0-9a-fA-F]{3,8}$/.test(hex || "") ? hex : "#8d8d86";
  }

  function fullHex(hex) {
    const raw = safeHex(hex).replace("#", "");
    return raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw.slice(0, 6);
  }

  function shadeHex(hex, k) {
    const n = parseInt(fullHex(hex), 16);
    const ch = (shift) => {
      const v = (n >> shift) & 255;
      return Math.max(0, Math.min(255, Math.round(v * k)))
        .toString(16)
        .padStart(2, "0");
    };
    return "#" + ch(16) + ch(8) + ch(0);
  }

  function colorNeedsWash(hex) {
    const n = parseInt(fullHex(hex), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return Math.max(r, g, b) - Math.min(r, g, b) >= 24;
  }

  function formatMoney(n) {
    const rounded = Math.round(Number(n) * 10) / 10;
    const hasFrac = Math.abs(rounded - Math.round(rounded)) > 0.001;
    return (
      new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: hasFrac ? 1 : 0,
        maximumFractionDigits: 1,
      }).format(rounded) + " ₽"
    );
  }

  function formatQty(n) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n);
  }

  function roundQty(n) {
    return Math.round(n * 10) / 10;
  }

  function plural(n, one, few, many) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  function catTitle(id) {
    return {
      tile: t("product.crumbTile"),
      block: t("product.crumbBlock"),
      border: t("product.crumbBorder"),
      bulk: t("product.crumbBulk"),
    }[id] || "";
  }

  function canEmail() {
    return Boolean(SITE.email) && !String(SITE.email).endsWith(".local");
  }

  function validPhone(v) {
    return String(v).replace(/\D/g, "").length >= 10;
  }

  function validMail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
  }

  function parseRoute() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const path = raw.split("?")[0];
    const parts = path.split("/").filter(Boolean);
    const query = new URLSearchParams(raw.split("?")[1] || "");
    return { parts, query };
  }

  function loadList(key, storage, normalize) {
    try {
      const raw = JSON.parse(storage.getItem(key) || "[]");
      return Array.isArray(raw) ? raw.map(normalize).filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }
  function saveList(key, storage, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function loadCart() {
    return loadList("kd-cart-v1", localStorage, (i) =>
      productById(i.id) && Number(i.qty) > 0 ? { id: i.id, colorId: i.colorId, qty: Number(i.qty) } : null
    );
  }
  function saveCart() { saveList("kd-cart-v1", localStorage, cart); }
  function loadFavs() {
    return loadList("kd-fav-v1", localStorage, (i) => (productById(i.id) ? { id: i.id, colorId: i.colorId } : null));
  }
  function saveFavs() { saveList("kd-fav-v1", localStorage, favs); }
  function loadCompare() {
    return loadList("kd-compare-v1", sessionStorage, (id) => (productById(id) ? id : null)).slice(0, 3);
  }
  function saveCompare() { saveList("kd-compare-v1", sessionStorage, compare); }
  function findFav(id, colorId) {
    return favs.find((i) => i.id === id && i.colorId === colorId);
  }
  function loadOrders() {
    try {
      const all = JSON.parse(localStorage.getItem("kd-leads-v1") || "[]");
      return Array.isArray(all) ? all.filter((item) => item && (item.kind === "order" || item.summary)).slice().reverse() : [];
    } catch (e) {
      return [];
    }
  }

  function formatWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function cartTotal() {
    return cart.reduce((sum, line) => {
      const p = productById(line.id);
      return sum + (p ? Math.round(p.price * line.qty) : 0);
    }, 0);
  }

  function storeLeadLocal(lead) {
    try {
      const all = JSON.parse(localStorage.getItem("kd-leads-v1") || "[]");
      if (!Array.isArray(all)) {
        localStorage.setItem("kd-leads-v1", JSON.stringify([lead]));
        return;
      }
      let found = false;
      const next = all.map((row) => {
        if (row && row.n === lead.n) {
          found = true;
          return lead;
        }
        return row;
      });
      if (!found) next.push(lead);
      localStorage.setItem("kd-leads-v1", JSON.stringify(next));
    } catch (e) {
      /* хранилище может быть закрыто */
    }
  }

  function rememberLead(lead) {
    storeLeadLocal(lead);
    return fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("lead");
        if (res.status === 204) return lead;
        return res.json();
      })
      .then(function (saved) {
        if (saved && saved.n) {
          storeLeadLocal(saved);
          return saved;
        }
        return lead;
      })
      .catch(function () {
        return lead;
      });
  }

  function orderMailOk(lead, status) {
    const log = lead && Array.isArray(lead.mailLog) ? lead.mailLog : [];
    return log.some((row) => row && row.status === status && row.ok);
  }

  function orderStagesHtml(current) {
    const steps = [
      { id: "Принят", label: t("orders.stageAccepted") },
      { id: "Собран", label: t("orders.stageBuilt") },
      { id: "Отгружен", label: t("orders.stageShipped") },
    ];
    const now = current || "Принят";
    const index = steps.findIndex((step) => step.id === now);
    if (index < 0) return "";
    return (
      '<ol class="order-stages">' +
      steps
        .map((step, i) => {
          const state = i < index ? " is-done" : i === index ? " is-now" : "";
          return "<li class=\"order-stage" + state + '">' + esc(step.label) + "</li>";
        })
        .join("") +
      "</ol>"
    );
  }

  function openMail(subject, body) {
    if (!canEmail()) return false;
    window.location.href =
      "mailto:" + SITE.email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    return true;
  }

  function toast(text) {
    const el = document.getElementById("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function fillSite() {
    document.querySelectorAll("[data-fill]").forEach((el) => {
      const key = el.dataset.fill;
      if (SITE[key] != null) el.textContent = SITE[key];
    });
    document.querySelectorAll("[data-fill-href]").forEach((el) => {
      const key = el.dataset.fillHref;
      if (SITE[key]) el.setAttribute("href", SITE[key]);
    });
    document.querySelectorAll("[data-t]").forEach((el) => {
      el.textContent = t(el.dataset.t);
    });
    document.querySelectorAll("[data-t-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.tAria));
    });
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", t("chrome.description"));
  }

  function svgWrap(inner, vb) {
    return (
      '<svg class="viz" viewBox="' +
      (vb || "0 0 240 168") +
      '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      inner +
      "</svg>"
    );
  }

  function paint(fills, i) {
    return fills[i % fills.length];
  }

  const shapes = {
    brick(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      const bw = 56;
      const bh = 26;
      let i = 0;
      for (let row = 0; row < 6; row++) {
        const off = row % 2 ? -30 : 0;
        for (let col = -1; col < 5; col++) {
          s +=
            '<rect x="' +
            (6 + col * 60 + off) +
            '" y="' +
            (4 + row * 28) +
            '" width="' +
            bw +
            '" height="' +
            bh +
            '" fill="' +
            paint(fills, i++) +
            '"/>';
        }
      }
      return svgWrap(s);
    },
    old(fills) {
      const cells = [
        [4, 4, 78, 36],
        [86, 4, 48, 36],
        [138, 4, 56, 36],
        [198, 4, 38, 36],
        [4, 44, 48, 34],
        [56, 44, 86, 34],
        [146, 44, 48, 34],
        [198, 44, 38, 34],
        [4, 82, 92, 36],
        [100, 82, 48, 36],
        [152, 82, 84, 36],
        [4, 122, 48, 42],
        [56, 122, 70, 42],
        [130, 122, 48, 42],
        [182, 122, 54, 42],
      ];
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      cells.forEach((c, i) => {
        s +=
          '<rect x="' +
          c[0] +
          '" y="' +
          c[1] +
          '" width="' +
          c[2] +
          '" height="' +
          c[3] +
          '" fill="' +
          paint(fills, i) +
          '"/>';
      });
      return svgWrap(s);
    },
    wave(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      let i = 0;
      for (let row = 0; row < 4; row++) {
        for (let col = -1; col < 3; col++) {
          const x = col * 92 + (row % 2 ? 40 : 8);
          const y = row * 42 + 6;
          s +=
            '<path fill="' +
            paint(fills, i++) +
            '" d="M' +
            x +
            " " +
            (y + 10) +
            " C " +
            (x + 16) +
            " " +
            y +
            ", " +
            (x + 22) +
            " " +
            y +
            ", " +
            (x + 36) +
            " " +
            (y + 10) +
            " L " +
            (x + 70) +
            " " +
            (y + 10) +
            " C " +
            (x + 84) +
            " " +
            y +
            ", " +
            (x + 90) +
            " " +
            y +
            ", " +
            (x + 78) +
            " " +
            (y + 22) +
            " L " +
            (x + 78) +
            " " +
            (y + 28) +
            " C " +
            (x + 90) +
            " " +
            (y + 40) +
            ", " +
            (x + 70) +
            " " +
            (y + 34) +
            ", " +
            (x + 52) +
            " " +
            (y + 28) +
            " L " +
            (x + 16) +
            " " +
            (y + 28) +
            " C " +
            (x + 2) +
            " " +
            (y + 34) +
            ", " +
            (x - 8) +
            " " +
            (y + 22) +
            ", " +
            x +
            " " +
            (y + 18) +
            " Z\"/>";
        }
      }
      return svgWrap(s);
    },
    clover(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      let i = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const x = 10 + col * 58;
          const y = 12 + row * 54;
          const f = paint(fills, i++);
          s +=
            '<rect x="' +
            (x + 10) +
            '" y="' +
            (y + 10) +
            '" width="28" height="28" fill="' +
            f +
            '"/>' +
            '<circle cx="' +
            (x + 14) +
            '" cy="' +
            (y + 14) +
            '" r="12" fill="' +
            f +
            '"/>' +
            '<circle cx="' +
            (x + 34) +
            '" cy="' +
            (y + 14) +
            '" r="12" fill="' +
            f +
            '"/>' +
            '<circle cx="' +
            (x + 14) +
            '" cy="' +
            (y + 34) +
            '" r="12" fill="' +
            f +
            '"/>' +
            '<circle cx="' +
            (x + 34) +
            '" cy="' +
            (y + 34) +
            '" r="12" fill="' +
            f +
            '"/>';
        }
      }
      return svgWrap(s);
    },
    coil(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      let i = 0;
      for (let row = 0; row < 4; row++) {
        const shift = row % 2 ? 36 : 0;
        for (let col = -1; col < 4; col++) {
          const x = 8 + col * 72 + shift;
          const y = 10 + row * 40;
          const f = paint(fills, i++);
          s +=
            '<rect x="' +
            (x + 14) +
            '" y="' +
            (y + 6) +
            '" width="34" height="22" fill="' +
            f +
            '"/>' +
            '<circle cx="' +
            (x + 16) +
            '" cy="' +
            (y + 17) +
            '" r="13" fill="' +
            f +
            '"/>' +
            '<circle cx="' +
            (x + 46) +
            '" cy="' +
            (y + 17) +
            '" r="13" fill="' +
            f +
            '"/>';
        }
      }
      return svgWrap(s);
    },
    square(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      let i = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          s +=
            '<rect x="' +
            (8 + col * 58) +
            '" y="' +
            (8 + row * 54) +
            '" width="52" height="48" fill="' +
            paint(fills, i++) +
            '"/>';
        }
      }
      return svgWrap(s);
    },
    plate(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      const cells = [
        [8, 8],
        [124, 8],
        [8, 88],
        [124, 88],
      ];
      cells.forEach((c, i) => {
        s += '<rect x="' + c[0] + '" y="' + c[1] + '" width="108" height="72" fill="' + paint(fills, i) + '"/>';
      });
      return svgWrap(s);
    },
    eco(fills) {
      const f = fills[0];
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      [[8, 10], [124, 10], [8, 90], [124, 90]].forEach((c) => {
        s += '<rect x="' + c[0] + '" y="' + c[1] + '" width="108" height="68" fill="' + f + '"/>';
        s += '<circle cx="' + (c[0] + 32) + '" cy="' + (c[1] + 34) + '" r="12" fill="#2f4a3c"/>';
        s += '<circle cx="' + (c[0] + 76) + '" cy="' + (c[1] + 34) + '" r="12" fill="#2f4a3c"/>';
      });
      return svgWrap(s);
    },
    hollow: (fills) => blockStack(fills, true, false),
    solid: (fills) => blockStack(fills, false, false),
    split: (fills) => blockStack(fills, false, true),
    curb(fills) {
      let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
      for (let i = 0; i < 3; i++) {
        const x = 18 + i * 74;
        s +=
          '<polygon points="' +
          x +
          ",120 " +
          (x + 62) +
          ",120 " +
          (x + 52) +
          ",48 " +
          (x + 10) +
          ',48" fill="' +
          fills[0] +
          '"/>';
        s += '<rect x="' + (x + 10) + '" y="40" width="42" height="10" fill="' + fills[Math.min(1, fills.length - 1)] + '"/>';
      }
      return svgWrap(s);
    },
    sand(fills) {
      return specks(fills[0], 7);
    },
    gravel(fills) {
      return specks(fills[0], 16);
    },
  };

  function blockStack(fills, holes, split) {
    let s = '<rect width="240" height="168" fill="#d9d3c6"/>';
    for (let i = 0; i < 3; i++) {
      const y = 16 + i * 50;
      s += '<rect x="18" y="' + y + '" width="204" height="40" fill="' + fills[0] + '"/>';
      if (holes) {
        s += '<rect x="62" y="' + (y + 8) + '" width="34" height="24" fill="#d9d3c6"/>';
        s += '<rect x="144" y="' + (y + 8) + '" width="34" height="24" fill="#d9d3c6"/>';
      }
      if (split) {
        s +=
          '<polygon points="18,' +
          y +
          " 118," +
          y +
          " 86," +
          (y + 40) +
          " 18," +
          (y + 40) +
          '" fill="#fff" opacity="0.2"/>';
      }
    }
    return svgWrap(s);
  }

  function specks(hex, r) {
    let s = '<rect width="240" height="168" fill="' + GROUT + '"/>';
    for (let i = 0; i < 28; i++) {
      const x = (i * 53) % 220 + 10;
      const y = (i * 37) % 140 + 12;
      s += '<circle cx="' + x + '" cy="' + y + '" r="' + (r - (i % 3)) + '" fill="' + hex + '"/>';
    }
    return svgWrap(s);
  }

  function viz(product, colorId, yaw) {
    const color = colorObj(product, colorId || product.colors[0].id);
    return productModelSvg(product, color, yaw);
  }

  function sizeMm(product) {
    const m = String(product.size).match(/(\d+)\s*×\s*(\d+)\s*×\s*(\d+)/);
    if (!m) return null;
    return { l: Number(m[1]), w: Number(m[2]), h: Number(m[3]) };
  }

  function productModelSvg(product, color, yaw) {
    const mm = sizeMm(product);
    const hex = safeHex(color.hex);
    const shade = (h, k) => {
      const n = parseInt(h.slice(1), 16);
      const ch = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k)));
      return "#" + [ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("");
    };
    const turn = yaw == null ? Math.PI / 4 : yaw;
    const yawC = Math.cos(turn);
    const yawS = Math.sin(turn);
    const project = (x, y, z) => {
      const x1 = x * yawC - y * yawS;
      const y1 = x * yawS + y * yawC;
      return [160 + x1 * 1.15, 108 + y1 * 0.66 - z];
    };
    const boxes = [];
    const prisms = [];
    const holes = [];
    let dims = null;
    let pourSvg = "";

    function waveOutline(L, W) {
      const n = 10;
      const amp = W * 0.12;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([-L / 2 + L * t, W / 2 - amp + Math.sin(t * Math.PI * 2) * amp]);
      }
      for (let i = n; i >= 0; i--) {
        const t = i / n;
        pts.push([-L / 2 + L * t, -W / 2 + amp + Math.sin(t * Math.PI * 2) * amp]);
      }
      return pts;
    }

    function cloverOutline(L, W) {
      const pts = [];
      const n = 40;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const r = 0.38 + 0.62 * Math.abs(Math.cos(2 * t));
        pts.push([(L / 2) * r * Math.cos(t), (W / 2) * r * Math.sin(t)]);
      }
      return pts;
    }

    function coilOutline(L, W) {
      const neck = W * 0.26;
      const head = L * 0.32;
      return [
        [-L / 2, -W / 2],
        [-L / 2 + head, -W / 2],
        [-L / 2 + head, -neck / 2],
        [L / 2 - head, -neck / 2],
        [L / 2 - head, -W / 2],
        [L / 2, -W / 2],
        [L / 2, W / 2],
        [L / 2 - head, W / 2],
        [L / 2 - head, neck / 2],
        [-L / 2 + head, neck / 2],
        [-L / 2 + head, W / 2],
        [-L / 2, W / 2],
      ];
    }

    if (product.shape === "old") {
      const t = 14;
      const gap = 3;
      const largeL = 118;
      const row = 40;
      const squareL = 77;
      const smallL = largeL - squareL - gap;
      const x0 = -largeL / 2;
      const y0 = -(row * 2 + gap) / 2;
      const mix = color.id === "mix";
      boxes.push(
        { x: x0, y: y0, z: 0, l: largeL, w: row, h: t, color: mix ? "#8d8d86" : hex },
        { x: x0, y: y0 + row + gap, z: 0, l: squareL, w: row, h: t, color: mix ? "#6d4b34" : shade(hex, 0.88) },
        { x: x0 + squareL + gap, y: y0 + row + gap, z: 0, l: smallL, w: row, h: t, color: mix ? "#a89880" : shade(hex, 1.08) }
      );
      dims = { l: "", w: "", h: "60 мм", box: boxes[0] };
    } else if (!mm) {
      const pile = color.id === "sand" || product.shape === "sand" ? "#c6a15b" : "#7a7772";
      const sand = product.shape === "sand";
      for (let i = 0; i < 14; i++) {
        const a = ((i * 47) % 50) - 25;
        const b = ((i * 29) % 36) - 18;
        boxes.push({ x: a, y: b, z: (i % 4) * 3, l: 14 + (i % 3) * 4, w: 11, h: 8 + (i % 3) * 3, color: shade(pile, 0.85 + (i % 4) * 0.06) });
      }
      const bits = [];
      const count = sand ? 12 : 8;
      for (let i = 0; i < count; i++) {
        const land = project(((i * 19) % 30) - 15, ((i * 13) % 20) - 8, 24 + (i % 3) * 5);
        const delay = ((i * 0.17) % 1.6).toFixed(2);
        const dur = (sand ? 1.25 : 1.55) + (i % 3) * 0.12;
        const drift = ((i % 5) - 2) * 5;
        const fill = shade(pile, sand ? 0.78 + (i % 4) * 0.08 : 0.62 + (i % 4) * 0.1);
        const style = 'style="animation-delay:' + delay + 's;animation-duration:' + dur.toFixed(2) + 's;--dx:' + drift + 'px"';
        if (sand) {
          const r = 2.4 + (i % 3) * 0.7;
          bits.push(
            '<ellipse class="pour-bit" cx="' +
              land[0].toFixed(1) +
              '" cy="' +
              land[1].toFixed(1) +
              '" rx="' +
              r.toFixed(1) +
              '" ry="' +
              (r * 0.72).toFixed(1) +
              '" fill="' +
              fill +
              '" ' +
              style +
              "/>"
          );
        } else {
          const s = 4.2 + (i % 3) * 1.3;
          const chip = [
            [land[0], land[1] - s],
            [land[0] + s * 1.15, land[1] - s * 0.15],
            [land[0] + s * 0.35, land[1] + s * 0.7],
            [land[0] - s * 0.9, land[1] + s * 0.15],
          ]
            .map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1))
            .join(" ");
          bits.push('<polygon class="pour-bit" points="' + chip + '" fill="' + fill + '" ' + style + "/>");
        }
      }
      pourSvg = '<g class="pour">' + bits.join("") + "</g>";
    } else {
      const span = Math.max(mm.l, mm.w);
      const u = 132 / span;
      const L = mm.l * u;
      const W = mm.w * u;
      const H = Math.max(10, mm.h * u);
      const base = { x: -L / 2, y: -W / 2, z: 0, l: L, w: W, h: H, color: hex };
      {
        const outline =
          product.shape === "wave"
            ? waveOutline(L, W)
            : product.shape === "clover"
              ? cloverOutline(L, W)
              : null;
        if (product.shape === "coil") {
          const sl = L * 0.7;
          const sw = W * 0.36;
          const sh = 14;
          const gap = 10;
          const spool = coilOutline(sl, sw);
          const shiftX = sl * 0.5;
          const shiftY = sw + gap;
          const mx = shiftX / 2;
          const my = shiftY / 2;
          const move = (pts, dx, dy) => pts.map((p) => [p[0] + dx, p[1] + dy]);
          prisms.push({ outline: move(spool, -mx, -my), z: 0, h: sh, color: hex });
          prisms.push({ outline: move(spool, shiftX - mx, shiftY - my), z: 0, h: sh, color: shade(hex, 0.84) });
          dims = { l: "", w: "", h: mm.h + " мм", box: { x: -mx - 6, y: -my + sw * 0.15, z: 0, l: 12, w: 10, h: sh } };
        } else if (outline) {
          const sh = product.shape === "clover" ? Math.min(H, 18) : H;
          prisms.push({ outline: outline, z: 0, h: sh, color: hex });
          dims =
            product.shape === "clover"
              ? { l: "", w: "", h: mm.h + " мм", box: { x: -8, y: W * 0.12, z: 0, l: 16, w: 12, h: sh } }
              : { l: mm.l + " мм", w: mm.w + " мм", h: mm.h + " мм", box: base };
        } else boxes.push(base);
        if (!outline && product.shape !== "coil") dims = { l: mm.l + " мм", w: mm.w + " мм", h: mm.h + " мм", box: base };
        if (product.shape === "hollow" || product.shape === "eco") {
          const gapX = L * 0.12;
          const gapY = W * 0.22;
          const holeW = product.shape === "eco" ? L * 0.16 : L * 0.28;
          const holeD = product.shape === "eco" ? W * 0.22 : W * 0.56;
          if (product.shape === "eco") {
            for (let ix = 0; ix < 3; ix++) {
              for (let iy = 0; iy < 2; iy++) {
                holes.push({
                  x: base.x + gapX + ix * (holeW + gapX),
                  y: base.y + gapY * 0.45 + iy * (holeD + gapY * 0.35),
                  l: holeW,
                  w: holeD,
                });
              }
            }
          } else {
            holes.push(
              { x: base.x + gapX, y: base.y + gapY, l: holeW, w: holeD },
              { x: base.x + gapX * 2 + holeW, y: base.y + gapY, l: holeW, w: holeD }
            );
          }
        }
      }
    }

    const polys = [];
    function addFace(pts, fill, bias) {
      let depth = 0;
      const flat = pts.map((p) => {
        const q = project(p[0], p[1], p[2]);
        depth += q[1];
        return q;
      });
      polys.push({ pts: flat, fill: fill, depth: depth / pts.length + (bias || 0) });
    }
    boxes.forEach((box) => {
      const x = box.x;
      const y = box.y;
      const z = box.z;
      const l = box.l;
      const w = box.w;
      const h = box.h;
      const sides = [
        { n: [1, 0], pts: [[x + l, y, z + h], [x + l, y + w, z + h], [x + l, y + w, z], [x + l, y, z]] },
        { n: [-1, 0], pts: [[x, y + w, z + h], [x, y, z + h], [x, y, z], [x, y + w, z]] },
        { n: [0, 1], pts: [[x, y + w, z + h], [x + l, y + w, z + h], [x + l, y + w, z], [x, y + w, z]] },
        { n: [0, -1], pts: [[x + l, y, z + h], [x, y, z + h], [x, y, z], [x + l, y, z]] },
      ];
      sides.forEach((side) => {
        const n1y = side.n[0] * yawS + side.n[1] * yawC;
        if (n1y > 0.02) addFace(side.pts, shade(box.color, 0.48 + 0.42 * Math.min(1, n1y)), 0);
      });
      addFace(
        [[x, y, z + h], [x + l, y, z + h], [x + l, y + w, z + h], [x, y + w, z + h]],
        box.color,
        0.2
      );
    });
    prisms.forEach((prism) => {
      const outline = prism.outline;
      let cx = 0;
      let cy = 0;
      outline.forEach((p) => {
        cx += p[0];
        cy += p[1];
      });
      cx /= outline.length;
      cy /= outline.length;
      addFace(
        outline.map((p) => [p[0], p[1], prism.z + prism.h]),
        prism.color,
        0.2
      );
      outline.forEach((a, i) => {
        const b = outline[(i + 1) % outline.length];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        let nx = b[1] - a[1];
        let ny = a[0] - b[0];
        if (nx * (mx - cx) + ny * (my - cy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        const n1y = nx * yawS + ny * yawC;
        if (n1y > 0.02) {
          addFace(
            [
              [b[0], b[1], prism.z + prism.h],
              [a[0], a[1], prism.z + prism.h],
              [a[0], a[1], prism.z],
              [b[0], b[1], prism.z],
            ],
            shade(prism.color, 0.5 + 0.28 * n1y),
            0
          );
        }
      });
    });
    holes.forEach((hole) => {
      const z = (boxes[0] ? boxes[0].z + boxes[0].h : 20) - 0.6;
      addFace(
        [
          [hole.x, hole.y, z],
          [hole.x + hole.l, hole.y, z],
          [hole.x + hole.l, hole.y + hole.w, z],
          [hole.x, hole.y + hole.w, z],
        ],
        "#2a2826",
        40
      );
    });
    polys.sort((a, b) => a.depth - b.depth);
    const body = polys
      .map((poly) => {
        const points = poly.pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
        return '<polygon points="' + points + '" fill="' + poly.fill + '"/>';
      })
      .join("");

    function edgeMidY(pair) {
      return (pair[0][1] + pair[1][1]) / 2;
    }
    function nearer(a, b) {
      return edgeMidY(a) >= edgeMidY(b) ? a : b;
    }
    function pushOut(a, b) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      let ex = b[0] - a[0];
      let ey = b[1] - a[1];
      const el = Math.hypot(ex, ey) || 1;
      let px = -ey / el;
      let py = ex / el;
      if (px * (mx - 160) + py * (my - 112) < 0) {
        px = -px;
        py = -py;
      }
      return [px * 16, py * 16];
    }
    function placeDim(a, b, label) {
      if (!label) return "";
      const off = pushOut(a, b);
      return dimEdge(a, b, label, off[0], off[1], off[0] * 0.6, off[1] * 0.6, "middle");
    }

    let dimSvg = "";
    if (dims) {
      const box = dims.box;
      const xEdge = nearer(
        [project(box.x, box.y, box.z), project(box.x + box.l, box.y, box.z)],
        [project(box.x, box.y + box.w, box.z), project(box.x + box.l, box.y + box.w, box.z)]
      );
      const yEdge = nearer(
        [project(box.x, box.y, box.z), project(box.x, box.y + box.w, box.z)],
        [project(box.x + box.l, box.y, box.z), project(box.x + box.l, box.y + box.w, box.z)]
      );
      const feet = [
        [box.x, box.y],
        [box.x + box.l, box.y],
        [box.x, box.y + box.w],
        [box.x + box.l, box.y + box.w],
      ];
      let foot = feet[0];
      let footY = -Infinity;
      feet.forEach((c) => {
        const p = project(c[0], c[1], box.z);
        if (p[1] > footY) {
          footY = p[1];
          foot = c;
        }
      });
      dimSvg =
        placeDim(xEdge[0], xEdge[1], dims.l) +
        placeDim(yEdge[0], yEdge[1], dims.w) +
        placeDim(project(foot[0], foot[1], box.z), project(foot[0], foot[1], box.z + box.h), dims.h);
    } else if (!mm) {
      dimSvg = '<text x="160" y="214" text-anchor="middle" class="dim-t">м³</text>';
    }

    const front = boxes.reduce(
      (acc, box) => Math.max(acc, project(box.x + box.l / 2, box.y + box.w, box.z)[1]),
      150
    );
    return (
      '<svg class="viz model" data-model="' +
      esc(product.id) +
      '" data-color="' +
      esc(color.id) +
      '" viewBox="0 0 320 240" role="img" aria-label="' +
      esc(product.name + ", " + product.size) +
      '">' +
      '<g class="model-zoom">' +
      '<ellipse cx="160" cy="' +
      Math.min(210, front + 10).toFixed(1) +
      '" rx="78" ry="16" fill="#1b1916" opacity="0.08"/>' +
      body +
      pourSvg +
      '<g class="dims">' +
      dimSvg +
      "</g></g></svg>"
    );
  }

  function dimEdge(a, b, label, ox, oy, tx, ty, anchor, at) {
    const a2 = [a[0] + ox, a[1] + oy];
    const b2 = [b[0] + ox, b[1] + oy];
    const end = at === "top" ? (a2[1] < b2[1] ? a2 : b2) : null;
    const along = at === "start" ? 0.28 : 0.5;
    const mx = Math.max(36, Math.min(284, (end ? end[0] : a2[0] + (b2[0] - a2[0]) * along) + (tx || 0)));
    const my = Math.max(16, Math.min(224, (end ? end[1] : a2[1] + (b2[1] - a2[1]) * along) + (ty || 0)));
    const n = (v) => v.toFixed(1);
    return (
      '<line class="dim" x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(a2[0]) + '" y2="' + n(a2[1]) + '"/>' +
      '<line class="dim" x1="' + n(b[0]) + '" y1="' + n(b[1]) + '" x2="' + n(b2[0]) + '" y2="' + n(b2[1]) + '"/>' +
      '<line class="dim" x1="' + n(a2[0]) + '" y1="' + n(a2[1]) + '" x2="' + n(b2[0]) + '" y2="' + n(b2[1]) + '"/>' +
      '<text class="dim-t" x="' + n(mx) + '" y="' + n(my) + '" text-anchor="' + (anchor || "middle") + '">' +
      esc(label) +
      "</text>"
    );
  }

  function bindModelSpin(host) {
    if (!host || host._spinBound) return;
    if (!host.classList.contains("card-media") && !host.classList.contains("product-media")) return;
    host._spinBound = true;
    host.setAttribute("draggable", "false");
    host.addEventListener("dragstart", (e) => e.preventDefault());
    if (host._modelYaw == null) host._modelYaw = Math.PI / 4;
    let drag = null;
    let redrawFrame = 0;

    function redrawNow() {
      const svg = host.querySelector(".model");
      if (!svg) return;
      const product = productById(svg.getAttribute("data-model"));
      if (!product) return;
      const holder = document.createElement("div");
      holder.innerHTML = viz(product, svg.getAttribute("data-color"), host._modelYaw);
      if (holder.firstChild) svg.replaceWith(holder.firstChild);
    }

    function redraw() {
      if (redrawFrame) return;
      redrawFrame = requestAnimationFrame(() => {
        redrawFrame = 0;
        redrawNow();
      });
    }

    host._turnModel = function (delta) {
      if (host.dataset.view === "photo") return;
      host._modelYaw += delta;
      host.classList.add("is-turning");
      redraw();
      clearTimeout(host._turnTimer);
      host._turnTimer = setTimeout(() => host.classList.remove("is-turning"), 420);
    };

    host.addEventListener("pointerdown", (e) => {
      if (host.dataset.view === "photo") return;
      if (e.button != null && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, yaw: host._modelYaw, mode: "" };
    });
    host.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.mode) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        drag.mode = Math.abs(dx) > Math.abs(dy) ? "spin" : "scroll";
        if (drag.mode !== "spin") return;
        host._spun = true;
        host.classList.add("is-turning");
        if (host.setPointerCapture) host.setPointerCapture(e.pointerId);
      }
      if (drag.mode !== "spin") return;
      host._modelYaw = drag.yaw + dx * 0.012;
      redraw();
    });
    function stop(e) {
      if (!drag) return;
      drag = null;
      host.classList.remove("is-turning");
      if (e && host.hasPointerCapture && host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
      if (host._spun) setTimeout(() => { host._spun = false; }, 0);
    }
    host.addEventListener("pointerup", stop);
    host.addEventListener("pointercancel", stop);
    host.addEventListener("click", (e) => {
      if (!host._spun) return;
      e.preventDefault();
      host._spun = false;
    });
  }

  function spinButtons() {
    return (
      '<button type="button" class="spin-btn" data-spin="-1" aria-label="' + esc(t("product.spinLeft")) + '">‹</button>' +
      '<button type="button" class="spin-btn" data-spin="1" aria-label="' + esc(t("product.spinRight")) + '">›</button>'
    );
  }

  function viewSwitch(photoFirst) {
    if (photoFirst) {
      return (
        '<div class="view-switch" role="group" aria-label="' + esc(t("product.view")) + '">' +
        '<button type="button" class="view-btn is-on" data-action="set-view" data-view="photo" aria-pressed="true">' + esc(t("product.photo")) + "</button>" +
        '<button type="button" class="view-btn" data-action="set-view" data-view="model" aria-pressed="false">' + esc(t("product.model")) + "</button>" +
        "</div>"
      );
    }
    return (
      '<div class="view-switch" role="group" aria-label="' + esc(t("product.view")) + '">' +
      '<button type="button" class="view-btn is-on" data-action="set-view" data-view="model" aria-pressed="true">' + esc(t("product.model")) + "</button>" +
      '<button type="button" class="view-btn" data-action="set-view" data-view="photo" aria-pressed="false">' + esc(t("product.photo")) + "</button>" +
      "</div>"
    );
  }

  function photoHtml(product, colorId) {
    const color = colorObj(product, colorId || product.colors[0].id);
    const wash = colorNeedsWash(color.hex)
      ? '<span class="photo-wash" style="background:' + safeHex(color.hex) + '"></span>'
      : "";
    return (
      '<span class="photo-stack"><img class="photo" draggable="false" width="1152" height="864" loading="lazy" decoding="async" alt="' +
      esc(product.name) +
      '" src="' +
      esc(window.KDAdmin && KDAdmin.photoSrc ? KDAdmin.photoSrc(product.id) : "img/" + product.id + ".jpg") +
      '">' +
      wash +
      "</span>"
    );
  }

  function showMedia(media, product, colorId) {
    if (!media || !product) return;
    if (colorId) media.dataset.color = colorId;
    const color = media.dataset.color || product.colors[0].id;
    const badge = media.querySelector(".badge");
    if (media.dataset.view === "photo") {
      media.innerHTML = photoHtml(product, color);
    } else {
      media.innerHTML = viz(product, color, media._modelYaw);
    }
    if (badge) media.appendChild(badge);
    const frame = media.parentElement;
    if (frame && frame.classList.contains("media-frame")) frame.classList.toggle("is-photo", media.dataset.view === "photo");
  }

  function bindModelSpins(root) {
    if (!root) return;
    root.querySelectorAll(".card-media, .product-media").forEach(bindModelSpin);
    root.querySelectorAll("[data-spin]").forEach((btn) => {
      if (btn._spinBound) return;
      btn._spinBound = true;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const frame = btn.closest(".media-frame");
        const host = frame && frame.querySelector("[data-media]");
        if (host && host._turnModel) host._turnModel(Number(btn.dataset.spin) * (Math.PI / 6));
      });
    });
  }

  function yardModel() {
    const cell = 1.48;
    const gap = 0.2;
    const pitch = cell + gap;
    const cols = 6;
    const rows = 6;
    const fieldW = cols * pitch - gap;
    const fieldD = rows * pitch - gap;
    const bed = 0.12;
    const paverH = 0.16;
    const grays = ["#8d8a84", "#9a968f", "#7a766f", "#a39e96"];
    const browns = ["#8d7564", "#7a6858"];
    const boxes = [];
    const tops = [];

    tops.push({ x: 0.35, y: 0.5, z: 0.02, l: fieldW + 0.55, w: fieldD + 0.7, color: "#1b1916", opacity: 0.14 });
    boxes.push({ x: -0.55, y: -0.42, z: 0, l: fieldW + 1.45, w: fieldD + 1.35, h: bed, color: "#f3e6c4", bias: -30 });

    function stone(col, row, cw, ch) {
      return {
        x: col * pitch,
        y: row * pitch,
        l: cw * cell + (cw - 1) * gap,
        w: ch * cell + (ch - 1) * gap,
      };
    }

    const tiles = [
      stone(0, 0, 2, 2),
      stone(2, 0, 2, 1),
      stone(4, 0, 1, 1),
      stone(5, 0, 1, 1),
      stone(2, 1, 2, 1),
      stone(4, 1, 1, 1),
      stone(5, 1, 1, 1),
      stone(0, 2, 2, 1),
      stone(2, 2, 1, 1),
      stone(3, 2, 2, 2),
      stone(5, 2, 1, 1),
      stone(0, 3, 1, 1),
      stone(1, 3, 2, 1),
      stone(5, 3, 1, 1),
      stone(0, 4, 2, 2),
      stone(2, 4, 2, 1),
      stone(4, 4, 1, 1),
      stone(5, 4, 1, 1),
      stone(2, 5, 1, 1),
      stone(3, 5, 2, 1),
      stone(5, 5, 1, 1),
    ];

    const pavers = tiles.map((t, i) => ({
      x: t.x,
      y: t.y,
      z: bed,
      l: t.l,
      w: t.w,
      h: paverH,
      color: i % 5 === 0 ? browns[((i / 5) | 0) % browns.length] : grays[i % grays.length],
    }));
    pavers.sort((a, b) => a.y - b.y || a.x - b.x);

    const curbH = 0.48;
    const curbT = 0.52;
    const curbTop = "#6d6a64";
    let cy = -0.12;
    while (cy < fieldD - 0.15) {
      const len = Math.min(2.05, fieldD - cy);
      boxes.push({ x: fieldW + 0.2, y: cy, z: 0, l: curbT, w: len, h: curbH, color: curbTop });
      cy += len + 0.1;
    }
    let cx = -0.28;
    const curbEnd = fieldW + 0.2 + curbT;
    while (cx < curbEnd - 0.08) {
      const len = Math.min(2.28, curbEnd - cx);
      boxes.push({ x: cx, y: fieldD + 0.2, z: 0, l: len, w: curbT, h: curbH, color: curbTop });
      cx += len + 0.1;
    }

    const tile = productById("stary-gorod");
    return {
      sand: boxes[0],
      shadow: tops[0],
      curbs: boxes.slice(1),
      pavers: pavers,
      bed: bed,
      originX: fieldW / 2,
      originY: fieldD / 2,
      view: { x: 300, y: 248, s: 26 },
      intro: 560,
      gapMs: 150,
      fallMs: 380,
      hover: 1.5,
      aria: t("home.yardTileAria"),
      layingHint: t("home.yardTileHint"),
      doneHint: t("home.yardDone"),
      kicker: t("home.yardTileKicker"),
      title: tile.name,
      price: formatMoney(tile.price) + "/м²",
    };
  }

  function yardHouse() {
    const L = 1.52;
    const T = 0.7;
    const H = 0.62;
    const nx = 4;
    const W = nx * L;
    const sideL = 1.35;
    const sideGap = 0.1;
    const sideN = 2;
    const padH = 0.14;
    const frontY = T + sideN * sideL + (sideN - 1) * sideGap;
    const D = frontY + T;
    const gray = ["#8a8680", "#7e7a74", "#938e86"];
    const blocks = [];

    function pushBlock(x, y, course, l, w) {
      blocks.push({
        x: x,
        y: y,
        z: padH + course * H,
        l: l,
        w: w,
        h: H,
        color: gray[blocks.length % gray.length],
      });
    }

    for (let c = 0; c < 4; c++) {
      for (let i = 0; i < nx; i++) pushBlock(i * L, 0, c, L, T);
      for (let i = 0; i < nx; i++) {
        const door = c < 3 && (i === 1 || i === 2);
        if (!door) pushBlock(i * L, frontY, c, L, T);
      }
      for (let j = 0; j < sideN; j++) {
        pushBlock(0, T + j * (sideL + sideGap), c, T, sideL);
      }
      for (let j = 0; j < sideN; j++) {
        const window = (c === 1 || c === 2) && j === 1;
        if (!window) pushBlock(W - T, T + j * (sideL + sideGap), c, T, sideL);
      }
    }
    blocks.push({
      x: -0.28,
      y: -0.22,
      z: padH + 4 * H,
      l: W + 0.56,
      w: D + 0.44,
      h: 0.16,
      color: "#5c5854",
    });
    blocks.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);

    const block = productById("block-hollow");
    return {
      sand: { x: -0.6, y: -0.5, z: 0, l: W + 1.2, w: D + 1.05, h: padH, color: "#e3d6be", bias: -30 },
      shadow: { x: 0.15, y: 0.25, z: 0.02, l: W + 0.35, w: D + 0.25, color: "#1b1916", opacity: 0.14 },
      curbs: [
        {
          x: T + 0.04,
          y: T + 0.04,
          z: padH,
          l: W - 2 * T - 0.08,
          w: frontY - T - 0.08,
          h: 0.05,
          color: "#3e3c39",
          bias: -12,
        },
      ],
      pavers: blocks,
      bed: padH,
      originX: W / 2,
      originY: D / 2,
      view: { x: 328, y: 292, s: 30 },
      intro: 420,
      gapMs: 68,
      fallMs: 250,
      hover: 1.15,
      aria: t("home.yardBlockAria"),
      layingHint: t("home.yardBlockHint"),
      doneHint: t("home.yardDone"),
      kicker: t("home.yardBlockKicker"),
      title: block.name,
      price: formatMoney(block.price) + "/шт",
    };
  }

  function yardBorder() {
    const len = 2.15;
    const gap = 0.12;
    const step = len + gap;
    const T = 0.5;
    const H = 0.82;
    const along = 3;
    const fieldW = 4 * step - gap;
    const frontY = (along - 1) * step + len;
    const stone = "#6e6e6a";
    const pieces = [];
    for (let i = 0; i < along; i++) {
      pieces.push({ x: 0, y: i * step, z: 0, l: T, w: len, h: H, color: i % 2 ? "#65625d" : stone });
      pieces.push({ x: fieldW - T, y: i * step, z: 0, l: T, w: len, h: H, color: stone });
    }
    let x = 0;
    while (x < fieldW - 0.15) {
      const wlen = Math.min(len, fieldW - x);
      pieces.push({ x: x, y: frontY, z: 0, l: wlen, w: T, h: H, color: "#62605c" });
      x += step;
    }
    const border = productById("border-road");
    return {
      sand: { x: -0.4, y: -0.35, z: 0, l: fieldW + 0.8, w: frontY + T + 0.6, h: 0.1, color: "#f3e6c4", bias: -30 },
      shadow: { x: 0.2, y: 0.35, z: 0.02, l: fieldW + 0.2, w: frontY + 0.2, color: "#1b1916", opacity: 0.12 },
      curbs: [
        {
          x: T + 0.1,
          y: 0.12,
          z: 0.1,
          l: fieldW - 2 * T - 0.2,
          w: frontY - 0.18,
          h: 0.06,
          color: "#c4bfb4",
          bias: -12,
        },
      ],
      pavers: pieces,
      bed: 0,
      originX: fieldW / 2,
      originY: (frontY + T) / 2,
      view: { x: 300, y: 252, s: 24 },
      intro: 480,
      gapMs: 130,
      fallMs: 320,
      hover: 1.25,
      aria: t("home.yardBorderAria"),
      layingHint: t("home.yardBorderHint"),
      doneHint: t("home.yardDone"),
      kicker: t("home.yardBorderKicker"),
      title: border.name,
      price: formatMoney(border.price) + "/шт",
    };
  }

  function yardScene(kind) {
    if (kind === "block") return yardHouse();
    if (kind === "border") return yardBorder();
    return yardModel();
  }

  function mountYard(host, kind) {
    if (host._yardStop) host._yardStop();
    const prev = host.querySelector(".yard-svg");
    if (prev) prev.remove();
    host.classList.remove("is-turned", "is-dragging", "is-laying");

    const model = yardScene(kind || "tile");
    const card = host.querySelector(".yard-card");
    if (card) {
      card.querySelector("span").textContent = model.kicker;
      card.querySelector("strong").textContent = model.title;
      card.querySelector("b").textContent = model.price;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "yard-svg");
    svg.setAttribute("viewBox", "0 0 560 460");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", model.aria);
    host.insertBefore(svg, host.firstChild);

    const hint = host.querySelector(".yard-hint");
    const yawEnd = Math.PI / 4;
    let yaw = yawEnd - 0.28;
    let drag = null;
    let playing = false;
    let raf = 0;
    let dragRaf = 0;
    host._yardStop = () => {
      playing = false;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(dragRaf);
    };
    const started = { t: 0 };
    const intro = model.intro;
    const gapMs = model.gapMs;
    const fallMs = model.fallMs;
    const hover = model.hover;
    const shade = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = (shift) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * k)));
      return "#" + [ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("");
    };

    function sceneBoxes(elapsed) {
      const boxes = [model.sand];
      if (elapsed >= intro * 0.45) boxes.push.apply(boxes, model.curbs);
      model.pavers.forEach((tile, i) => {
        const start = intro + i * gapMs;
        if (elapsed < start) return;
        const u = Math.min(1, (elapsed - start) / fallMs);
        const e = 1 - Math.pow(1 - u, 3);
        boxes.push({
          x: tile.x,
          y: tile.y,
          z: tile.z + (1 - e) * hover,
          l: tile.l,
          w: tile.w,
          h: tile.h,
          color: tile.color,
          bias: tile.bias,
        });
      });
      return boxes;
    }

    function laidBoxes() {
      return [model.sand].concat(model.curbs, model.pavers);
    }

    function draw(boxes) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const ox = model.originX;
      const oy = model.originY;
      const project = (px, py, pz) => {
        const x1 = (px - ox) * c - (py - oy) * s;
        const y1 = (px - ox) * s + (py - oy) * c;
        return [x1 * 1.225, y1 * 0.707 - pz, y1];
      };
      const polys = [];
      function addFace(pts, fill, opacity, bias) {
        let depth = 0;
        const flat = pts.map((p) => {
          const q = project(p[0], p[1], p[2]);
          depth += q[2];
          return q;
        });
        polys.push({ pts: flat, fill: fill, opacity: opacity, depth: depth / pts.length + (bias || 0) });
      }
      boxes.forEach((box) => {
        const x = box.x;
        const y = box.y;
        const z = box.z;
        const l = box.l;
        const w = box.w;
        const h = box.h;
        const sides = [
          { n: [1, 0], k: 0.74, pts: [[x + l, y, z + h], [x + l, y + w, z + h], [x + l, y + w, z], [x + l, y, z]] },
          { n: [-1, 0], k: 0.5, pts: [[x, y + w, z + h], [x, y, z + h], [x, y, z], [x, y + w, z]] },
          { n: [0, 1], k: 0.6, pts: [[x, y + w, z + h], [x + l, y + w, z + h], [x + l, y + w, z], [x, y + w, z]] },
          { n: [0, -1], k: 0.46, pts: [[x + l, y, z + h], [x, y, z + h], [x, y, z], [x + l, y, z]] },
        ];
        sides.forEach((side) => {
          const n1y = side.n[0] * s + side.n[1] * c;
          if (n1y > 0.02) addFace(side.pts, shade(box.color, side.k), null, box.bias);
        });
        addFace(
          [[x, y, z + h], [x + l, y, z + h], [x + l, y + w, z + h], [x, y + w, z + h]],
          box.color,
          null,
          box.bias
        );
      });
      const top = model.shadow;
      addFace(
        [[top.x, top.y, top.z], [top.x + top.l, top.y, top.z], [top.x + top.l, top.y + top.w, top.z], [top.x, top.y + top.w, top.z]],
        top.color,
        top.opacity,
        -25
      );
      polys.sort((a, b) => a.depth - b.depth);
      const body = polys
        .map((poly) => {
          const points = poly.pts.map((p) => p[0].toFixed(2) + "," + p[1].toFixed(2)).join(" ");
          return '<polygon points="' + points + '" fill="' + poly.fill + '"' + (poly.opacity != null ? ' opacity="' + poly.opacity + '"' : "") + "/>";
        })
        .join("");
      const v = model.view;
      svg.innerHTML = '<g transform="translate(' + v.x + "," + v.y + ") scale(" + v.s + ')">' + body + "</g>";
    }

    function scheduleDragDraw() {
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = 0;
        if (svg.isConnected) draw(laidBoxes());
      });
    }

    function finishLay() {
      if (!playing) return;
      playing = false;
      cancelAnimationFrame(raf);
      host.classList.remove("is-laying");
      if (hint) hint.textContent = model.doneHint;
      draw(laidBoxes());
    }

    function frame(now) {
      if (!svg.isConnected) return;
      if (!started.t) started.t = now;
      const elapsed = now - started.t;
      const total = intro + model.pavers.length * gapMs + fallMs;
      const u = Math.min(1, elapsed / total);
      yaw = yawEnd - 0.28 + 0.28 * (1 - Math.pow(1 - u, 2));
      draw(sceneBoxes(elapsed));
      if (elapsed < total) raf = requestAnimationFrame(frame);
      else finishLay();
    }

    function stopDrag(e) {
      if (!drag) return;
      drag = null;
      host.classList.remove("is-dragging");
      if (e && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    }

    svg.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, yaw: yaw, mode: "" };
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.mode) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        drag.mode = Math.abs(dx) > Math.abs(dy) ? "spin" : "scroll";
        if (drag.mode === "spin") {
          finishLay();
          drag.yaw = yaw;
          drag.x = e.clientX;
          svg.setPointerCapture(e.pointerId);
          host.classList.add("is-dragging");
          host.classList.add("is-turned");
          return;
        }
      }
      if (drag.mode !== "spin") return;
      yaw = drag.yaw + dx * 0.012;
      scheduleDragDraw();
    });
    svg.addEventListener("pointerup", stopDrag);
    svg.addEventListener("pointercancel", stopDrag);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      yaw = yawEnd;
      if (hint) hint.textContent = model.doneHint;
      draw(laidBoxes());
    } else {
      playing = true;
      host.classList.add("is-laying");
      if (hint) hint.textContent = model.layingHint;
      raf = requestAnimationFrame(frame);
    }
  }

  function secondaryPrice(p) {
    if (p.category === "tile" && p.pcsPerM2) return formatMoney(p.price / p.pcsPerM2) + t("product.perPiece");
    if (p.category === "block") return formatMoney(p.price * p.pcsPerM2) + t("product.perWall");
    if (p.category === "border") return formatMoney(p.price) + t("product.perMeter");
    return "";
  }

  function offerQty(p) {
    if (p && p.category === "block" && p.pcsPerM2) return p.pcsPerM2;
    return 1;
  }

  function offerPrice(p) {
    if (p && p.category === "block" && p.pcsPerM2) return p.price * p.pcsPerM2;
    return p ? p.price : 0;
  }

  function offerLabel(p) {
    if (!p) return "";
    if (p.unit === "м²") return "за 1 м²";
    if (p.category === "block") return "за 1 м² стены";
    if (p.unit === "м³") return "за 1 м³";
    return "за 1 шт";
  }

  // На карточке главная цена — за штуку, вторичная — за м²/м³.
  function cardPrimaryPrice(p) {
    if (p.category === "tile" && p.pcsPerM2) return formatMoney(p.price / p.pcsPerM2);
    return formatMoney(p.price);
  }

  function cardPrimaryLabel(p) {
    if (p.category === "bulk") return offerLabel(p);
    return "за 1 шт";
  }

  function cardSecondaryPrice(p) {
    if (p.category === "tile" && p.pcsPerM2) return formatMoney(p.price) + " " + "за 1 м²";
    if (p.category === "block" && p.pcsPerM2) return formatMoney(p.price * p.pcsPerM2) + " " + "за 1 м² стены";
    return secondaryPrice(p);
  }

  function cardKicker(p) {
    if (p.category === "tile") return t("product.kickerTile") + " · " + p.thickness + " мм";
    if (p.category === "block") return t("product.kickerBlock") + " · " + p.mark;
    if (p.category === "border") return t("product.kickerBorder") + " · " + p.mark;
    return t("product.kickerBulk");
  }

  function dotsHtml(p) {
    if (p.colors.length < 2) {
      const c = p.colors[0];
      return '<span class="dot is-on" style="background:' + safeHex(c.hex) + '" title="' + esc(c.name) + '"></span>';
    }
    return p.colors
      .map((c, i) => {
        return (
          '<button type="button" class="dot' +
          (i === 0 ? " is-on" : "") +
          '" style="background:' +
          safeHex(c.hex) +
          '" title="' +
          esc(c.name) +
          '" aria-label="' +
          esc(c.name) +
          '" data-action="pick-color" data-id="' +
          p.id +
          '" data-color="' +
          c.id +
          '"></button>'
        );
      })
      .join("");
  }

  function favButton(product, colorId) {
    const on = !!findFav(product.id, colorId);
    const label = on ? t("product.favOn") : t("product.fav");
    return (
      '<button type="button" class="btn btn-line paper-line card-fav' +
      (on ? " is-on" : "") +
      '" data-action="fav" data-id="' +
      product.id +
      '" data-color="' +
      colorId +
      '" aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '" aria-pressed="' +
      on +
      '"><span class="card-fav-ico" aria-hidden="true">' +
      (on ? "♥" : "♡") +
      "</span></button>"
    );
  }

  function paintFav(btn) {
    const on = !!findFav(btn.dataset.id, btn.dataset.color);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
    if (btn.classList.contains("card-fav")) {
      const label = on ? t("product.favOn") : t("product.fav");
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      const ico = btn.querySelector(".card-fav-ico");
      if (ico) ico.textContent = on ? "♥" : "♡";
    }
  }

  function compareMark(id, inCard) {
    const on = compare.indexOf(id) !== -1;
    return (
      '<button type="button" class="btn btn-line paper-line' +
      (inCard ? " card-compare" : "") +
      (on ? " is-on" : "") +
      '" data-action="compare" data-id="' +
      id +
      '" aria-pressed="' +
      on +
      '">' +
      (inCard ? "Сравнить" : on ? "В сравнении" : "Сравнить") +
      "</button>"
    );
  }

  function yardKit(product, colorId) {
    if (!product || product.category !== "tile") return null;
    const border = borderForTile(product);
    if (!border) return null;
    const est = buildEstimate({
      project: "yard",
      productId: product.id,
      colorId: colorId || product.colors[0].id,
      reserve: 5,
      borderId: border.id,
      withBase: true,
      delivery: "city",
      yardLength: 8,
      yardWidth: 5,
      pattern: "straight",
    });
    if (!est || est.empty) return null;
    return { area: 40, goods: est.goods };
  }

  function yardPriceHtml(p, colorId) {
    const kit = yardKit(p, colorId);
    if (!kit) return "";
    return (
      '<a class="yard-price" href="#/calc" data-action="open-calc" data-kit="yard" data-id="' +
      p.id +
      '" data-color="' +
      colorId +
      '" title="Плитка, бордюр, песок и щебень. Доставка отдельно.">Двор ' +
      kit.area +
      ' м² <b>' +
      formatMoney(kit.goods) +
      "</b></a>"
    );
  }

  function cardHtml(p, photoFirst) {
    const color = p.colors[0];
    const second = cardSecondaryPrice(p);
    const wait = p.stock !== "В наличии" && p.stock !== "Под заказ, 3 дня";
    const media = photoFirst ? photoHtml(p, color.id) : viz(p, color.id);
    return (
      '<article class="card" data-color-scope>' +
      '<div class="media-frame' + (photoFirst ? " is-photo" : "") + '"><a class="card-media" draggable="false" href="#/product/' +
      p.id +
      '" data-media data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '" data-view="' +
      (photoFirst ? "photo" : "model") +
      '">' +
      media +
      (wait ? '<span class="badge badge-wait">' + esc(p.stock) + "</span>" : "") +
      "</a>" +
      '<button type="button" class="btn card-quick" data-action="buy" data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '">Купить</button>' +
      spinButtons() +
      viewSwitch(photoFirst) +
      "</div>" +
      '<div class="card-body">' +
      '<p class="kicker-line">' +
      esc(cardKicker(p)) +
      "</p>" +
      "<h3><a href=\"#/product/" +
      p.id +
      '">' +
      esc(p.name) +
      "</a></h3>" +
      '<p class="meta"><span>' +
      esc(p.size) +
      " · " +
      esc(p.frost) +
      '</span><span class="dots">' +
      dotsHtml(p) +
      "</span></p>" +
      '<div class="price-row"><strong>' +
      cardPrimaryPrice(p) +
      "<small> " +
      esc(cardPrimaryLabel(p)) +
      "</small></strong><span>" +
      esc(second) +
      "</span></div>" +
      yardPriceHtml(p, color.id) +
      '<div class="card-actions">' +
      compareMark(p.id, true) +
      favButton(p, color.id) +
      '<button type="button" class="btn" data-action="add" data-id="' +
      p.id +
      '" data-qty="' +
      offerQty(p) +
      '" data-color="' +
      color.id +
      '">' + esc(t("product.cart")) + "</button></div></div></article>"
    );
  }

  function minPrice(cat) {
    const list = PRODUCTS.filter((p) => p.category === cat && !p.hidden);
    if (!list.length) return 0;
    return Math.min.apply(null, list.map((p) => p.price));
  }

  function countCat(cat) {
    return PRODUCTS.filter((p) => p.category === cat && !p.hidden).length;
  }

  function pageHead(title, lede) {
    return (
      '<header class="page-head"><h1>' +
      esc(title) +
      "</h1>" +
      (lede ? '<p class="lede">' + esc(lede).replace(/\n/g, "<br>") + "</p>" : "") +
      "</header>"
    );
  }

  function renderHome() {
    const hit = productById("stary-gorod");
    const plita = productById("plita-400");
    const hollow = productById("block-hollow");
    const solid = productById("block-solid");
    const garden = productById("border-garden");
    const road = productById("border-road");
    const sand = productById("sand");
    const cats =
      '<div class="cats">' +
      catLink("tile", "cat-tile", t("home.catTileTitle"), t("home.catTileText")) +
      catLink("block", "cat-block", t("home.catBlockTitle"), t("home.catBlockText")) +
      catLink("border", "cat-border", t("home.catBorderTitle"), t("home.catBorderText")) +
      "</div>";
    const picks = ["kirpich-60", "stary-gorod", "block-hollow", "border-road"]
      .map((id) => productById(id))
      .filter((p) => p && !p.hidden)
      .map((p) => cardHtml(p, true))
      .join("");
    const offers = [
      { product: plita, why: t("home.deal1") || ("На " + formatMoney(hit.price - plita.price) + " за м² дешевле «Старого города»") },
      { product: hollow, why: t("home.deal2") || ("На " + formatMoney(solid.price - hollow.price) + " за штуку дешевле полнотелого") },
      { product: garden, why: t("home.deal3") || ("На " + formatMoney(road.price - garden.price) + " за метр дешевле дорожного") },
      { product: sand, why: t("home.deal4") },
    ];
    function shockOffer(parts) {
      if (!plita || !hit || plita.hidden || hit.hidden) return "";
      const gap = hit.price - plita.price;
      const priceNum = formatMoney(plita.price).replace(/\s*₽$/, "");
      return (
        '<div class="promo promo-shock">' +
        '<div class="shock-copy"><p class="shock-badge">' +
        parts.badge +
        '</p><h2 class="shock-price">' +
        esc(priceNum) +
        "<small> ₽/" +
        esc(plita.unit) +
        "</small></h2><p class=\"shock-line\">" +
        parts.line +
        '</p><p class="shock-size">' +
        esc(plita.size) +
        '</p><a class="btn promo-btn" href="#/product/' +
        plita.id +
        '">' +
        parts.btn +
        "</a></div>" +
        '<div class="shock-vs"><a class="shock-card shock-old" href="#/product/' +
        hit.id +
        '">' +
        '<img width="1152" height="864" loading="eager" decoding="async" src="' +
        esc(shotSrc(hit)) +
        '" alt="">' +
        '<span class="shock-name">' +
        esc(hit.name) +
        '</span><span class="shock-old-price">' +
        esc(formatMoney(hit.price)) +
        "/" +
        esc(hit.unit) +
        '</span></a><a class="shock-card shock-now" href="#/product/' +
        plita.id +
        '">' +
        '<img width="1152" height="864" loading="eager" decoding="async" fetchpriority="high" src="' +
        esc(shotSrc(plita)) +
        '" alt="">' +
        '<span class="shock-name">' +
        esc(plita.name) +
        "</span>" +
        (gap > 0 ? '<span class="shock-save">' + parts.save + "</span>" : "") +
        '</a><p class="shock-fine">' +
        parts.fine +
        "</p></div></div>"
      );
    }
    function shotSrc(product) {
      return window.KDAdmin && KDAdmin.photoSrc ? KDAdmin.photoSrc(product.id) : "img/" + product.id + ".jpg";
    }
    function htmlText(value, map) {
      let s = esc(value || "");
      Object.keys(map || {}).forEach((name) => {
        s = s.split("{" + name + "}").join(esc(map[name] == null ? "" : map[name]));
      });
      return s.replace(/\n/g, "<br>");
    }
    function bannerImage(slide, product) {
      if (window.KDAdmin && KDAdmin.bannerSrc) return KDAdmin.bannerSrc(slide.id, product.id);
      return shotSrc(product);
    }
    function offerSlide(slide) {
      const gap = hit && plita ? hit.price - plita.price : 0;
      return shockOffer({
        badge: htmlText(slide.kicker),
        line: htmlText(slide.title),
        btn: htmlText(slide.btn),
        save: htmlText(slide.note, { gap: formatMoney(gap) }),
        fine: htmlText(slide.text),
      });
    }
    function photoSlide(slide, eager) {
      const product = productById(slide.productId);
      if (!product || product.hidden) return "";
      const tone = product.category === "block" ? " promo-shot-block" : " promo-shot-tile";
      const standardButtons = ["Открыть плиту", "Открыть блок", "Купить плитку", "Купить шлакоблок"];
      const button = standardButtons.includes(slide.btn) ? "Купить" : slide.btn || "Купить";
      return (
        '<a class="promo promo-shot' + tone + '" href="#/product/' +
        product.id +
        '"><img width="1152" height="864" loading="' +
        (eager ? "eager" : "lazy") +
        '" decoding="async"' +
        (eager ? ' fetchpriority="high"' : "") +
        ' src="' +
        esc(bannerImage(slide, product)) +
        '" alt="' +
        esc(product.name) +
        '"><div class="promo-copy"><p class="promo-kicker">' +
        htmlText(slide.kicker) +
        "</p><h2>" +
        htmlText(slide.title || product.name) +
        "</h2><p>" +
        htmlText(slide.text, { price: formatMoney(product.price), size: product.size }) +
        '</p><span class="btn promo-btn">' +
        htmlText(button) +
        "</span></div></a>"
      );
    }
    function promoShot(product, keys, eager) {
      if (!product || product.hidden) return "";
      const tone = product.category === "block" ? " promo-shot-block" : " promo-shot-tile";
      return (
        '<a class="promo promo-shot' + tone + '" href="#/product/' +
        product.id +
        '"><img width="1152" height="864" loading="' +
        (eager ? "eager" : "lazy") +
        '" decoding="async"' +
        (eager ? ' fetchpriority="high"' : "") +
        ' src="' +
        esc(shotSrc(product)) +
        '" alt="' +
        esc(product.name) +
        '"><div class="promo-copy"><p class="promo-kicker">' +
        esc(t(keys.kicker)) +
        "</p><h2>" +
        lines(keys.title) +
        "</h2><p>" +
        fill(keys.text, { price: formatMoney(product.price), size: product.size }) +
        '</p><span class="btn promo-btn">' +
        esc(t(keys.btn)) +
        "</span></div></a>"
      );
    }
    const customSlides = window.KDBanner && Array.isArray(window.KDBanner.slides) ? window.KDBanner.slides : null;
    const slides = (customSlides
      ? customSlides
          .filter((slide) => slide && slide.on !== false)
          .map((slide, index) => (slide.type === "offer" ? offerSlide(slide) : photoSlide(slide, index === 0)))
      : [
          shockOffer({
            badge: esc(t("home.promoKicker")),
            line: lines("home.promoTitle"),
            btn: esc(t("home.promoBtn")),
            save: fill("home.promoNote", { gap: formatMoney(hit.price - plita.price) }),
            fine: fill("home.promoText"),
          }),
          promoShot(plita, { kicker: "home.slide2Kicker", title: "home.slide2Title", text: "home.slide2Text", btn: "home.slide2Btn" }, false),
          promoShot(hollow, { kicker: "home.slide3Kicker", title: "home.slide3Title", text: "home.slide3Text", btn: "home.slide3Btn" }, false),
        ]
    ).filter(Boolean);
    const many = slides.length > 1;
    const promo =
      '<div class="promo-stage" data-promo>' +
      '<div class="promo-viewport"><div class="promo-track">' +
      slides.join("") +
      "</div>" +
      (many
        ? '<button type="button" class="promo-arrow" data-promo-dir="-1" aria-label="' +
          esc(t("home.promoPrev")) +
          '">‹</button><button type="button" class="promo-arrow promo-arrow-next" data-promo-dir="1" aria-label="' +
          esc(t("home.promoNext")) +
          '">›</button>'
        : "") +
      "</div>" +
      (many
        ? '<div class="promo-dots" role="tablist" aria-label="' +
          esc(t("home.promoDots")) +
          '">' +
          slides
            .map(
              (_, i) =>
                '<button type="button" class="promo-dot' +
                (i === 0 ? " is-on" : "") +
                '" role="tab" data-promo-go="' +
                i +
                '" aria-label="' +
                esc(t("home.promoDot")) +
                " " +
                (i + 1) +
                '" aria-selected="' +
                (i === 0 ? "true" : "false") +
                '"></button>'
            )
            .join("") +
          "</div>"
        : "") +
      "</div>";
    const dealCards = offers
      .map((offer) => {
        const p = offer.product;
        if (!p || p.hidden) return "";
        return (
          '<article class="deal"><a class="deal-viz" href="#/product/' +
          p.id +
          '"><img width="1152" height="864" loading="lazy" decoding="async" src="' +
          esc(shotSrc(p)) +
          '" alt="' +
          esc(p.name) +
          '"></a><p class="deal-why">' +
          esc(offer.why) +
          '</p><h3><a href="#/product/' +
          p.id +
          '">' +
          esc(p.name) +
          "</a></h3><strong>" +
          formatMoney(offerPrice(p)) +
          " " +
          esc(offerLabel(p)) +
          "</strong></article>"
        );
      })
      .join("");
    const yard =
      '<div class="section-h"><h2>' + esc(t("home.yardTitle")) + '</h2><a href="#/product/' +
      hit.id +
      '">' + esc(t("home.yardOpen")) + "</a></div>" +
      '<div class="yard yard-home" id="yard">' +
      '<p class="yard-hint">' + esc(t("home.yardTileHint")) + "</p>" +
      '<div class="yard-switch" role="group" aria-label="' + esc(t("home.yardWhat")) + '">' +
      '<button type="button" class="is-on" data-yard="tile" aria-pressed="true">' + esc(t("home.yardTile")) + "</button>" +
      '<button type="button" data-yard="block" aria-pressed="false">' + esc(t("home.yardBlock")) + "</button>" +
      '<button type="button" data-yard="border" aria-pressed="false">' + esc(t("home.yardBorder")) + "</button>" +
      "</div>" +
      '<div class="yard-card"><span>' + esc(t("home.yardTileKicker")) + "</span><strong>" +
      esc(hit.name) +
      "</strong><b>" +
      formatMoney(hit.price) +
      "/м²</b></div></div>";
    return (
      '<div class="wrap home-top">' +
      promo +
      '<div class="section-h"><h2>' + esc(t("home.dealsTitle")) + '</h2><a href="#/catalog">' + esc(t("home.dealsAll")) + "</a></div>" +
      '<div class="deals">' +
      dealCards +
      "</div></div>" +
      '<section class="hero"><div class="wrap hero-sheet"><div class="hero-grid"><div>' +
      '<p class="eyebrow">' + esc(t("home.eyebrow")) + "</p>" +
      "<h1>" + lines("home.h1") + "</h1>" +
      '<p class="lede">' + lines("home.lede") + "</p>" +
      '<div class="hero-actions"><a class="btn" href="#/calc">' + esc(t("home.btnCatalog")) + '</a><a class="btn btn-line" href="#/delivery">' + esc(t("home.btnCalc")) + "</a></div>" +
      '<div class="stats"><div class="stat"><strong>' + esc(t("home.statTile")) + "</strong><span>" + esc(t("home.statTileNote")) + "</span></div>" +
      '<div class="stat"><strong>' + esc(t("home.statFrost")) + "</strong><span>" + esc(t("home.statFrostNote")) + "</span></div>" +
      '<div class="stat"><strong>1 клик</strong><span>' +
      esc(t("home.statCountNote")) +
      "</span></div></div></div></div></section>" +
      '<div class="wrap">' +
      cats +
      '<div class="section-h"><h2>' + esc(t("home.stockTitle")) + '</h2><a href="#/catalog">' + esc(t("home.dealsAll")) + "</a></div></div>" +
      '<div class="band"><div class="wrap band-in"><div class="grid">' +
      picks +
      "</div></div></div>" +
      '<div class="wrap">' +
      yard +
      '<div class="split" style="margin-top:34px"><div><p class="eyebrow">' + esc(t("home.passEyebrow")) + "</p><h2>" + esc(t("home.passTitle")) + "</h2>" +
      "<p>" + lines("home.passText") + "</p></div>" +
      "<table class=\"spec-table\"><tbody>" +
      row(t("home.pass1t"), t("home.pass1d")) +
      row(t("home.pass2t"), t("home.pass2d")) +
      row(t("home.pass3t"), t("home.pass3d")) +
      row(t("home.pass4t"), t("home.pass4d")) +
      row(t("home.pass5t"), t("home.pass5d")) +
      "</tbody></table></div>" +
      '<div class="section-h"><h2>' + esc(t("home.stepsTitle")) + "</h2></div>" +
      '<div class="steps">' +
      step("01", t("home.step1t"), t("home.step1d")) +
      step("02", t("home.step2t"), t("home.step2d")) +
      step("03", t("home.step3t"), t("home.step3d")) +
      step("04", t("home.step4t"), t("home.step4d")) +
      "</div>" +
      '<div class="cta"><div><h2>' + esc(t("home.ctaTitle")) + "</h2><p>" + esc(t("home.ctaText")) + "</p></div>" +
      '<button type="button" class="btn" data-action="callback">' + esc(t("home.ctaBtn")) + "</button></div></div>"
    );
  }

  function row(th, td) {
    return "<tr><th>" + esc(th) + "</th><td>" + esc(td) + "</td></tr>";
  }

  function step(n, title, text) {
    return '<article class="step"><b>' + n + "</b><h3>" + esc(title) + "</h3><p>" + esc(text) + "</p></article>";
  }

  function catLink(cat, cls, title, text) {
    const n = countCat(cat);
    const word = cat === "tile" ? plural(n, "форма", "формы", "форм") : plural(n, "позиция", "позиции", "позиций");
    const unit = cat === "tile" ? "/м²" : "/шт";
    return (
      '<a class="cat ' +
      cls +
      '" href="#/catalog?cat=' +
      cat +
      '"><span class="eyebrow">' +
      n +
      " " +
      word +
      "</span><strong>" +
      esc(title) +
      "</strong><em>" +
      esc(text) +
      "</em><b>от " +
      formatMoney(minPrice(cat)) +
      unit +
      "</b></a>"
    );
  }

  function catalogColors() {
    const map = new Map();
    PRODUCTS.forEach((p) => p.colors.forEach((c) => map.set(c.id, { id: c.id, label: c.name, color: c.hex })));
    return [{ id: "all", label: t("catalog.anyColor"), color: "" }].concat(Array.from(map.values()));
  }

  function filterMenuHtml(kind, title, value, options) {
    const current = options.find((option) => option.id === value) || options[0];
    return (
      '<details class="filter-menu" data-filter-menu="' +
      kind +
      '"><summary><span>' +
      esc(title) +
      '</span><strong data-filter-current>' +
      esc(current.label) +
      '</strong><i aria-hidden="true"></i></summary><div class="filter-options" role="listbox">' +
      options
        .map(
          (option) =>
            '<button type="button" role="option" class="' +
            (option.id === value ? "is-on" : "") +
            '" data-action="set-filter" data-filter="' +
            kind +
            '" data-value="' +
            option.id +
            '" data-label="' +
            esc(option.label) +
            '" aria-selected="' +
            (option.id === value) +
            '">' +
            (kind === "color"
              ? '<span class="filter-swatch' +
                (option.id === "all" ? " is-all" : "") +
                '"' +
                (option.color ? ' style="background:' + safeHex(option.color) + '"' : "") +
                "></span>"
              : "") +
            "<span>" +
            esc(option.label) +
            "</span><b aria-hidden=\"true\">✓</b></button>"
        )
        .join("")
      + "</div></details>"
    );
  }

  function renderCatalog() {
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("catalog.title")) +
      '<div class="toolbar"><div class="chips">' +
      CATS.map((c) => {
        const on = state.cat === c.id;
        return (
          '<button type="button" class="chip' +
          (on ? " is-on" : "") +
          '" data-action="set-cat" data-cat="' +
          c.id +
          '" aria-pressed="' +
          on +
          '">' +
          esc({ all: t("catalog.chipAll"), tile: t("catalog.chipTile"), block: t("catalog.chipBlock"), border: t("catalog.chipBorder"), bulk: t("catalog.chipBulk") }[c.id] || c.name) +
          "</button>"
        );
      }).join("") +
      '</div><div class="toolbar-tools">' +
      filterMenuHtml("color", t("catalog.colorLabel"), state.color, catalogColors()) +
      filterMenuHtml(
        "thick",
        t("catalog.thickLabel"),
        state.thick,
        ["all", "50", "60", "80"].map((id) => ({ id, label: id === "all" ? t("catalog.anyThick") : id + " мм" }))
      ) +
      filterMenuHtml("sort", t("catalog.sortLabel"), state.sort, [
        { id: "pop", label: t("catalog.sortPop") },
        { id: "cheap", label: t("catalog.sortCheap") },
        { id: "dear", label: t("catalog.sortDear") },
      ]) +
      '<input id="q" type="search" placeholder="' + esc(t("catalog.search")) + '" aria-label="' + esc(t("catalog.search")) + '" value="' +
      esc(state.q) +
      '">' +
      "</div></div>" +
      '<p class="count" id="result-count"></p><div class="grid" id="grid"></div></div></section>'
    );
  }

  function filteredProducts() {
    const q = state.q.trim().toLowerCase();
    let list = PRODUCTS.filter((p) => {
      if (p.hidden) return false;
      if (state.cat !== "all" && p.category !== state.cat) return false;
      if (state.color !== "all" && !p.colors.some((c) => c.id === state.color)) return false;
      if (state.thick !== "all" && String(p.thickness || "") !== String(state.thick)) return false;
      if (q && (p.name + " " + p.size + " " + p.lead).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    const catOrder = { tile: 0, block: 1, border: 2, bulk: 3 };
    const byPrice = (a, b, dir) => {
      if (state.cat === "all" && a.category !== b.category) return catOrder[a.category] - catOrder[b.category];
      return (a.price - b.price) * dir || a.name.localeCompare(b.name, "ru");
    };
    if (state.sort === "cheap") list.sort((a, b) => byPrice(a, b, 1));
    else if (state.sort === "dear") list.sort((a, b) => byPrice(a, b, -1));
    else list.sort((a, b) => Number(b.popular) - Number(a.popular) || a.price - b.price);
    return list;
  }

  function fillGrid() {
    const grid = document.getElementById("grid");
    if (!grid) return;
    const list = filteredProducts();
    const count = document.getElementById("result-count");
    if (count) {
      count.textContent = list.length + " " + plural(list.length, "позиция", "позиции", "позиций");
    }
    grid.innerHTML = list.length
      ? list.map((p) => cardHtml(p, true)).join("")
      : '<div class="empty"><p>' + esc(t("catalog.empty")) + '</p><button type="button" class="btn btn-ink" data-action="reset-filters">' + esc(t("catalog.reset")) + "</button></div>";
    bindModelSpins(grid);
  }

  function paintFilterMenu(kind, value) {
    const menu = document.querySelector('[data-filter-menu="' + kind + '"]');
    if (!menu) return;
    const options = [...menu.querySelectorAll("[data-action=set-filter]")];
    const active = options.find((option) => option.dataset.value === String(value)) || options[0];
    options.forEach((option) => {
      const on = option === active;
      option.classList.toggle("is-on", on);
      option.setAttribute("aria-selected", String(on));
    });
    const current = menu.querySelector("[data-filter-current]");
    if (current && active) current.textContent = active.dataset.label;
  }

  function animateCatalogFilter() {
    const toolbar = document.querySelector(".toolbar");
    const grid = document.getElementById("grid");
    if (toolbar) {
      toolbar.classList.remove("is-filtering");
      void toolbar.offsetWidth;
      toolbar.classList.add("is-filtering");
      setTimeout(() => toolbar.classList.remove("is-filtering"), 420);
    }
    if (grid) {
      grid.classList.remove("is-refreshing");
      void grid.offsetWidth;
      grid.classList.add("is-refreshing");
      setTimeout(() => grid.classList.remove("is-refreshing"), 320);
    }
  }

  function renderProduct(id) {
    const p = productById(id);
    if (!p) {
      return '<section class="page"><div class="wrap">' + pageHead(t("product.missing"), "") + '<p><a href="#/catalog">' + esc(t("product.toCatalog")) + "</a></p></div></section>";
    }
    const color = p.colors[0];
    const related = PRODUCTS.filter((item) => !item.hidden && item.category === p.category && item.id !== p.id).slice(0, 4);
    return (
      '<section class="page"><div class="wrap">' +
      '<p class="crumbs"><a href="#/">' + esc(t("product.crumbHome")) + "</a> · <a href=\"#/catalog?cat=" +
      p.category +
      '">' +
      esc(catTitle(p.category)) +
      "</a> · " +
      esc(p.name) +
      "</p>" +
      '<div class="product" data-color-scope><div class="media-frame is-photo"><div class="product-media" data-media data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '" data-view="photo">' +
      photoHtml(p, color.id) +
      "</div>" +
      spinButtons() +
      viewSwitch(true) +
      '</div><div class="product-panel">' +
      '<p class="eyebrow">' +
      esc(cardKicker(p)) +
      " · " +
      esc(p.stock) +
      "</p><h1>" +
      esc(p.name) +
      "</h1><p>" +
      esc(p.lead) +
      "</p>" +
      '<p class="product-sum" id="product-sum">' +
      formatMoney(offerPrice(p)) +
      "<small> " +
      esc(offerLabel(p)) +
      "</small></p>" +
      '<div class="swatches"><div class="dots">' +
      dotsHtml(p) +
      '</div><span class="color-name" id="color-name">' +
      esc(color.name) +
      "</span></div>" +
      '<p class="assure">' +
      esc(p.stock === "В наличии" ? "В наличии · отгрузка в день оплаты" : p.stock) +
      "</p>" +
      '<div class="qty-row"><button type="button" class="btn" data-action="add-qty" data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '">' + esc(t("product.cart")) + "</button>" +
      '<button type="button" class="btn btn-line paper-line" data-action="buy" data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '">Купить</button>' +
      "</div>" +
      '<div class="product-actions">' +
      compareMark(p.id) +
      "</div>" +
      "<table class=\"specs\"><tbody>" +
      row(t("product.rowSize"), p.size) +
      row(t("product.rowPrice"), formatMoney(p.price) + "/" + p.unit + (secondaryPrice(p) ? " · " + secondaryPrice(p) : "")) +
      row(t("product.rowMark"), p.mark + " · " + p.frost) +
      row(t("product.rowStd"), p.standard) +
      row(t("product.rowWeight"), p.weight) +
      row(t("product.rowPcs"), p.piecesLabel) +
      row(t("product.rowPallet"), p.pallet) +
      row(t("product.rowUse"), p.usage) +
      "</tbody></table></div>" +
      '<div class="buy-bar" id="buy-bar" hidden><div class="wrap buy-bar-inner"><div><strong>' +
      esc(p.name) +
      '</strong><span class="buy-bar-meta" id="buy-bar-meta">' +
      esc(color.name) +
      " · " +
      formatMoney(offerPrice(p)) +
      " " +
      esc(offerLabel(p)) +
      '</span></div><button type="button" class="btn" data-action="buy" data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '">Купить</button></div></div></div>' +
      productLayHtml(p) +
      withThisHtml(p) +
      (related.length
        ? '<div class="section-h"><h2>' + esc(t("product.related")) + "</h2></div><div class=\"grid\">" + related.map((item) => cardHtml(item, true)).join("") + "</div>"
        : "") +
      "</div></section>"
    );
  }

  function borderForTile(product) {
    if (product.thickness >= 80) return productById("border-road");
    if (product.thickness >= 60) return productById("border-walk");
    return productById("border-garden");
  }

  function withThisHtml(product) {
    if (product.category !== "tile") return "";
    const area = product.defaultQty;
    const sandQty = roundQty(area * 0.05);
    const gravelQty = roundQty(area * 0.1);
    const border = borderForTile(product);
    const items = [
      {
        product: border,
        note: t("product.withBorder"),
        qty: border.defaultQty,
        label: formatQty(border.defaultQty) + " шт",
      },
      {
        product: productById("sand"),
        note: t("product.withSand"),
        qty: sandQty,
        label: formatQty(sandQty) + " м³",
      },
      {
        product: productById("gravel"),
        note: t("product.withGravel"),
        qty: gravelQty,
        label: formatQty(gravelQty) + " м³",
      },
    ];
    return (
      '<div class="section-h"><h2>' + esc(t("product.withTitle")) + '</h2><a href="#/calc" data-action="open-calc" data-id="' +
      product.id +
      '">' + esc(t("product.withCalc")) + "</a></div>" +
      '<p class="with-note">' +
      fill("product.withNote", { area: formatQty(area), sand: formatQty(sandQty), gravel: formatQty(gravelQty) }) +
      "</p>" +
      '<div class="with-grid">' +
      items
        .map((item) => {
          const c = item.product.colors[0];
          return (
            '<article class="with-item"><a class="with-viz" href="#/product/' +
            item.product.id +
            '"><img width="1152" height="864" loading="lazy" decoding="async" src="' +
            esc(window.KDAdmin && KDAdmin.photoSrc ? KDAdmin.photoSrc(item.product.id) : "img/" + item.product.id + ".jpg") +
            '" alt="' +
            esc(item.product.name) +
            '">' +
            '</a><div><h3><a href="#/product/' +
            item.product.id +
            '">' +
            esc(item.product.name) +
            '</a></h3><p class="meta">' +
            esc(item.note) +
            "</p><strong>" +
            formatMoney(item.product.price) +
            "/" +
            esc(item.product.unit) +
            '</strong><button type="button" class="btn" data-action="add" data-id="' +
            item.product.id +
            '" data-color="' +
            c.id +
            '" data-qty="' +
            item.qty +
            '">' + esc(t("product.cart")) + " · " +
            esc(item.label) +
            "</button></div></article>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function convertQty(product, amount, reserve) {
    const k = 1 + (Number(reserve) || 0) / 100;
    const raw = Number(amount) * k;
    if (!(raw > 0)) return 0;
    if (product.category === "block") return Math.ceil(raw * product.pcsPerM2);
    if (product.category === "border") return Math.ceil(raw);
    return Math.round(raw * 10) / 10;
  }

  function projectAmount(calc) {
    if (calc.project === "yard") {
      return Number(calc.yardLength) * Number(calc.yardWidth);
    }
    if (calc.project === "house") {
      const perimeter = 2 * (Number(calc.houseLength) + Number(calc.houseWidth));
      return Math.max(0, perimeter * Number(calc.houseHeight) - Number(calc.houseOpenings || 0));
    }
    return Number(calc.amount);
  }

  function projectBorderMeters(calc) {
    if (calc.project === "yard") return 2 * (Number(calc.yardLength) + Number(calc.yardWidth));
    return Number(calc.borderMeters);
  }

  function buildEstimate(calc) {
    const p = productById(calc.productId);
    if (!p) return null;
    const amount = projectAmount(calc);
    if (!isFinite(amount) || amount <= 0 || amount > 100000) return { empty: true, product: p };
    const qty = convertQty(p, amount, calc.reserve);
    const color = colorObj(p, calc.colorId);
    const lines = [];
    lines.push({
      title: p.name + (p.colors.length > 1 ? ", " + color.name.toLowerCase() : ""),
      detail: detailFor(p, amount, calc.reserve, qty),
      qty: qty,
      unit: p.unit,
      price: p.price,
      sum: Math.round(qty * p.price),
      cart: { id: p.id, colorId: color.id, qty: qty },
    });
    const borderMeters = projectBorderMeters(calc);
    if (p.category === "tile" && borderMeters > 0) {
      const b = productById(calc.borderId);
      const bqty = Math.ceil(borderMeters);
      lines.push({
        title: b.name,
        detail: bqty + " п.м",
        qty: bqty,
        unit: b.unit,
        price: b.price,
        sum: Math.round(bqty * b.price),
        cart: { id: b.id, colorId: b.colors[0].id, qty: bqty },
      });
    }
    if (p.category === "tile" && calc.withBase) {
      const sand = Math.round(amount * 0.05 * 10) / 10;
      const gravel = Math.round(amount * 0.1 * 10) / 10;
      lines.push({
        title: t("calc.sandTitle"),
        detail: t("calc.sandDetail"),
        qty: sand,
        unit: "м³",
        price: SITE.sandPrice,
        sum: Math.round(sand * SITE.sandPrice),
        cart: { id: "sand", colorId: "sand", qty: sand },
      });
      lines.push({
        title: t("calc.gravelTitle"),
        detail: t("calc.gravelDetail"),
        qty: gravel,
        unit: "м³",
        price: SITE.gravelPrice,
        sum: Math.round(gravel * SITE.gravelPrice),
        cart: { id: "gravel", colorId: "graphite", qty: gravel },
      });
    }
    const goods = lines.reduce((s, l) => s + l.sum, 0);
    const delivery = SITE.delivery.find((d) => d.id === calc.delivery) || SITE.delivery[0];
    let note = "";
    if (p.category === "tile" && qty < 10) note = t("calc.noteTile");
    if (p.category === "block" && qty < 50) note = t("calc.noteBlock");
    if (calc.project === "house") {
      note = "Упрощённый расчёт наружных стен. Раствор, армирование, фронтоны и внутренние перегородки не включены.";
    }
    return { lines, goods, delivery, total: goods + delivery.price, product: p, note };
  }

  function detailFor(p, amount, reserve, qty) {
    const base = formatQty(amount) + " × запас " + reserve + "%";
    if (p.category === "tile") return base + " · " + Math.ceil(qty * p.pcsPerM2) + " шт";
    if (p.category === "block") return base + " · " + formatQty(amount) + " м² стены";
    return base;
  }

  function layingSvg(calc) {
    const p = productById(calc.productId);
    if (!p || calc.project !== "yard" || p.category !== "tile") return "";
    const color = colorObj(p, calc.colorId);
    const L = Math.max(0.4, Number(calc.yardLength) || 1);
    const W = Math.max(0.4, Number(calc.yardWidth) || 1);
    const vw = 360;
    const vh = 220;
    const pad = 22;
    const scale = Math.min((vw - pad * 2) / L, (vh - pad * 2) / W);
    const rw = L * scale;
    const rh = W * scale;
    const x = (vw - rw) / 2;
    const y = (vh - rh) / 2;
    const tile = Math.max(9, Math.min(16, rw / 14));
    const diagonal = calc.pattern === "diagonal";
    const span = Math.ceil(Math.hypot(rw, rh) + tile * 3);
    const count = Math.ceil(span / tile);
    let cells = "";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        const fill = (r + c) % 2 === 0 ? safeHex(color.hex) : shadeHex(color.hex, 0.84);
        cells +=
          '<rect x="' +
          (c * tile).toFixed(1) +
          '" y="' +
          (r * tile).toFixed(1) +
          '" width="' +
          (tile - 1.2).toFixed(1) +
          '" height="' +
          (tile - 1.2).toFixed(1) +
          '" fill="' +
          fill +
          '"/>';
      }
    }
    const ox = ((rw - count * tile) / 2).toFixed(1);
    const oy = ((rh - count * tile) / 2).toFixed(1);
    const rot = diagonal
      ? ' transform="translate(' +
        (rw / 2).toFixed(1) +
        " " +
        (rh / 2).toFixed(1) +
        ") rotate(45) translate(" +
        (-(count * tile) / 2).toFixed(1) +
        " " +
        (-(count * tile) / 2).toFixed(1) +
        ')"'
      : ' transform="translate(' + ox + " " + oy + ')"';
    const caption = (diagonal ? "Диагональная" : "Прямая") + " укладка · " + formatQty(L) + "×" + formatQty(W) + " м";
    return (
      '<figure class="lay-scheme"><svg viewBox="0 0 ' +
      vw +
      " " +
      vh +
      '" role="img" aria-label="' +
      esc(caption) +
      '"><rect x="' +
      (x - 8).toFixed(1) +
      '" y="' +
      (y - 8).toFixed(1) +
      '" width="' +
      (rw + 16).toFixed(1) +
      '" height="' +
      (rh + 16).toFixed(1) +
      '" rx="4" fill="#d9cfc2"/><svg x="' +
      x.toFixed(1) +
      '" y="' +
      y.toFixed(1) +
      '" width="' +
      rw.toFixed(1) +
      '" height="' +
      rh.toFixed(1) +
      '" viewBox="0 0 ' +
      rw.toFixed(1) +
      " " +
      rh.toFixed(1) +
      '"><defs><clipPath id="lay-clip"><rect width="' +
      rw.toFixed(1) +
      '" height="' +
      rh.toFixed(1) +
      '"/></clipPath></defs><g clip-path="url(#lay-clip)"' +
      rot +
      ">" +
      cells +
      "</g></svg></svg><figcaption>" +
      esc(caption) +
      "</figcaption></figure>"
    );
  }

  function productLayHtml(p) {
    if (p.category !== "tile") return "";
    return (
      '<div class="product-lay" id="product-lay" data-id="' +
      p.id +
      '"><div class="section-h"><h2>Как ляжет во дворе</h2><a href="#/calc" data-action="open-calc" data-id="' +
      p.id +
      '">Посчитать свой двор</a></div>' +
      '<div class="lay-switch" role="group" aria-label="Схема укладки">' +
      '<button type="button" class="is-on" data-action="lay-pattern" data-pattern="straight" aria-pressed="true">Прямая</button>' +
      '<button type="button" data-action="lay-pattern" data-pattern="diagonal" aria-pressed="false">Диагональ</button>' +
      "</div>" +
      layingSvg({
        project: "yard",
        productId: p.id,
        colorId: p.colors[0].id,
        yardLength: 6,
        yardWidth: 4,
        pattern: "straight",
      }) +
      '<p class="note">Схема показывает выбранный цвет на площадке 6×4 м. Это рисунок укладки, не снимок конкретного двора.</p></div>'
    );
  }

  function estimateHtml(est) {
    if (!est || est.empty) {
      return '<div class="invoice"><h2>' + esc(t("calc.estimate")) + "</h2><p>" + esc(t("calc.empty")) + "</p></div>";
    }
    const rows = est.lines
      .map((l) => {
        return (
          "<tr><td>" +
          esc(l.title) +
          '<div class="note">' +
          esc(l.detail) +
          "</div></td><td class=\"num\">" +
          formatQty(l.qty) +
          " " +
          esc(l.unit) +
          " × " +
          formatMoney(l.price) +
          "<br>" +
          formatMoney(l.sum) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="invoice"><h2>' + esc(t("calc.estimate")) + "</h2><table><tbody>" +
      rows +
      "<tr><td>" + esc(t("calc.goods")) + "</td><td class=\"num\">" +
      formatMoney(est.goods) +
      "</td></tr><tr><td>" +
      esc(est.delivery.name) +
      '<div class="note">' +
      esc(est.delivery.note) +
      "</div></td><td class=\"num\">" +
      formatMoney(est.delivery.price) +
      '</td></tr><tr class="total-row"><td>' + esc(t("calc.total")) + '</td><td class="num">' +
      formatMoney(est.total) +
      "</td></tr></tbody></table>" +
      (est.note ? '<p class="note">' + esc(est.note) + "</p>" : "") +
      '<p class="note">' + esc(t("calc.note")) + "</p>" +
      '<button type="button" class="btn" data-action="add-estimate">' + esc(t("calc.toCart")) + "</button></div>"
    );
  }

  function setCalcProject(project) {
    if (["yard", "house", "manual"].indexOf(project) === -1) return;
    state.calc.project = project;
    const current = productById(state.calc.productId);
    if (project === "yard" && (!current || current.category !== "tile")) {
      state.calc.productId = "kirpich-60";
      state.calc.colorId = productById(state.calc.productId).colors[0].id;
      state.calc.withBase = true;
    }
    if (project === "house" && (!current || current.category !== "block")) {
      state.calc.productId = "block-hollow";
      state.calc.colorId = productById(state.calc.productId).colors[0].id;
    }
    state.calc.amount = projectAmount(state.calc);
    if (project === "yard") state.calc.borderMeters = projectBorderMeters(state.calc);
  }

  function pickerShell(id, labelId, options) {
    return (
      '<div class="picker" data-picker>' +
      '<select id="' +
      id +
      '" class="picker-native" tabindex="-1" aria-hidden="true">' +
      options +
      "</select>" +
      '<button type="button" class="picker-btn" id="' +
      id +
      '-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' +
      labelId +
      '">' +
      '<i class="filter-swatch picker-current" hidden></i>' +
      '<span class="picker-value"></span>' +
      '<i class="picker-chevron" aria-hidden="true"></i>' +
      "</button>" +
      '<div class="picker-menu" role="listbox" hidden></div></div>'
    );
  }

  function closePicker(picker) {
    picker.classList.remove("is-open");
    const btn = picker.querySelector(".picker-btn");
    const menu = picker.querySelector(".picker-menu");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  }

  function mountPicker(select) {
    const picker = select.closest("[data-picker]");
    if (!picker) return;
    const menu = picker.querySelector(".picker-menu");
    const selected = select.selectedOptions[0];
    const hasSwatch = [...select.options].some((opt) => opt.dataset.hex);
    picker.classList.toggle("has-swatch", hasSwatch);
    const parts = [];
    function optionButton(opt) {
      const on = opt === selected;
      const hex = opt.dataset.hex;
      return (
        '<button type="button" class="picker-opt' +
        (on ? " is-on" : "") +
        '" role="option" data-picker-value="' +
        esc(opt.value) +
        '" aria-selected="' +
        on +
        '">' +
        (hex ? '<i class="filter-swatch" style="background:' + safeHex(hex) + '"></i>' : "") +
        "<span>" +
        esc(opt.textContent) +
        '</span><b aria-hidden="true">✓</b></button>'
      );
    }
    [...select.children].forEach((node) => {
      if (node.tagName === "OPTGROUP") {
        if (!node.children.length) return;
        parts.push('<p class="picker-group">' + esc(node.label) + "</p>");
        [...node.children].forEach((opt) => parts.push(optionButton(opt)));
      } else if (node.tagName === "OPTION") {
        parts.push(optionButton(node));
      }
    });
    menu.innerHTML = parts.join("");
    const valueEl = picker.querySelector(".picker-value");
    if (valueEl) valueEl.textContent = selected ? selected.textContent : "";
    const swatch = picker.querySelector(".picker-current");
    if (swatch) {
      const hex = selected && selected.dataset.hex;
      swatch.hidden = !hex;
      if (hex) swatch.style.background = safeHex(hex);
    }
  }

  function renderCalcBody() {
    const calc = state.calc;
    const project = calc.project || "manual";
    const projectCat = project === "yard" ? "tile" : project === "house" ? "block" : "";
    const paving = PRODUCTS.filter(
      (p) => !p.hidden && (p.category === "tile" || p.category === "block" || p.category === "border") && (!projectCat || p.category === projectCat)
    );
    const groups = [
      [t("calc.groupTile"), "tile"],
      [t("calc.groupBlock"), "block"],
      [t("calc.groupBorder"), "border"],
    ];
    const options = groups
      .map(([label, cat]) => {
        const inner = paving
          .filter((p) => p.category === cat)
          .map(
            (p) =>
              '<option value="' +
              p.id +
              '" data-hex="' +
              safeHex(p.colors[0].hex) +
              '"' +
              (p.id === calc.productId ? " selected" : "") +
              ">" +
              esc(p.name) +
              "</option>"
          )
          .join("");
        return "<optgroup label=\"" + esc(label) + "\">" + inner + "</optgroup>";
      })
      .join("");
    const product = productById(calc.productId);
    const showPaving = product.category === "tile";
    let projectFields = "";
    if (project === "yard") {
      projectFields =
        '<div class="calc-dim-grid"><label class="field"><span>Длина двора, м</span><input id="calc-yard-length" type="number" min="0.1" step="0.1" value="' +
        calc.yardLength +
        '"></label><label class="field"><span>Ширина двора, м</span><input id="calc-yard-width" type="number" min="0.1" step="0.1" value="' +
        calc.yardWidth +
        '"></label></div><div class="calc-result"><span>Площадь мощения</span><strong id="calc-result-main">' +
        formatQty(projectAmount(calc)) +
        ' м²</strong><small id="calc-result-sub">Бордюр по периметру: ' +
        formatQty(projectBorderMeters(calc)) +
        " м</small></div>";
    } else if (project === "house") {
      projectFields =
        '<div class="calc-dim-grid"><label class="field"><span>Длина дома, м</span><input id="calc-house-length" type="number" min="0.1" step="0.1" value="' +
        calc.houseLength +
        '"></label><label class="field"><span>Ширина дома, м</span><input id="calc-house-width" type="number" min="0.1" step="0.1" value="' +
        calc.houseWidth +
        '"></label><label class="field"><span>Высота стен, м</span><input id="calc-house-height" type="number" min="0.1" step="0.1" value="' +
        calc.houseHeight +
        '"></label><label class="field"><span>Окна и двери, м²</span><input id="calc-house-openings" type="number" min="0" step="0.1" value="' +
        calc.houseOpenings +
        '"></label></div><div class="calc-result"><span>Площадь наружных стен</span><strong id="calc-result-main">' +
        formatQty(projectAmount(calc)) +
        ' м²</strong><small id="calc-result-sub">Периметр: ' +
        formatQty(2 * (Number(calc.houseLength) + Number(calc.houseWidth))) +
        " м</small></div>";
    } else {
      projectFields =
        '<label class="field"><span id="amount-label">' +
        esc(product.inputLabel) +
        '</span><input id="calc-amount" type="number" min="0" step="0.1" value="' +
        calc.amount +
        '"></label>';
    }
    return (
      '<form id="calc-form" class="calc-layout"><div class="sheet"><h2>' + esc(t("calc.inputs")) + "</h2>" +
      '<div class="calc-projects" role="group" aria-label="Что рассчитать">' +
      [
        ["yard", "Двор", "Плитка, бордюр и основание"],
        ["house", "Дом", "Шлакоблок для наружных стен"],
        ["manual", "Материал", "Расчёт одной позиции"],
      ]
        .map(
          ([id, title, text]) =>
            '<button type="button" class="calc-project' +
            (project === id ? " is-on" : "") +
            '" data-action="calc-project" data-project="' +
            id +
            '" aria-pressed="' +
            (project === id) +
            '"><strong>' +
            title +
            "</strong><small>" +
            text +
            "</small></button>"
        )
        .join("") +
      "</div>" +
      (project === "yard"
        ? '<div class="lay-switch" role="group" aria-label="Схема укладки">' +
          [
            ["straight", "Прямая"],
            ["diagonal", "Диагональ"],
          ]
            .map(
              ([id, title]) =>
                '<button type="button" class="' +
                (calc.pattern === id ? "is-on" : "") +
                '" data-action="calc-pattern" data-pattern="' +
                id +
                '" aria-pressed="' +
                (calc.pattern === id) +
                '">' +
                title +
                "</button>"
            )
            .join("") +
          "</div>" +
          (calc.pattern === "diagonal" ? '<p class="note">На диагональ ставим запас 15%: подрезки больше, чем при прямой укладке.</p>' : "")
        : "") +
      projectFields +
      '<div class="field"><span id="calc-product-label">' +
      esc(t("calc.product")) +
      "</span>" +
      pickerShell("calc-product", "calc-product-label", options) +
      "</div>" +
      '<div class="field" id="calc-color-field"' +
      (product.colors.length < 2 ? " hidden" : "") +
      '><span id="calc-color-label">' +
      esc(t("calc.color")) +
      "</span>" +
      pickerShell(
        "calc-color",
        "calc-color-label",
        product.colors
          .map(
            (c) =>
              '<option value="' +
              c.id +
              '" data-hex="' +
              safeHex(c.hex) +
              '"' +
              (c.id === calc.colorId ? " selected" : "") +
              ">" +
              esc(c.name) +
              "</option>"
          )
          .join("")
      ) +
      "</div>" +
      '<div class="field"><span id="calc-reserve-label">' +
      esc(t("calc.reserve")) +
      "</span>" +
      pickerShell(
        "calc-reserve",
        "calc-reserve-label",
        [0, 5, 7, 10, 15]
          .map((n) => '<option value="' + n + '"' + (Number(calc.reserve) === n ? " selected" : "") + ">" + n + "%</option>")
          .join("")
      ) +
      "</div>" +
      '<div id="paving-extra"' +
      (showPaving ? "" : " hidden") +
      ">" +
      '<div class="field"><span id="calc-border-label">' +
      esc(t("calc.border")) +
      "</span>" +
      pickerShell(
        "calc-border",
        "calc-border-label",
        PRODUCTS.filter((p) => p.category === "border" && !p.hidden)
          .map(
            (p) =>
              '<option value="' +
              p.id +
              '" data-hex="' +
              safeHex(p.colors[0].hex) +
              '"' +
              (p.id === calc.borderId ? " selected" : "") +
              ">" +
              esc(p.name) +
              " — " +
              formatMoney(p.price) +
              "</option>"
          )
          .join("")
      ) +
      "</div>" +
      (project === "manual"
        ? '<label class="field"><span>' + esc(t("calc.borderM")) + '</span><input id="calc-border-m" type="number" min="0" step="1" value="' + calc.borderMeters + '"></label>'
        : "") +
      '<label class="base-toggle"><input id="calc-base" type="checkbox"' +
      (calc.withBase ? " checked" : "") +
      '><span class="base-mark" aria-hidden="true"></span><span>' +
      esc(t("calc.base")) +
      "</span></label></div>" +
      '<div class="field"><span id="calc-delivery-label">' +
      esc(t("calc.delivery")) +
      "</span>" +
      pickerShell(
        "calc-delivery",
        "calc-delivery-label",
        SITE.delivery
          .map((d) => '<option value="' + d.id + '"' + (d.id === calc.delivery ? " selected" : "") + ">" + esc(d.name) + " — " + formatMoney(d.price) + "</option>")
          .join("")
      ) +
      "</div></div>" +
      '<div id="estimate">' +
      layingSvg(calc) +
      estimateHtml(buildEstimate(calc)) +
      "</div></form>"
    );
  }

  function renderCalc() {
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("calc.title"), "Выберите двор или дом, укажите размеры — калькулятор покажет схему укладки, количество материалов и общую сумму.") +
      '<div id="calc-root">' +
      renderCalcBody() +
      "</div></div></section>"
    );
  }

  function renderDelivery() {
    const zones = SITE.delivery
      .map((d) => {
        return (
          '<article class="zone"><div><strong>' +
          esc(d.name) +
          '</strong><div class="note">' +
          esc(d.note) +
          "</div></div><b>" +
          (d.price ? formatMoney(d.price) : "0 ₽") +
          "</b></article>"
        );
      })
      .join("");
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("delivery.title"), t("delivery.lede")) +
      '<div class="zones">' +
      zones +
      '</div><h2 style="margin-top:28px">' + esc(t("delivery.before")) + "</h2>" +
      "<details open><summary>" + esc(t("delivery.q1")) + "</summary><p>" + lines("delivery.a1") + "</p></details>" +
      "<details><summary>" + esc(t("delivery.q2")) + "</summary><p>" + lines("delivery.a2") + "</p></details>" +
      "<details><summary>" + esc(t("delivery.q3")) + "</summary><p>" + lines("delivery.a3") + "</p></details>" +
      "<details><summary>" + esc(t("delivery.q4")) + "</summary><p>" + lines("delivery.a4") + "</p></details>" +
      "</div></section>"
    );
  }

  function renderContacts() {
    return (
      '<section class="page"><div class="wrap contacts"><div>' +
      pageHead(t("contacts.title"), t("contacts.lede")) +
      "<p><a data-fill-href=\"phoneHref\" href=\"" +
      esc(SITE.phoneHref) +
      "\"><strong data-fill=\"phone\">" +
      esc(SITE.phone) +
      '</strong></a><br><span data-fill="hours">' +
      esc(SITE.hours) +
      "</span></p>" +
      "<p>" +
      esc(SITE.address) +
      "</p>" +
      (canEmail() ? "<p><a href=\"mailto:" + esc(SITE.email) + "\">" + esc(SITE.email) + "</a></p>" : "") +
      '<div class="map"><p class="eyebrow">' + esc(t("contacts.mapEyebrow")) + "</p><strong>" +
      esc(SITE.address) +
      '</strong><p class="note">' + esc(t("contacts.mapNote")) + "</p></div></div>" +
      '<div class="sheet" id="contact-box"><h2>' + esc(t("contacts.formTitle")) + '</h2><form id="contact-form">' +
      '<label class="field"><span>' + esc(t("contacts.name")) + '</span><input name="name" autocomplete="name" required></label>' +
      '<label class="field"><span>' + esc(t("contacts.phone")) + '</span><input name="phone" autocomplete="tel" inputmode="tel" required></label>' +
      '<label class="field"><span>' + esc(t("contacts.need")) + '</span><textarea name="comment" placeholder="' + esc(t("contacts.needPh")) + '"></textarea></label>' +
      '<p class="form-error" hidden></p>' +
      '<button class="btn" type="submit">' + esc(t("contacts.submit")) + "</button>" +
      '<p class="note">' +
      esc(canEmail() ? t("contacts.noteMail") : t("contacts.noteCall")) +
      "</p></form></div></div></section>"
    );
  }

  function renderCart() {
    const lines = cart
      .map((line) => {
        const p = productById(line.id);
        if (!p) return "";
        const color = colorObj(p, line.colorId);
        return (
          '<div class="line"><div class="line-viz">' +
          viz(p, color.id) +
          '</div><div><a href="#/product/' +
          p.id +
          '">' +
          esc(p.name) +
          '</a><span class="meta">' +
          esc(p.colors.length > 1 ? color.name + " · " : "") +
          esc(p.size) +
          "</span></div>" +
          '<div class="stepper"><button type="button" data-action="dec" data-id="' +
          p.id +
          '" data-color="' +
          color.id +
          '" aria-label="' + esc(t("product.less")) + '">−</button><input class="qty-input" type="text" inputmode="decimal" autocomplete="off" data-qty-input data-id="' +
          p.id +
          '" data-color="' +
          color.id +
          '" aria-label="' +
          esc(t("product.qty") + ", " + p.unit) +
          '" value="' +
          esc(line.qty) +
          '"><span class="stepper-unit">' +
          esc(p.unit) +
          '</span><button type="button" data-action="inc" data-id="' +
          p.id +
          '" data-color="' +
          color.id +
          '" aria-label="' + esc(t("product.more")) + '">+</button></div><strong class="line-sum">' +
          formatMoney(p.price * line.qty) +
          '</strong><button type="button" class="icon-x" data-action="remove" data-id="' +
          p.id +
          '" data-color="' +
          color.id +
          '" aria-label="' + esc(t("product.remove")) + '">×</button></div>'
        );
      })
      .join("");
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("cart.title"), t("cart.lede")) +
      (cart.length
        ? '<div class="cart-layout"><div class="sheet"><div style="display:flex;justify-content:space-between;gap:8px"><h2>' + esc(t("cart.lines")) + '</h2><button type="button" class="btn btn-line paper-line" data-action="clear-cart">' + esc(t("cart.clear")) + "</button></div>" +
          lines +
          '</div><div class="summary"><h2>' + esc(t("cart.total")) + '</h2><p class="product-sum">' +
          formatMoney(cartTotal()) +
          '</p><p class="note">' + esc(t("cart.deliveryNote")) + '</p><form id="checkout">' +
          '<label class="field"><span>' + esc(t("contacts.name")) + '</span><input name="name" autocomplete="name" required></label>' +
          '<label class="field"><span>' + esc(t("contacts.phone")) + '</span><input name="phone" autocomplete="tel" inputmode="tel" required></label>' +
          '<label class="field"><span>' + esc(t("cart.email")) + '</span><input name="mail" type="email" autocomplete="email" inputmode="email" required></label>' +
          '<label class="field"><span>' + esc(t("cart.address")) + '</span><textarea name="comment"></textarea></label>' +
          '<p class="form-error" hidden></p><button class="btn" type="submit">' + esc(t("cart.submit")) + "</button>" +
          '<p class="note">' + esc(t("cart.noteMail")) + "</p></form></div></div>"
        : '<div class="empty"><p>' + esc(t("cart.empty")) + '</p><p><a class="btn" href="#/catalog">' + esc(t("cart.toCatalog")) + '</a> <a class="btn btn-line paper-line" href="#/calc">' + esc(t("cart.toCalc")) + "</a></p></div>") +
      "</div></section>"
    );
  }

  function renderFav() {
    const lines = favs
      .map((line) => {
        const p = productById(line.id);
        if (!p) return "";
        const color = colorObj(p, line.colorId);
        return (
          '<div class="line"><div class="line-viz">' +
          viz(p, color.id) +
          '</div><div><a href="#/product/' +
          p.id +
          '">' +
          esc(p.name) +
          '</a><span class="meta">' +
          esc(p.colors.length > 1 ? color.name + " · " : "") +
          esc(p.size) +
          '</span></div><strong class="line-sum">' +
          formatMoney(offerPrice(p)) +
          " " +
          esc(offerLabel(p)) +
          '</strong><button type="button" class="btn" data-action="add" data-id="' +
          p.id +
          '" data-qty="' +
          offerQty(p) +
          '" data-color="' +
          color.id +
          '">' + esc(t("product.cart")) + '</button><button type="button" class="icon-x" data-action="fav" data-id="' +
          p.id +
          '" data-color="' +
          color.id +
          '" aria-label="' + esc(t("product.unfav")) + '">×</button></div>'
        );
      })
      .join("");
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("fav.title"), t("fav.lede")) +
      (favs.length
        ? '<div class="sheet">' + lines + "</div>"
        : '<div class="empty"><p>' + esc(t("fav.empty")) + '</p><p><a class="btn" href="#/catalog">' + esc(t("fav.toCatalog")) + "</a></p></div>") +
      "</div></section>"
    );
  }

  function renderOrders() {
    const orders = loadOrders();
    const banner = state.order
      ? '<div class="banner"><h2>' + fill("orders.accepted", { n: state.order.n }) + "</h2><p>" +
        fill("orders.who", { name: state.order.name, phone: state.order.phone }) + "</p><p>" +
        fill(state.order.mailOk ? "orders.mailOk" : "orders.mail", { email: state.order.email }) +
        "</p>" +
        orderStagesHtml("Принят") +
        "</div>"
      : "";
    const list = orders
      .map((order) => {
        const rows = Array.isArray(order.lines)
          ? "<ul class=\"order-lines\">" +
            order.lines
              .map((line) => {
                return (
                  "<li>" +
                  esc(line.name) +
                  (line.color ? ", " + esc(line.color) : "") +
                  " — " +
                  formatQty(line.qty) +
                  " " +
                  esc(line.unit) +
                  "<b>" +
                  formatMoney(line.sum) +
                  "</b></li>"
                );
              })
              .join("") +
            "</ul>"
          : "<p>" + esc(order.summary || "") + "</p>";
        const status = order.status || t("orders.status");
        return (
          '<article class="sheet order"><div class="order-top"><h2>' +
          esc(order.n || t("orders.fallback")) +
          '</h2><span class="badge">' +
          esc(status) +
          "</span></div><p class=\"meta\">" +
          esc([formatWhen(order.at), order.name, order.phone, order.mail].filter(Boolean).join(" · ")) +
          "</p>" +
          (order.mail ? orderStagesHtml(status) : "") +
          rows +
          (order.total != null ? '<p class="product-sum">' + formatMoney(order.total) + "</p>" : "") +
          (order.comment ? '<p class="note">' + esc(order.comment) + "</p>" : "") +
          "</article>"
        );
      })
      .join("");
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("orders.title"), t("orders.lede")) +
      banner +
      (list ? '<div class="orders">' + list + "</div>" : '<div class="empty"><p>' + esc(t("orders.empty")) + '</p><p><a class="btn" href="#/cart">' + esc(t("orders.toCart")) + "</a></p></div>") +
      "</div></section>"
    );
  }

  function renderCompare() {
    const items = compare.map(productById).filter(Boolean);
    if (items.length < 2) {
      return (
        '<section class="page"><div class="wrap">' +
        pageHead("Сравнение", "Отметьте две или три позиции в каталоге. В таблице будут размер, морозостойкость и цена.") +
        '<p><a class="btn" href="#/catalog">Перейти в каталог</a></p></div></section>'
      );
    }
    const head = items
      .map(
        (p) =>
          '<th><a href="#/product/' +
          p.id +
          '">' +
          esc(p.name) +
          '</a><div><button type="button" class="btn btn-line paper-line compare-remove" data-action="compare" data-id="' +
          p.id +
          '">Убрать</button></div></th>'
      )
      .join("");
    const rows = [
      ["", (p) => photoHtml(p, p.colors[0].id)],
      ["Размер", (p) => esc(p.size)],
      ["Толщина", (p) => (p.thickness ? esc(String(p.thickness)) + " мм" : "—")],
      ["Морозостойкость", (p) => esc(p.frost || "—")],
      ["Цена", (p) => "<strong>" + formatMoney(p.price) + "/" + esc(p.unit) + "</strong>"],
      ["Дополнительно", (p) => esc(secondaryPrice(p) || "—")],
      ["Наличие", (p) => esc(p.stock)],
    ]
      .map((row) => {
        return "<tr><th>" + row[0] + "</th>" + items.map((p) => "<td>" + row[1](p) + "</td>").join("") + "</tr>";
      })
      .join("");
    return (
      '<section class="page"><div class="wrap">' +
      pageHead("Сравнение", "До трёх позиций: толщина, морозостойкость, цена за единицу и за штуку.") +
      '<div class="compare-wrap"><table class="compare"><thead><tr><th></th>' +
      head +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div></div></section>"
    );
  }

  function renderCompareDock() {
    let dock = document.getElementById("compare-dock");
    if (!dock) {
      dock = document.createElement("div");
      dock.id = "compare-dock";
      dock.className = "compare-dock";
      document.body.appendChild(dock);
    }
    if (!compare.length) {
      dock.hidden = true;
      dock.innerHTML = "";
      document.body.classList.remove("has-compare");
      return;
    }
    document.body.classList.add("has-compare");
    dock.hidden = false;
    const names = compare
      .map((id) => {
        const p = productById(id);
        return p ? esc(p.name) : "";
      })
      .filter(Boolean)
      .join(" · ");
    dock.innerHTML =
      "<span>" +
      names +
      '</span><a class="btn" href="#/compare">Сравнить ' +
      compare.length +
      '</a><button type="button" data-action="compare-clear">Очистить</button>';
  }

  function paintCompare() {
    document.querySelectorAll("[data-action=compare]").forEach((btn) => {
      if (btn.textContent === "Убрать") return;
      const on = compare.indexOf(btn.dataset.id) !== -1;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", String(on));
      if (btn.classList.contains("card-compare")) return;
      btn.textContent = on ? "В сравнении" : "Сравнить";
    });
    renderCompareDock();
  }

  function htmlFor(page, parts) {
    if (page === "catalog") return renderCatalog();
    if (page === "compare") return renderCompare();
    if (page === "product") return renderProduct(parts[1]);
    if (page === "calc") return renderCalc();
    if (page === "delivery") return renderDelivery();
    if (page === "contacts") return renderContacts();
    if (page === "cart") return renderCart();
    if (page === "fav") return renderFav();
    if (page === "orders") return renderOrders();
    if (page === "admin" && window.KDAdmin) return KDAdmin.html(parts);
    if (page === "home") return renderHome();
    return '<section class="page"><div class="wrap">' + pageHead(t("orders.missingTitle"), "") + '<p><a href="#/">' + esc(t("orders.missingHome")) + "</a></p></div></section>";
  }

  function syncProductSum() {
    const qtyInput = document.getElementById("qty");
    const out = document.getElementById("product-sum");
    if (!qtyInput || !out) return;
    const id = (parseRoute().parts || [])[1];
    const p = productById(id);
    if (!p) return;
    const qty = Number(qtyInput.value);
    out.textContent = qty > 0 ? formatMoney(p.price * qty) : formatMoney(0);
  }

  function paintCalcColors() {
    const p = productById(state.calc.productId);
    const field = document.getElementById("calc-color-field");
    const sel = document.getElementById("calc-color");
    if (!field || !sel || !p) return;
    if (!p.colors.some((c) => c.id === state.calc.colorId)) state.calc.colorId = p.colors[0].id;
    field.hidden = p.colors.length < 2;
    sel.innerHTML = p.colors
      .map(
        (c) =>
          '<option value="' +
          c.id +
          '" data-hex="' +
          safeHex(c.hex) +
          '"' +
          (c.id === state.calc.colorId ? " selected" : "") +
          ">" +
          esc(c.name) +
          "</option>"
      )
      .join("");
    const label = document.getElementById("amount-label");
    if (label) label.textContent = p.inputLabel;
    const extra = document.getElementById("paving-extra");
    if (extra) extra.hidden = p.category !== "tile";
  }

  function syncEstimate() {
    const box = document.getElementById("estimate");
    if (!box) return;
    box.innerHTML = layingSvg(state.calc) + estimateHtml(buildEstimate(state.calc));
  }

  function syncProjectMetrics() {
    const main = document.getElementById("calc-result-main");
    const sub = document.getElementById("calc-result-sub");
    if (!main || !sub) return;
    main.textContent = formatQty(projectAmount(state.calc)) + " м²";
    if (state.calc.project === "yard") {
      sub.textContent = "Бордюр по периметру: " + formatQty(projectBorderMeters(state.calc)) + " м";
    } else {
      sub.textContent =
        "Периметр: " + formatQty(2 * (Number(state.calc.houseLength) + Number(state.calc.houseWidth))) + " м";
    }
  }

  function readCalc() {
    const g = (id) => document.getElementById(id);
    if (!g("calc-product")) return;
    state.calc.productId = g("calc-product").value;
    if (g("calc-color") && !g("calc-color-field").hidden) state.calc.colorId = g("calc-color").value;
    if (g("calc-amount")) state.calc.amount = g("calc-amount").value;
    if (g("calc-yard-length")) state.calc.yardLength = g("calc-yard-length").value;
    if (g("calc-yard-width")) state.calc.yardWidth = g("calc-yard-width").value;
    if (g("calc-house-length")) state.calc.houseLength = g("calc-house-length").value;
    if (g("calc-house-width")) state.calc.houseWidth = g("calc-house-width").value;
    if (g("calc-house-height")) state.calc.houseHeight = g("calc-house-height").value;
    if (g("calc-house-openings")) state.calc.houseOpenings = g("calc-house-openings").value;
    state.calc.reserve = Number(g("calc-reserve").value);
    if (g("calc-border")) state.calc.borderId = g("calc-border").value;
    if (g("calc-border-m")) state.calc.borderMeters = g("calc-border-m").value;
    if (g("calc-base")) state.calc.withBase = g("calc-base").checked;
    if (g("calc-delivery")) state.calc.delivery = g("calc-delivery").value;
    state.calc.amount = projectAmount(state.calc);
    if (state.calc.project === "yard") state.calc.borderMeters = projectBorderMeters(state.calc);
  }

  function hookCalc() {
    const form = document.getElementById("calc-form");
    if (!form) return;
    form.querySelectorAll("[data-picker] select").forEach(mountPicker);
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("click", (e) => {
      const opt = e.target.closest("[data-picker-value]");
      if (opt) {
        e.preventDefault();
        const picker = opt.closest("[data-picker]");
        const select = picker.querySelector("select");
        select.value = opt.dataset.pickerValue;
        closePicker(picker);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      const toggle = e.target.closest(".picker-btn");
      if (!toggle || !form.contains(toggle)) return;
      e.preventDefault();
      const picker = toggle.closest("[data-picker]");
      const willOpen = !picker.classList.contains("is-open");
      document.querySelectorAll("[data-picker].is-open").forEach(closePicker);
      if (!willOpen) return;
      picker.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      const menu = picker.querySelector(".picker-menu");
      if (menu) {
        menu.hidden = false;
        menu.classList.remove("is-up");
        const below = window.innerHeight - toggle.getBoundingClientRect().bottom;
        const above = toggle.getBoundingClientRect().top;
        const need = Math.min(menu.scrollHeight, 280) + 16;
        if (below < need && above > below) menu.classList.add("is-up");
      }
    });
    form.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      form.querySelectorAll("[data-picker].is-open").forEach(closePicker);
    });
    form.addEventListener("input", () => {
      readCalc();
      syncProjectMetrics();
      syncEstimate();
    });
    form.addEventListener("change", () => {
      readCalc();
      paintCalcColors();
      form.querySelectorAll("[data-picker] select").forEach(mountPicker);
      syncProjectMetrics();
      syncEstimate();
    });
  }

  function hookPromo() {
    clearInterval(promoTimer);
    promoTimer = 0;
    const stage = document.querySelector("[data-promo]");
    if (!stage) return;
    const track = stage.querySelector(".promo-track");
    const slides = [...track.children];
    if (slides.length < 2) return;
    let index = 0;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let tracking = false;
    let dragged = false;
    let swallow = false;

    function show(n) {
      index = (n + slides.length) % slides.length;
      track.classList.add("is-moving");
      track.style.transform = "translateX(" + -index * 100 + "%)";
      clearTimeout(track._moveTimer);
      track._moveTimer = setTimeout(() => track.classList.remove("is-moving"), 480);
      slides.forEach((slide, i) => {
        slide.inert = i !== index;
      });
      stage.querySelectorAll("[data-promo-go]").forEach((dot, i) => {
        const on = i === index;
        dot.classList.toggle("is-on", on);
        dot.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    function arm() {
      clearInterval(promoTimer);
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      promoTimer = setInterval(() => show(index + 1), 4500);
    }

    stage.querySelectorAll("[data-promo-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        show(index + Number(btn.dataset.promoDir));
        arm();
      });
    });
    stage.querySelectorAll("[data-promo-go]").forEach((dot) => {
      dot.addEventListener("click", () => {
        show(Number(dot.dataset.promoGo));
        arm();
      });
    });
    const viewport = stage.querySelector(".promo-viewport");
    viewport.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".promo-arrow")) return;
      tracking = true;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!tracking) return;
      dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        dragged = true;
        viewport.setPointerCapture(e.pointerId);
      }
    });
    function endSwipe() {
      if (!tracking) return;
      tracking = false;
      if (dragged && Math.abs(dx) > 48) {
        show(index + (dx < 0 ? 1 : -1));
        swallow = true;
        arm();
      }
      dragged = false;
    }
    viewport.addEventListener("pointerup", endSwipe);
    viewport.addEventListener("pointercancel", endSwipe);
    viewport.addEventListener(
      "click",
      (e) => {
        if (!swallow) return;
        e.preventDefault();
        e.stopPropagation();
        swallow = false;
      },
      true
    );
    if (promoWatch) document.removeEventListener("visibilitychange", promoWatch);
    promoWatch = () => {
      if (document.hidden) {
        clearInterval(promoTimer);
        promoTimer = 0;
      } else if (document.querySelector("[data-promo]") === stage) arm();
    };
    document.addEventListener("visibilitychange", promoWatch);
    show(0);
    arm();
  }

  function hookPage() {
    const q = document.getElementById("q");
    if (q) {
      let searchFrame = 0;
      q.addEventListener("input", () => {
        if (searchFrame) return;
        searchFrame = requestAnimationFrame(() => {
          searchFrame = 0;
          if (!q.isConnected) return;
          state.q = q.value;
          fillGrid();
        });
      });
    }
    [
      ["f-color", "color"],
      ["f-thick", "thick"],
      ["f-sort", "sort"],
    ].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        state[key] = el.value;
        fillGrid();
      });
    });
    if (document.getElementById("grid")) fillGrid();
    hookCalc();
    const qty = document.getElementById("qty");
    if (qty) qty.addEventListener("input", syncProductSum);
    const yard = document.getElementById("yard");
    if (yard) {
      yard.querySelectorAll("[data-yard]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.classList.contains("is-on")) return;
          yard.querySelectorAll("[data-yard]").forEach((b) => {
            const on = b === btn;
            b.classList.toggle("is-on", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
          });
          mountYard(yard, btn.dataset.yard);
        });
      });
      mountYard(yard, "tile");
    }
    bindModelSpins(document.getElementById("view"));
    hookBuyBar();
    renderCompareDock();
    hookPromo();
    if (document.body.classList.contains("is-admin") && window.KDAdmin) KDAdmin.hook(document.getElementById("view"));
  }

  function hookBuyBar() {
    const bar = document.getElementById("buy-bar");
    const anchor = document.querySelector(".qty-row [data-action=add-qty]");
    if (buyBarWatch) {
      buyBarWatch.disconnect();
      buyBarWatch = null;
    }
    document.body.classList.remove("has-buybar");
    if (!bar || !anchor) {
      if (bar) bar.hidden = true;
      return;
    }
    buyBarWatch = new IntersectionObserver(
      (entries) => {
        const visible = entries[0] && entries[0].isIntersecting;
        bar.hidden = !!visible;
        document.body.classList.toggle("has-buybar", !visible);
      },
      { threshold: 0.15 }
    );
    buyBarWatch.observe(anchor);
  }

  function updateChrome(page, parts) {
    document.querySelectorAll("a[data-page]").forEach((a) => {
      const on = a.dataset.page === page || (page === "product" && a.dataset.page === "catalog");
      a.classList.toggle("is-on", on);
    });
    const badge = document.getElementById("cart-count");
    if (badge) badge.textContent = String(cart.length);
    const favBadge = document.getElementById("fav-count");
    if (favBadge) favBadge.textContent = String(favs.length);
    const orderBadge = document.getElementById("order-count");
    if (orderBadge) orderBadge.textContent = String(loadOrders().length);
    const titles = {
      home: t("chrome.logo") + " — " + t("chrome.titleTail"),
      catalog: t("catalog.title") + " — " + t("chrome.logo"),
      compare: "Сравнение — " + t("chrome.logo"),
      calc: t("calc.title") + " — " + t("chrome.logo"),
      delivery: t("delivery.title") + " — " + t("chrome.logo"),
      contacts: t("contacts.title") + " — " + t("chrome.logo"),
      cart: t("cart.title") + " — " + t("chrome.logo"),
      fav: t("fav.title") + " — " + t("chrome.logo"),
      orders: t("orders.title") + " — " + t("chrome.logo"),
      admin: "Админпанель — " + t("chrome.logo"),
    };
    if (page === "product") {
      const p = productById(parts[1]);
      document.title = p ? p.name + " — " + t("chrome.logo") : t("chrome.logo");
    } else document.title = titles[page] || t("chrome.logo");
    paintThemeToggle();
  }

  function themeIsDark() {
    return document.documentElement.dataset.theme === "dark";
  }

  function paintThemeToggle() {
    const btn = document.querySelector("[data-action=theme]");
    if (!btn) return;
    const dark = themeIsDark();
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.setAttribute("aria-label", dark ? t("chrome.themeLight") : t("chrome.themeDark"));
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.content = dark ? "dark" : "light";
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = dark ? "#141210" : "#1b1916";
  }

  function applyTheme(dark) {
    const root = document.documentElement;
    if (dark) root.dataset.theme = "dark";
    else delete root.dataset.theme;
    try {
      localStorage.setItem("kd-theme", dark ? "dark" : "light");
    } catch (e) {}
    paintThemeToggle();
  }

  let themeVt = null;
  function toggleTheme(event, btn) {
    if (themeVt) return;
    const goingDark = !themeIsDark();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const run = () => applyTheme(goingDark);
    if (reduce || typeof document.startViewTransition !== "function") {
      run();
      return;
    }
    const rect = btn.getBoundingClientRect();
    const x = event.clientX || rect.left + rect.width / 2;
    const y = event.clientY || rect.top + rect.height / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;
    root.dataset.themeVt = goingDark ? "to-dark" : "to-light";
    const transition = document.startViewTransition(run);
    themeVt = transition;
    transition.ready.then(() => {
      const clip = ["circle(0px at " + x + "px " + y + "px)", "circle(" + endRadius + "px at " + x + "px " + y + "px)"];
      root.animate(
        { clipPath: goingDark ? clip : clip.slice().reverse() },
        {
          duration: 900,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "both",
          pseudoElement: goingDark ? "::view-transition-new(root)" : "::view-transition-old(root)",
        }
      );
    });
    const done = () => {
      themeVt = null;
      delete root.dataset.themeVt;
    };
    transition.finished.then(done, done);
  }

  function findLine(id, colorId) {
    return cart.find((i) => i.id === id && i.colorId === colorId);
  }

  function addToCart(id, colorId, qtyToAdd, opts) {
    opts = opts || {};
    const product = productById(id);
    if (!product) return;
    const color = colorId || product.colors[0].id;
    const existing = findLine(id, color);
    const delta = qtyToAdd == null ? (existing ? product.step : product.defaultQty) : Number(qtyToAdd);
    if (existing) {
      existing.qty = roundQty(existing.qty + delta);
      if (existing.qty <= 0) cart = cart.filter((i) => i !== existing);
    } else if (delta > 0) {
      cart.push({ id: id, colorId: color, qty: roundQty(delta) });
    }
    saveCart();
    updateChrome(parseRoute().parts[0] || "home", parseRoute().parts);
    if (!opts.silent) toast(product.name + " " + t("cart.inCart"));
    if ((parseRoute().parts[0] || "") === "cart") render({ scroll: false });
  }

  function parseTypedQty(value) {
    return Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  }

  function paintTypedQty(input) {
    const product = productById(input.dataset.id);
    const qty = parseTypedQty(input.value);
    if (!product || !(qty > 0)) return;
    const row = input.closest(".line");
    const sum = row && row.querySelector(".line-sum");
    if (sum) sum.textContent = formatMoney(product.price * qty);
    const inputs = document.querySelectorAll("[data-qty-input]");
    let total = 0;
    for (const el of inputs) {
      const item = productById(el.dataset.id);
      const amount = parseTypedQty(el.value);
      if (!item || !(amount > 0)) return;
      total += Math.round(item.price * amount);
    }
    const totalEl = document.querySelector(".summary .product-sum");
    if (totalEl) totalEl.textContent = formatMoney(total);
  }

  function commitTypedQty(input) {
    const product = productById(input.dataset.id);
    const line = findLine(input.dataset.id, input.dataset.color);
    if (!product || !line) return;
    const raw = parseTypedQty(input.value);
    if (!isFinite(raw)) {
      input.value = String(line.qty);
      paintTypedQty(input);
      return;
    }
    const qty = roundQty(raw);
    if (!(qty > 0)) {
      cart = cart.filter((item) => item !== line);
      saveCart();
      updateChrome(parseRoute().parts[0] || "home", parseRoute().parts);
      render({ scroll: false });
      return;
    }
    line.qty = qty;
    saveCart();
    input.value = String(qty);
    paintTypedQty(input);
  }

  function setCartQty(id, colorId, qty) {
    const product = productById(id);
    if (!product) return;
    const color = colorId || product.colors[0].id;
    const existing = findLine(id, color);
    if (qty <= 0) {
      cart = cart.filter((i) => !(i.id === id && i.colorId === color));
    } else if (existing) existing.qty = roundQty(qty);
    else cart.push({ id: id, colorId: color, qty: roundQty(qty) });
    saveCart();
  }

  function openCallback() {
    const modal = document.getElementById("callback");
    const form = document.getElementById("callback-form");
    const thanks = document.getElementById("callback-thanks");
    modal.hidden = false;
    form.hidden = false;
    thanks.hidden = true;
    form.reset();
    const err = form.querySelector(".form-error");
    if (err) err.hidden = true;
    document.body.classList.add("locked");
    const burger = document.querySelector(".burger");
    if (burger) burger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
    const input = form.querySelector("input");
    if (input) input.focus();
  }

  function closeCallback() {
    const callback = document.getElementById("callback");
    if (callback) callback.hidden = true;
    document.body.classList.remove("locked");
  }

  function leadText(name, phone, comment, lines) {
    return ["Имя: " + name, "Телефон: " + phone, comment ? "Комментарий: " + comment : "", lines ? "Состав: " + lines : ""]
      .filter(Boolean)
      .join("\n");
  }

  function showFormError(form, text) {
    const err = form.querySelector(".form-error");
    if (!err) return;
    err.hidden = false;
    err.textContent = text;
  }

  function submitOrder(form) {
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const comment = form.comment.value.trim();
    const mail = form.mail.value.trim();
    if (name.length < 2) return showFormError(form, t("cart.errName"));
    if (!validPhone(phone)) return showFormError(form, t("cart.errPhone"));
    if (!validMail(mail)) return showFormError(form, t("cart.errEmail"));
    if (!cart.length) return showFormError(form, t("cart.errEmpty"));
    const err = form.querySelector(".form-error");
    if (err) err.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = t("cart.sending");
    }
    const lines = cart.map((line) => {
      const p = productById(line.id);
      const c = colorObj(p, line.colorId);
      return {
        id: p.id,
        name: p.name,
        color: p.colors.length > 1 ? c.name : "",
        qty: line.qty,
        unit: p.unit,
        sum: Math.round(p.price * line.qty),
      };
    });
    const summary = lines
      .map((line) => line.name + (line.color ? " (" + line.color + ")" : "") + " — " + formatQty(line.qty) + " " + line.unit)
      .join("; ");
    const total = cartTotal();
    const n = "КД-" + String(Date.now()).slice(-6);
    const lead = {
      kind: "order",
      n: n,
      name: name,
      phone: phone,
      mail: mail,
      comment: comment,
      summary: summary,
      lines: lines,
      total: total,
      status: "Принят",
      at: new Date().toISOString(),
    };
    rememberLead(lead).then(function (saved) {
      state.order = {
        n: n,
        name: name,
        phone: phone,
        email: mail,
        summary: summary,
        mailOk: orderMailOk(saved, "Принят"),
      };
      cart = [];
      saveCart();
      location.hash = "#/orders";
    });
  }

  function submitSimple(form, boxId) {
    const name = form.name.value.trim();
    const phone = form.phone.value.trim();
    const comment = form.comment.value.trim();
    if (name.length < 2) return showFormError(form, t("cart.errName"));
    if (!validPhone(phone)) return showFormError(form, t("cart.errPhone"));
    const n = "КД-" + String(Date.now()).slice(-6);
    const body = leadText(name, phone, comment, "");
    const mailed = openMail("Звонок " + n + " с сайта", body);
    rememberLead({ n: n, name: name, phone: phone, comment: comment, at: new Date().toISOString() });
    const box = document.getElementById(boxId);
    const target = box || form.parentElement;
    target.innerHTML =
      '<div class="banner"><h2>' + fill("contacts.savedTitle", { n: n }) + "</h2><p>" +
      fill("contacts.savedWho", { name: name, phone: phone }) + "</p><p>" +
      (mailed ? esc(t("contacts.savedMail")) : fill("contacts.savedCall", { phone: SITE.phone })) +
      "</p></div>";
  }

  function render(opts) {
    const { parts, query } = parseRoute();
    const allowed = ["all", "tile", "block", "border", "bulk"];
    if (query.get("cat") && allowed.indexOf(query.get("cat")) !== -1) state.cat = query.get("cat");
    const page = parts[0] || "home";
    if (page !== "orders") state.order = null;
    const known = ["home", "catalog", "product", "calc", "compare", "delivery", "contacts", "cart", "fav", "orders", "admin"];
    const view = document.getElementById("view");
    document.body.classList.toggle("is-admin", page === "admin");
    view.innerHTML = htmlFor(known.indexOf(page) === -1 ? "missing" : page, parts);
    renderFooter();
    fillSite();
    hookPage();
    updateChrome(page, parts);
    if (!opts || opts.scroll !== false) window.scrollTo(0, 0);
  }

  function hookGlobal() {
    document.addEventListener("click", (e) => {
      const currentFilterMenu = e.target.closest("[data-filter-menu]");
      document.querySelectorAll("[data-filter-menu][open]").forEach((menu) => {
        if (menu !== currentFilterMenu) menu.removeAttribute("open");
      });
      const currentPicker = e.target.closest("[data-picker]");
      document.querySelectorAll("[data-picker].is-open").forEach((picker) => {
        if (picker !== currentPicker) closePicker(picker);
      });
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "theme") {
        toggleTheme(e, btn);
      } else if (action === "menu") {
        const open = document.body.classList.toggle("nav-open");
        btn.setAttribute("aria-expanded", String(open));
      } else if (action === "calc-pattern") {
        readCalc();
        state.calc.pattern = btn.dataset.pattern === "diagonal" ? "diagonal" : "straight";
        if (state.calc.pattern === "diagonal" && Number(state.calc.reserve) < 15) state.calc.reserve = 15;
        const root = document.getElementById("calc-root");
        if (root) {
          root.innerHTML = renderCalcBody();
          hookCalc();
        }
      } else if (action === "calc-project") {
        readCalc();
        setCalcProject(btn.dataset.project);
        const root = document.getElementById("calc-root");
        if (root) {
          root.innerHTML = renderCalcBody();
          hookCalc();
        }
      } else if (action === "callback") {
        openCallback();
      } else if (action === "close-modal") {
        closeCallback();
      } else if (action === "set-filter") {
        const key = btn.dataset.filter;
        if (["color", "thick", "sort"].indexOf(key) === -1) return;
        state[key] = btn.dataset.value;
        paintFilterMenu(key, state[key]);
        const menu = btn.closest("[data-filter-menu]");
        if (menu) menu.removeAttribute("open");
        fillGrid();
        animateCatalogFilter();
      } else if (action === "set-cat") {
        state.cat = btn.dataset.cat;
        if (state.cat !== "all" && state.cat !== "tile") state.thick = "all";
        const thick = document.getElementById("f-thick");
        if (thick) thick.value = state.thick;
        document.querySelectorAll("[data-action=set-cat]").forEach((chip) => {
          const on = chip === btn;
          chip.classList.toggle("is-on", on);
          chip.setAttribute("aria-pressed", String(on));
        });
        history.replaceState(null, "", "#/catalog?cat=" + encodeURIComponent(state.cat));
        paintFilterMenu("thick", state.thick);
        fillGrid();
        animateCatalogFilter();
      } else if (action === "reset-filters") {
        state.cat = "all";
        state.color = "all";
        state.thick = "all";
        state.sort = "pop";
        state.q = "";
        history.replaceState(null, "", "#/catalog");
        render({ scroll: false });
      } else if (action === "pick-color") {
        const root = btn.closest("[data-color-scope]") || btn.closest(".card");
        root.querySelectorAll(".dot").forEach((d) => d.classList.toggle("is-on", d === btn));
        root.querySelectorAll("[data-action=add], [data-action=add-qty], [data-action=buy], [data-action=fav], [data-action=open-calc]").forEach((add) => {
          add.dataset.color = btn.dataset.color;
        });
        root.querySelectorAll("[data-action=fav]").forEach(paintFav);
        const media = root.querySelector("[data-media]");
        const product = productById(btn.dataset.id);
        if (media && product) showMedia(media, product, btn.dataset.color);
        const picked = product ? colorObj(product, btn.dataset.color) : null;
        const colorName = root.querySelector(".color-name");
        if (colorName && picked) colorName.textContent = picked.name;
        const barMeta = document.getElementById("buy-bar-meta");
        if (barMeta && product && picked && root.contains(barMeta)) {
          barMeta.textContent = picked.name + " · " + formatMoney(product.price) + "/" + product.unit;
        }
        const lay = document.getElementById("product-lay");
        if (lay && product && lay.dataset.id === product.id && product.category === "tile") {
          const figure = lay.querySelector(".lay-scheme");
          const patternBtn = lay.querySelector("[data-action=lay-pattern].is-on");
          if (figure) {
            figure.outerHTML = layingSvg({
              project: "yard",
              productId: product.id,
              colorId: btn.dataset.color,
              yardLength: 6,
              yardWidth: 4,
              pattern: patternBtn && patternBtn.dataset.pattern === "diagonal" ? "diagonal" : "straight",
            });
          }
        }
      } else if (action === "lay-pattern") {
        const lay = document.getElementById("product-lay");
        const product = lay && productById(lay.dataset.id);
        if (!lay || !product) return;
        lay.querySelectorAll("[data-action=lay-pattern]").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-pressed", String(on));
        });
        const media = document.querySelector(".product [data-media]");
        const figure = lay.querySelector(".lay-scheme");
        if (figure) {
          figure.outerHTML = layingSvg({
            project: "yard",
            productId: product.id,
            colorId: (media && media.dataset.color) || product.colors[0].id,
            yardLength: 6,
            yardWidth: 4,
            pattern: btn.dataset.pattern === "diagonal" ? "diagonal" : "straight",
          });
        }
      } else if (action === "set-view") {
        const frame = btn.closest(".media-frame");
        const media = frame && frame.querySelector("[data-media]");
        const product = media && productById(media.dataset.id);
        if (!media || !product || media.dataset.view === btn.dataset.view) return;
        media.dataset.view = btn.dataset.view;
        frame.querySelectorAll("[data-action=set-view]").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-pressed", String(on));
        });
        showMedia(media, product);
      } else if (action === "add") {
        const qty = btn.dataset.qty === undefined || btn.dataset.qty === "" ? null : Number(btn.dataset.qty);
        addToCart(btn.dataset.id, btn.dataset.color, qty);
      } else if (action === "buy") {
        const bought = productById(btn.dataset.id);
        addToCart(btn.dataset.id, btn.dataset.color, bought ? offerQty(bought) : 1, { silent: true });
        location.hash = "#/cart";
      } else if (action === "open-calc") {
        e.preventDefault();
        const tile = productById(btn.dataset.id);
        if (tile) {
          state.calc.project = "yard";
          state.calc.productId = tile.id;
          state.calc.colorId = btn.dataset.color || tile.colors[0].id;
          state.calc.borderId = borderForTile(tile).id;
          state.calc.withBase = true;
          if (btn.dataset.kit === "yard") {
            state.calc.yardLength = 8;
            state.calc.yardWidth = 5;
            state.calc.reserve = 5;
            state.calc.pattern = "straight";
          }
          state.calc.amount = projectAmount(state.calc);
          state.calc.borderMeters = projectBorderMeters(state.calc);
        }
        location.hash = "#/calc";
      } else if (action === "add-qty") {
        const product = productById(btn.dataset.id);
        if (!product) return;
        addToCart(product.id, btn.dataset.color, offerQty(product));
      } else if (action === "inc" || action === "dec") {
        const product = productById(btn.dataset.id);
        const dir = action === "inc" ? 1 : -1;
        addToCart(btn.dataset.id, btn.dataset.color, dir * product.step, { silent: true });
      } else if (action === "remove") {
        cart = cart.filter((i) => !(i.id === btn.dataset.id && i.colorId === btn.dataset.color));
        saveCart();
        render({ scroll: false });
      } else if (action === "clear-cart") {
        cart = [];
        saveCart();
        render({ scroll: false });
      } else if (action === "add-estimate") {
        readCalc();
        const est = buildEstimate(state.calc);
        if (!est || est.empty) return;
        est.lines.forEach((line) => {
          if (line.cart) setCartQty(line.cart.id, line.cart.colorId, line.cart.qty);
        });
        updateChrome(parseRoute().parts[0] || "home", parseRoute().parts);
        toast(t("calc.added"));
      } else if (action === "compare") {
        const id = btn.dataset.id;
        const product = productById(id);
        if (!product) return;
        const index = compare.indexOf(id);
        if (index !== -1) compare.splice(index, 1);
        else if (compare.length >= 3) {
          toast("В сравнении уже три позиции");
          return;
        } else compare.push(id);
        saveCompare();
        if ((parseRoute().parts[0] || "") === "compare") render({ scroll: false });
        else paintCompare();
      } else if (action === "compare-clear") {
        compare = [];
        saveCompare();
        if ((parseRoute().parts[0] || "") === "compare") render({ scroll: false });
        else paintCompare();
      } else if (action === "fav") {
        const product = productById(btn.dataset.id);
        if (!product) return;
        const color = btn.dataset.color || product.colors[0].id;
        if (findFav(product.id, color)) {
          favs = favs.filter((i) => !(i.id === product.id && i.colorId === color));
          toast(product.name + " " + t("fav.removed"));
        } else {
          favs.push({ id: product.id, colorId: color });
          toast(product.name + " " + t("fav.added"));
        }
        saveFavs();
        updateChrome(parseRoute().parts[0] || "home", parseRoute().parts);
        if ((parseRoute().parts[0] || "") === "fav") render({ scroll: false });
        else document.querySelectorAll("[data-action=fav]").forEach(paintFav);
      }
    });

    document.addEventListener("submit", (e) => {
      if (e.target.id === "checkout") {
        e.preventDefault();
        submitOrder(e.target);
      } else if (e.target.id === "contact-form") {
        e.preventDefault();
        submitSimple(e.target, "contact-box");
      } else if (e.target.id === "callback-form") {
        e.preventDefault();
        const form = e.target;
        const name = form.name.value.trim();
        const phone = form.phone.value.trim();
        if (name.length < 2) return showFormError(form, t("cart.errName"));
        if (!validPhone(phone)) return showFormError(form, t("cart.errPhone"));
        const n = "КД-" + String(Date.now()).slice(-6);
        const mailed = openMail("Звонок " + n, leadText(name, phone, form.comment.value.trim(), ""));
        rememberLead({ n: n, name: name, phone: phone, comment: form.comment.value.trim(), at: new Date().toISOString() });
        form.hidden = true;
        const thanks = document.getElementById("callback-thanks");
        thanks.hidden = false;
        thanks.querySelector("p").textContent = mailed
          ? t("contacts.thanksMail")
          : raw("contacts.thanksCall", { phone: SITE.phone });
      } else if (e.target.id === "calc-form") {
        e.preventDefault();
      }
    });

    document.addEventListener("input", (e) => {
      if (e.target.matches && e.target.matches("[data-qty-input]")) paintTypedQty(e.target);
    });

    document.addEventListener("change", (e) => {
      if (e.target.matches && e.target.matches("[data-qty-input]")) commitTypedQty(e.target);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeCallback();
        document.body.classList.remove("nav-open");
      } else if (e.key === "Enter" && e.target.matches && e.target.matches("[data-qty-input]")) {
        e.preventDefault();
        e.target.blur();
      }
    });

    document.getElementById("nav").addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        document.body.classList.remove("nav-open");
        const burger = document.querySelector(".burger");
        if (burger) burger.setAttribute("aria-expanded", "false");
      }
    });

    window.addEventListener("hashchange", () => render());
  }

  function renderFooter() {
    document.getElementById("footer").innerHTML =
      '<div class="wrap foot-sheet"><div class="footer-grid"><div><h2>' +
      esc(t("chrome.logo")) +
      "</h2><p>" + lines("chrome.footerLead") + "</p></div>" +
      '<nav class="foot-nav" aria-label="Разделы">' +
      '<a href="#/catalog">' + esc(t("chrome.navCatalog")) + "</a>" +
      '<a href="#/calc">' + esc(t("chrome.navCalc")) + "</a>" +
      '<a href="#/delivery">' + esc(t("chrome.navDelivery")) + "</a>" +
      '<a href="#/contacts">' + esc(t("chrome.navContacts")) + "</a>" +
      '<a href="#/fav">' + esc(t("chrome.navFav")) + "</a>" +
      '<a href="#/orders">' + esc(t("chrome.navOrders")) + "</a>" +
      '<a href="#/cart">' + esc(t("chrome.navCart")) + "</a>" +
      "</nav>" +
      '<div class="foot-contact"><p><a data-fill-href="phoneHref" href="' +
      esc(SITE.phoneHref) +
      "\"><strong data-fill=\"phone\"></strong></a><br><span data-fill=\"hours\"></span><br><span data-fill=\"address\"></span></p></div></div>" +
      '<div class="fineprint">© ' +
      new Date().getFullYear() +
      " " +
      esc(t("chrome.logo")) +
      "</div></div>";
  }

  window.addEventListener("kd-photos", function () {
    render({ scroll: false });
  });

  window.addEventListener("kd-banner", function () {
    if (!document.body.classList.contains("is-admin")) render({ scroll: false });
  });

  window.addEventListener("kd-copy", function () {
    if (!document.body.classList.contains("is-admin")) render({ scroll: false });
    else {
      renderFooter();
      fillSite();
    }
  });

  function init() {
    cart = loadCart();
    favs = loadFavs();
    compare = loadCompare();
    renderFooter();
    fillSite();
    hookGlobal();
    render({ scroll: false });
  }

  init();
})();
