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
      productId: "kirpich-60",
      colorId: "gray",
      amount: 40,
      reserve: 5,
      borderId: "border-garden",
      borderMeters: 24,
      withBase: true,
      delivery: "city",
    },
  };

  let cart = [];
  let favs = [];

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

  function parseRoute() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const path = raw.split("?")[0];
    const parts = path.split("/").filter(Boolean);
    const query = new URLSearchParams(raw.split("?")[1] || "");
    return { parts, query };
  }

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem("kd-cart-v1") || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((i) => productById(i.id) && Number(i.qty) > 0)
        .map((i) => ({ id: i.id, colorId: i.colorId, qty: Number(i.qty) }));
    } catch (e) {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem("kd-cart-v1", JSON.stringify(cart));
  }

  function loadFavs() {
    try {
      const raw = JSON.parse(localStorage.getItem("kd-fav-v1") || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter((i) => productById(i.id)).map((i) => ({ id: i.id, colorId: i.colorId }));
    } catch (e) {
      return [];
    }
  }

  function saveFavs() {
    localStorage.setItem("kd-fav-v1", JSON.stringify(favs));
  }

  function findFav(id, colorId) {
    return favs.find((i) => i.id === id && i.colorId === colorId);
  }

  function loadOrders() {
    try {
      const all = JSON.parse(localStorage.getItem("kd-leads-v1") || "[]");
      if (!Array.isArray(all)) return [];
      return all.filter((item) => item && (item.kind === "order" || item.summary)).slice().reverse();
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

  function rememberLead(lead) {
    try {
      const all = JSON.parse(localStorage.getItem("kd-leads-v1") || "[]");
      all.push(lead);
      localStorage.setItem("kd-leads-v1", JSON.stringify(all));
    } catch (e) {
      /* хранилище может быть закрыто */
    }
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
      const a = L * 0.28;
      const b = W * 0.28;
      return [
        [-L / 2 + a, -W / 2],
        [L / 2 - a, -W / 2],
        [L / 2 - a, -W / 2 + b],
        [L / 2, -W / 2 + b],
        [L / 2, W / 2 - b],
        [L / 2 - a, W / 2 - b],
        [L / 2 - a, W / 2],
        [-L / 2 + a, W / 2],
        [-L / 2 + a, W / 2 - b],
        [-L / 2, W / 2 - b],
        [-L / 2, -W / 2 + b],
        [-L / 2 + a, -W / 2 + b],
      ];
    }

    function coilOutline(L, W) {
      const neck = W * 0.34;
      const shoulder = L * 0.22;
      return [
        [-L / 2, -W / 2],
        [-L / 2 + shoulder, -W / 2],
        [-L / 2 + shoulder, -neck / 2],
        [L / 2 - shoulder, -neck / 2],
        [L / 2 - shoulder, -W / 2],
        [L / 2, -W / 2],
        [L / 2, W / 2],
        [L / 2 - shoulder, W / 2],
        [L / 2 - shoulder, neck / 2],
        [-L / 2 + shoulder, neck / 2],
        [-L / 2 + shoulder, W / 2],
        [-L / 2, W / 2],
      ];
    }

    if (product.shape === "old") {
      const t = 33;
      const mix = color.id === "mix";
      boxes.push(
        { x: -58, y: -28, z: 0, l: 62, w: 40, h: t, color: mix ? "#8d8d86" : hex },
        { x: 8, y: -18, z: 0, l: 40, w: 40, h: t, color: mix ? "#6d4b34" : shade(hex, 0.92) },
        { x: -22, y: 16, z: 0, l: 36, w: 22, h: t, color: mix ? "#a89880" : shade(hex, 1.05) }
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
              : product.shape === "coil"
                ? coilOutline(L, W)
                : null;
        if (outline) prisms.push({ outline: outline, z: 0, h: H, color: hex });
        else boxes.push(base);
        dims = { l: mm.l + " мм", w: mm.w + " мм", h: mm.h + " мм", box: base };
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

    function redraw() {
      const svg = host.querySelector(".model");
      if (!svg) return;
      const product = productById(svg.getAttribute("data-model"));
      if (!product) return;
      const holder = document.createElement("div");
      holder.innerHTML = viz(product, svg.getAttribute("data-color"), host._modelYaw);
      if (holder.firstChild) svg.replaceWith(holder.firstChild);
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

  function viewSwitch() {
    return (
      '<div class="view-switch" role="group" aria-label="' + esc(t("product.view")) + '">' +
      '<button type="button" class="view-btn is-on" data-action="set-view" data-view="model" aria-pressed="true">' + esc(t("product.model")) + "</button>" +
      '<button type="button" class="view-btn" data-action="set-view" data-view="photo" aria-pressed="false">' + esc(t("product.photo")) + "</button>" +
      "</div>"
    );
  }

  function showMedia(media, product, colorId) {
    if (!media || !product) return;
    if (colorId) media.dataset.color = colorId;
    const color = media.dataset.color || product.colors[0].id;
    const badge = media.querySelector(".badge");
    if (media.dataset.view === "photo") {
      media.innerHTML =
        '<img class="photo" draggable="false" alt="' +
        esc(product.name) +
        ', ' + esc(t("product.texture")) + '" src="' +
        esc(window.KDAdmin && KDAdmin.photoSrc ? KDAdmin.photoSrc(product.id) : "img/" + product.id + ".jpg") +
        '"><span class="photo-note">' + esc(t("product.texture")) + "</span>";
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
    host._yardStop = () => {
      playing = false;
      cancelAnimationFrame(raf);
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
      draw(laidBoxes());
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
    return (
      '<button type="button" class="btn btn-line paper-line' +
      (on ? " is-on" : "") +
      '" data-action="fav" data-id="' +
      product.id +
      '" data-color="' +
      colorId +
      '" aria-pressed="' +
      on +
      '">' +
      (on ? esc(t("product.favOn")) : esc(t("product.fav"))) +
      "</button>"
    );
  }

  function paintFav(btn) {
    const on = !!findFav(btn.dataset.id, btn.dataset.color);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? t("product.favOn") : t("product.fav");
  }

  function cardHtml(p) {
    const color = p.colors[0];
    const second = secondaryPrice(p);
    const wait = p.stock !== "В наличии";
    return (
      '<article class="card" data-color-scope>' +
      '<div class="media-frame"><a class="card-media" draggable="false" href="#/product/' +
      p.id +
      '" data-media data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '" data-view="model">' +
      viz(p, color.id) +
      '<span class="badge' +
      (wait ? " badge-wait" : "") +
      '">' +
      esc(p.stock) +
      "</span></a>" +
      spinButtons() +
      viewSwitch() +
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
      '<p class="meta">' +
      esc(p.size) +
      " · " +
      esc(p.frost) +
      "</p>" +
      '<div class="dots">' +
      dotsHtml(p) +
      "</div>" +
      '<div class="price-row"><strong>' +
      formatMoney(p.price) +
      "<small>/" +
      esc(p.unit) +
      "</small></strong><span>" +
      esc(second) +
      "</span></div>" +
      '<button type="button" class="btn" data-action="add" data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '">' + esc(t("product.cart")) + "</button>" +
      favButton(p, color.id) +
      "</div></article>"
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
    const tileFrom = formatMoney(minPrice("tile"));
    const blockFrom = formatMoney(minPrice("block"));
    const borderFrom = formatMoney(minPrice("border"));
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
      .map((p) => cardHtml(p))
      .join("");
    const offers = [
      { product: plita, why: t("home.deal1") || ("На " + formatMoney(hit.price - plita.price) + " за м² дешевле «Старого города»") },
      { product: hollow, why: t("home.deal2") || ("На " + formatMoney(solid.price - hollow.price) + " за штуку дешевле полнотелого") },
      { product: garden, why: t("home.deal3") || ("На " + formatMoney(road.price - garden.price) + " за метр дешевле дорожного") },
      { product: sand, why: t("home.deal4") },
    ];
    function promoSide(product) {
      return (
        '<a class="promo-side" href="#/product/' +
        product.id +
        '" aria-label="' +
        esc(product.name) +
        '">' +
        viz(product, product.colors[0].id) +
        "</a>"
      );
    }
    const promo =
      '<div class="promo">' +
      promoSide(plita) +
      '<div class="promo-copy"><p class="promo-kicker">' + esc(t("home.promoKicker")) + "</p><h2>" + lines("home.promoTitle") + "</h2><p>" +
      fill("home.promoText", { tile: tileFrom, block: blockFrom, border: borderFrom }) +
      '</p><a class="btn promo-btn" href="#/catalog">' + esc(t("home.promoBtn")) + "</a></div>" +
      promoSide(hollow) +
      '<span class="promo-note">' + esc(t("home.promoNote")) + "</span></div>";
    const dealCards = offers
      .map((offer) => {
        const p = offer.product;
        if (!p || p.hidden) return "";
        const c = p.colors[0];
        return (
          '<article class="deal"><a class="deal-viz" href="#/product/' +
          p.id +
          '">' +
          viz(p, c.id) +
          '</a><p class="deal-why">' +
          esc(offer.why) +
          '</p><h3><a href="#/product/' +
          p.id +
          '">' +
          esc(p.name) +
          "</a></h3><strong>" +
          formatMoney(p.price) +
          "/" +
          esc(p.unit) +
          '</strong><button type="button" class="btn" data-action="add" data-id="' +
          p.id +
          '" data-color="' +
          c.id +
          '">' + esc(t("home.dealCart")) + "</button></article>"
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
      '<div class="hero-actions"><a class="btn" href="#/catalog">' + esc(t("home.btnCatalog")) + '</a><a class="btn btn-line" href="#/calc">' + esc(t("home.btnCalc")) + "</a></div>" +
      '<div class="stats"><div class="stat"><strong>' + fill("home.statTile", { tile: tileFrom }) + "</strong><span>" + esc(t("home.statTileNote")) + "</span></div>" +
      '<div class="stat"><strong>' + esc(t("home.statFrost")) + "</strong><span>" + esc(t("home.statFrostNote")) + "</span></div>" +
      '<div class="stat"><strong>' +
      PRODUCTS.length +
      "</strong><span>" +
      plural(PRODUCTS.length, "позиция", "позиции", "позиций") +
      " " + esc(t("home.statCountNote")) + "</span></div></div></div></div></section>" +
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

  function colorOptions() {
    const map = new Map();
    PRODUCTS.forEach((p) => p.colors.forEach((c) => map.set(c.id, c.name)));
    return (
      '<option value="all">' + esc(t("catalog.anyColor")) + "</option>" +
      Array.from(map.entries())
        .map(([id, name]) => '<option value="' + id + '"' + (state.color === id ? " selected" : "") + ">" + esc(name) + "</option>")
        .join("")
    );
  }

  function renderCatalog() {
    return (
      '<section class="page"><div class="wrap">' +
      pageHead(t("catalog.title"), t("catalog.lede")) +
      '<p class="legend"><span><b>50 мм</b> ' + esc(t("catalog.legend50")) + "</span><span><b>60 мм</b> " + esc(t("catalog.legend60")) + "</span><span><b>80 мм</b> " + esc(t("catalog.legend80")) + "</span></p>" +
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
      '<select id="f-color" aria-label="' + esc(t("catalog.colorLabel")) + '">' +
      colorOptions() +
      "</select>" +
      '<select id="f-thick" aria-label="' + esc(t("catalog.thickLabel")) + '">' +
      ["all", "50", "60", "80"]
        .map((v) => '<option value="' + v + '"' + (state.thick === v ? " selected" : "") + ">" + (v === "all" ? esc(t("catalog.anyThick")) : v + " мм") + "</option>")
        .join("") +
      "</select>" +
      '<select id="f-sort" aria-label="' + esc(t("catalog.sortLabel")) + '">' +
      '<option value="pop"' +
      (state.sort === "pop" ? " selected" : "") +
      ">" + esc(t("catalog.sortPop")) + "</option>" +
      '<option value="cheap"' +
      (state.sort === "cheap" ? " selected" : "") +
      ">" + esc(t("catalog.sortCheap")) + "</option>" +
      '<option value="dear"' +
      (state.sort === "dear" ? " selected" : "") +
      ">" + esc(t("catalog.sortDear")) + "</option></select>" +
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
      ? list.map(cardHtml).join("")
      : '<div class="empty"><p>' + esc(t("catalog.empty")) + '</p><button type="button" class="btn btn-ink" data-action="reset-filters">' + esc(t("catalog.reset")) + "</button></div>";
    bindModelSpins(grid);
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
      '<div class="product" data-color-scope><div class="media-frame"><div class="product-media" data-media data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '" data-view="model">' +
      viz(p, color.id) +
      "</div>" +
      spinButtons() +
      viewSwitch() +
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
      formatMoney(p.price * p.defaultQty) +
      "</p>" +
      '<div class="dots" style="margin-bottom:12px">' +
      dotsHtml(p) +
      "</div>" +
      '<div class="qty-row"><label class="field" style="margin:0"><span>' + esc(t("product.qty")) + ", " +
      esc(p.unit) +
      '</span><input id="qty" type="number" min="' +
      p.step +
      '" step="' +
      p.step +
      '" value="' +
      p.defaultQty +
      '"></label>' +
      '<button type="button" class="btn" data-action="add-qty" data-id="' +
      p.id +
      '" data-color="' +
      color.id +
      '">' + esc(t("product.cart")) + "</button>" +
      favButton(p, color.id) +
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
      "</tbody></table></div></div>" +
      withThisHtml(p) +
      (related.length
        ? '<div class="section-h"><h2>' + esc(t("product.related")) + "</h2></div><div class=\"grid\">" + related.map(cardHtml).join("") + "</div>"
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
            '">' +
            viz(item.product, c.id) +
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

  function buildEstimate(calc) {
    const p = productById(calc.productId);
    if (!p) return null;
    const amount = Number(calc.amount);
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
    if (p.category === "tile" && Number(calc.borderMeters) > 0) {
      const b = productById(calc.borderId);
      const bqty = Math.ceil(Number(calc.borderMeters));
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
    return { lines, goods, delivery, total: goods + delivery.price, product: p, note };
  }

  function detailFor(p, amount, reserve, qty) {
    const base = formatQty(amount) + " × запас " + reserve + "%";
    if (p.category === "tile") return base + " · " + Math.ceil(qty * p.pcsPerM2) + " шт";
    if (p.category === "block") return base + " · " + formatQty(amount) + " м² стены";
    return base;
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

  function renderCalcBody() {
    const calc = state.calc;
    const paving = PRODUCTS.filter((p) => !p.hidden && (p.category === "tile" || p.category === "block" || p.category === "border"));
    const groups = [
      [t("calc.groupTile"), "tile"],
      [t("calc.groupBlock"), "block"],
      [t("calc.groupBorder"), "border"],
    ];
    const options = groups
      .map(([label, cat]) => {
        const inner = paving
          .filter((p) => p.category === cat)
          .map((p) => '<option value="' + p.id + '"' + (p.id === calc.productId ? " selected" : "") + ">" + esc(p.name) + "</option>")
          .join("");
        return "<optgroup label=\"" + esc(label) + "\">" + inner + "</optgroup>";
      })
      .join("");
    const product = productById(calc.productId);
    const showPaving = product.category === "tile";
    return (
      '<form id="calc-form" class="calc-layout"><div class="sheet"><h2>' + esc(t("calc.inputs")) + "</h2>" +
      '<label class="field"><span>' + esc(t("calc.product")) + "</span><select id=\"calc-product\">" +
      options +
      "</select></label>" +
      '<label class="field" id="calc-color-field"' +
      (product.colors.length < 2 ? " hidden" : "") +
      '><span>' + esc(t("calc.color")) + "</span><select id=\"calc-color\">" +
      product.colors
        .map((c) => '<option value="' + c.id + '"' + (c.id === calc.colorId ? " selected" : "") + ">" + esc(c.name) + "</option>")
        .join("") +
      "</select></label>" +
      '<label class="field"><span id="amount-label">' +
      esc(product.inputLabel) +
      '</span><input id="calc-amount" type="number" min="0" step="0.1" value="' +
      calc.amount +
      '"></label>' +
      '<label class="field"><span>' + esc(t("calc.reserve")) + "</span><select id=\"calc-reserve\">" +
      [0, 5, 7, 10]
        .map((n) => '<option value="' + n + '"' + (Number(calc.reserve) === n ? " selected" : "") + ">" + n + "%</option>")
        .join("") +
      "</select></label>" +
      '<div id="paving-extra"' +
      (showPaving ? "" : " hidden") +
      ">" +
      '<label class="field"><span>' + esc(t("calc.border")) + "</span><select id=\"calc-border\">" +
      PRODUCTS.filter((p) => p.category === "border" && !p.hidden)
        .map((p) => '<option value="' + p.id + '"' + (p.id === calc.borderId ? " selected" : "") + ">" + esc(p.name) + " — " + formatMoney(p.price) + "</option>")
        .join("") +
      '</select></label><label class="field"><span>' + esc(t("calc.borderM")) + "</span><input id=\"calc-border-m\" type=\"number\" min=\"0\" step=\"1\" value=\"" +
      calc.borderMeters +
      '"></label>' +
      '<label class="check"><input id="calc-base" type="checkbox"' +
      (calc.withBase ? " checked" : "") +
      "> " + esc(t("calc.base")) + "</label></div>" +
      '<label class="field"><span>' + esc(t("calc.delivery")) + "</span><select id=\"calc-delivery\">" +
      SITE.delivery
        .map((d) => '<option value="' + d.id + '"' + (d.id === calc.delivery ? " selected" : "") + ">" + esc(d.name) + " — " + formatMoney(d.price) + "</option>")
        .join("") +
      "</select></label></div>" +
      '<div id="estimate">' +
      estimateHtml(buildEstimate(calc)) +
      "</div></form>"
    );
  }

  function renderCalc() {
    return '<section class="page"><div class="wrap">' + pageHead(t("calc.title"), t("calc.lede")) + renderCalcBody() + "</div></section>";
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
          '<label class="field"><span>' + esc(t("contacts.name")) + '</span><input name="name" autocomplete="name"></label>' +
          '<label class="field"><span>' + esc(t("contacts.phone")) + '</span><input name="phone" autocomplete="tel" inputmode="tel"></label>' +
          '<label class="field"><span>' + esc(t("cart.address")) + '</span><textarea name="comment"></textarea></label>' +
          '<p class="form-error" hidden></p><button class="btn" type="submit">' + esc(t("cart.submit")) + "</button>" +
          '<p class="note">' +
          esc(canEmail() ? t("cart.noteMail") : t("cart.noteCall")) +
          "</p></form></div></div>"
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
          formatMoney(p.price) +
          "/" +
          esc(p.unit) +
          '</strong><button type="button" class="btn" data-action="add" data-id="' +
          p.id +
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
        (state.order.mailed ? esc(t("orders.mail")) : fill("orders.call", { phone: SITE.phone })) +
        "</p></div>"
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
        return (
          '<article class="sheet order"><div class="order-top"><h2>' +
          esc(order.n || t("orders.fallback")) +
          '</h2><span class="badge">' +
          esc(order.status || t("orders.status")) +
          "</span></div><p class=\"meta\">" +
          esc([formatWhen(order.at), order.name, order.phone].filter(Boolean).join(" · ")) +
          "</p>" +
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

  function htmlFor(page, parts) {
    if (page === "catalog") return renderCatalog();
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
      .map((c) => '<option value="' + c.id + '"' + (c.id === state.calc.colorId ? " selected" : "") + ">" + esc(c.name) + "</option>")
      .join("");
    const label = document.getElementById("amount-label");
    if (label) label.textContent = p.inputLabel;
    const extra = document.getElementById("paving-extra");
    if (extra) extra.hidden = p.category !== "tile";
  }

  function syncEstimate() {
    const box = document.getElementById("estimate");
    if (!box) return;
    box.innerHTML = estimateHtml(buildEstimate(state.calc));
  }

  function readCalc() {
    const g = (id) => document.getElementById(id);
    if (!g("calc-product")) return;
    state.calc.productId = g("calc-product").value;
    if (g("calc-color") && !g("calc-color-field").hidden) state.calc.colorId = g("calc-color").value;
    state.calc.amount = g("calc-amount").value;
    state.calc.reserve = Number(g("calc-reserve").value);
    if (g("calc-border")) state.calc.borderId = g("calc-border").value;
    if (g("calc-border-m")) state.calc.borderMeters = g("calc-border-m").value;
    if (g("calc-base")) state.calc.withBase = g("calc-base").checked;
    if (g("calc-delivery")) state.calc.delivery = g("calc-delivery").value;
  }

  function hookCalc() {
    const form = document.getElementById("calc-form");
    if (!form) return;
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("input", () => {
      readCalc();
      syncEstimate();
    });
    form.addEventListener("change", () => {
      readCalc();
      paintCalcColors();
      syncEstimate();
    });
  }

  function hookPage() {
    const q = document.getElementById("q");
    if (q) {
      q.addEventListener("input", () => {
        state.q = q.value;
        fillGrid();
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
    if (document.body.classList.contains("is-admin") && window.KDAdmin) KDAdmin.hook(document.getElementById("view"));
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
    document.getElementById("callback").hidden = true;
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
    if (name.length < 2) return showFormError(form, t("cart.errName"));
    if (!validPhone(phone)) return showFormError(form, t("cart.errPhone"));
    if (!cart.length) return showFormError(form, t("cart.errEmpty"));
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
    const body = leadText(name, phone, comment, summary);
    rememberLead({
      kind: "order",
      n: n,
      name: name,
      phone: phone,
      comment: comment,
      summary: summary,
      lines: lines,
      total: total,
      status: "Принят",
      at: new Date().toISOString(),
    });
    const mailed = openMail("Заказ " + n + " с сайта", body);
    state.order = { n: n, name: name, phone: phone, summary: summary, mailed: mailed };
    cart = [];
    saveCart();
    location.hash = "#/orders";
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
    const known = ["home", "catalog", "product", "calc", "delivery", "contacts", "cart", "fav", "orders", "admin"];
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
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "menu") {
        const open = document.body.classList.toggle("nav-open");
        btn.setAttribute("aria-expanded", String(open));
      } else if (action === "callback") {
        openCallback();
      } else if (action === "close-modal") {
        closeCallback();
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
        fillGrid();
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
        root.querySelectorAll("[data-action=add], [data-action=add-qty], [data-action=fav]").forEach((add) => {
          add.dataset.color = btn.dataset.color;
        });
        root.querySelectorAll("[data-action=fav]").forEach(paintFav);
        const media = root.querySelector("[data-media]");
        const product = productById(btn.dataset.id);
        if (media && product) showMedia(media, product, btn.dataset.color);
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
      } else if (action === "open-calc") {
        e.preventDefault();
        const tile = productById(btn.dataset.id);
        if (tile) {
          state.calc.productId = tile.id;
          state.calc.colorId = tile.colors[0].id;
          state.calc.amount = tile.defaultQty;
          state.calc.borderId = borderForTile(tile).id;
          state.calc.withBase = true;
        }
        location.hash = "#/calc";
      } else if (action === "add-qty") {
        const qty = Number(document.getElementById("qty").value);
        if (!qty || qty <= 0) return;
        addToCart(btn.dataset.id, btn.dataset.color, qty);
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
      "<div><ul><li><a href=\"#/catalog\">" + esc(t("chrome.navCatalog")) + "</a></li><li><a href=\"#/fav\">" + esc(t("chrome.navFav")) + "</a></li><li><a href=\"#/orders\">" + esc(t("chrome.navOrders")) + "</a></li><li><a href=\"#/cart\">" + esc(t("chrome.navCart")) + "</a></li><li><a href=\"#/calc\">" + esc(t("chrome.navCalc")) + "</a></li><li><a href=\"#/delivery\">" + esc(t("chrome.navDelivery")) + "</a></li><li><a href=\"#/contacts\">" + esc(t("chrome.navContacts")) + "</a></li></ul></div>" +
      "<div><p><a data-fill-href=\"phoneHref\" href=\"" +
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
    renderFooter();
    fillSite();
    hookGlobal();
    render({ scroll: false });
  }

  init();
})();
