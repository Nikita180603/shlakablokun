/* Админка склада. Вход проверяет сервер, пароль в этот файл не входит. */
(function () {
  var PRODUCT_KEY = "kd-admin-products-v1";
  var SITE_KEY = "kd-admin-site-v1";
  var COPY_KEY = "kd-admin-copy-v1";
  var BANNER_KEY = "kd-admin-banner-v1";
  var sessionOk = false;
  var sessionUser = null;
  var photos = {};
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open("kd-admin", 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains("photos")) req.result.createObjectStore("photos");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function rememberPhoto(id, blob) {
    if (photos[id]) URL.revokeObjectURL(photos[id]);
    photos[id] = URL.createObjectURL(blob);
  }

  function runPhotoTx(id, op, blob) {
    return openDb().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("photos", "readwrite");
        var store = tx.objectStore("photos");
        if (op === "put") store.put(blob, id);
        else store.delete(id);
        tx.oncomplete = function () {
          if (op === "put") rememberPhoto(id, blob);
          else {
            if (photos[id]) URL.revokeObjectURL(photos[id]);
            delete photos[id];
          }
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function putPhoto(id, blob) { return runPhotoTx(id, "put", blob); }
  function deletePhoto(id) { return runPhotoTx(id, "delete"); }

  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1400;
        var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("photo"));
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("photo"));
      };
      img.src = url;
    });
  }

  function photoSrc(id) {
    if (photos[id]) return photos[id];
    var file = window.KD_ADMIN_FILE;
    if (file && Array.isArray(file.photos) && file.photos.indexOf(id) !== -1) return "img/custom/" + id + ".jpg";
    var product = (window.PRODUCTS || []).filter(function (p) { return p.id === id; })[0];
    if (product && product.custom) return "img/placeholder.svg";
    return "img/" + id + ".jpg";
  }

  function bannerSrc(slideId, productId) {
    var key = "banner-" + slideId;
    if (photos[key]) return photos[key];
    return photoSrc(productId);
  }

  openDb().then(function (database) {
    return new Promise(function (resolve) {
      var tx = database.transaction("photos", "readonly");
      var req = tx.objectStore("photos").openCursor();
      req.onsuccess = function () {
        var cursor = req.result;
        if (!cursor) return;
        if (cursor.value) rememberPhoto(cursor.key, cursor.value);
        cursor.continue();
      };
      tx.oncomplete = function () { resolve(Object.keys(photos).length); };
      tx.onerror = function () { resolve(0); };
    });
  }).then(function (count) {
    if (count) window.dispatchEvent(new Event("kd-photos"));
  }).catch(function () {});

  function read(key, fallback) {
    try {
      var raw = JSON.parse(localStorage.getItem(key) || "");
      return raw == null ? fallback : raw;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function stored(key, field) {
    var local = read(key, null);
    if (local != null) return local;
    var file = window.KD_ADMIN_FILE;
    if (!file || file[field] == null) return null;
    return file[field];
  }

  function fileBase() {
    var file = window.KD_ADMIN_FILE || {};
    return {
      products: file.products && typeof file.products === "object" ? file.products : {},
      site: file.site && typeof file.site === "object" ? file.site : null,
      copy: file.copy && typeof file.copy === "object" ? file.copy : {},
      banner: file.banner && typeof file.banner === "object" ? file.banner : null,
      photos: Array.isArray(file.photos) ? file.photos.slice() : [],
    };
  }

  function publish(part) {
    var store = fileBase();
    if (part) Object.keys(part).forEach(function (key) { store[key] = part[key]; });
    window.KD_ADMIN_FILE = store;
    return fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(store),
    }).then(function (res) {
      if (!res.ok) throw new Error("save");
      return true;
    });
  }

  function markSaved(note, ok) {
    if (!note) return;
    note.hidden = false;
    note.textContent = ok
      ? "Сохранено в файлы сайта. Обнови страницу витрины."
      : "Сохранено только в этом браузере. Открой сайт через локальный сервер, чтобы правка попала в файлы.";
  }

  function sendPhoto(id, blob) {
    return fetch("/api/admin-photo?id=" + encodeURIComponent(id), {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    }).then(function (res) {
      if (!res.ok) throw new Error("photo");
      var photosOnDisk = fileBase().photos;
      if (photosOnDisk.indexOf(id) === -1) photosOnDisk.push(id);
      return publish({ photos: photosOnDisk });
    });
  }

  function dropFilePhoto(id) {
    return fetch("/api/admin-photo?id=" + encodeURIComponent(id), { method: "DELETE" }).then(function (res) {
      if (!res.ok && res.status !== 404) throw new Error("photo");
      return publish({ photos: fileBase().photos.filter(function (item) { return item !== id; }) });
    });
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(Number(n) || 0)) + " ₽";
  }

  function when(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }

  function applyCopy() {
    var base = window.COPY_DEFAULTS || {};
    var patch = stored(COPY_KEY, "copy") || {};
    var live = {};
    Object.keys(base).forEach(function (key) { live[key] = base[key]; });
    if (patch && typeof patch === "object") {
      Object.keys(patch).forEach(function (key) {
        if (typeof patch[key] === "string" && Object.prototype.hasOwnProperty.call(base, key)) live[key] = patch[key];
      });
    }
    window.COPY = live;
    if (window.SITE) {
      if (live["chrome.logo"]) SITE.name = live["chrome.logo"];
      ["pickup", "city", "near"].forEach(function (id) {
        var row = (SITE.delivery || []).filter(function (item) { return item.id === id; })[0];
        if (!row) return;
        if (live["delivery." + id + ".name"]) row.name = live["delivery." + id + ".name"];
        if (live["delivery." + id + ".note"]) row.note = live["delivery." + id + ".note"];
      });
    }
  }

  function customProduct(id, patch) {
    var names = patch.colors && typeof patch.colors === "object" ? patch.colors : {};
    var colors = Object.keys(names).map(function (key) {
      return {
        id: key,
        name: names[key],
        hex: (patch.hex && patch.hex[key]) || "#8d8d86",
      };
    });
    if (!colors.length) colors.push({ id: "gray", name: "Серый", hex: "#8d8d86" });
    return {
      id: id,
      custom: true,
      category: patch.category || "tile",
      shape: patch.shape || (patch.category === "bulk" ? "sand" : "brick"),
      name: patch.name || id,
      size: patch.size || "",
      thickness: Number(patch.thickness) || 60,
      price: Number(patch.price) || 0,
      unit: patch.unit || "м²",
      step: 1,
      defaultQty: 10,
      pcsPerM2: Number(patch.pcsPerM2) || 1,
      piecesLabel: patch.piecesLabel || "",
      pallet: patch.pallet || "",
      mark: patch.mark || "",
      frost: patch.frost || "",
      standard: patch.standard || "",
      weight: patch.weight || "",
      usage: patch.usage || "",
      lead: patch.lead || "",
      inputLabel: patch.inputLabel || "Количество",
      stock: patch.stock || "В наличии",
      popular: !!patch.popular,
      hidden: !!patch.hidden,
      colors: colors,
    };
  }

  function patchProduct(product, patch) {
    if (patch.name) product.name = patch.name;
    if (patch.price != null && patch.price !== "") product.price = Number(patch.price) || 0;
    if (patch.stock) product.stock = patch.stock;
    if (patch.popular != null) product.popular = !!patch.popular;
    if (patch.hidden != null) product.hidden = !!patch.hidden;
    if (patch.category) product.category = patch.category;
    if (patch.unit) product.unit = patch.unit;
    if (patch.thickness != null && patch.thickness !== "") product.thickness = Number(patch.thickness) || 0;
    if (patch.pcsPerM2 != null && patch.pcsPerM2 !== "") product.pcsPerM2 = Number(patch.pcsPerM2) || 0;
    ["lead", "size", "piecesLabel", "pallet", "mark", "frost", "standard", "weight", "usage", "inputLabel"].forEach(function (key) {
      if (patch[key] != null) product[key] = patch[key];
    });
    if (patch.colors && typeof patch.colors === "object") {
      product.colors.forEach(function (color) {
        if (patch.colors[color.id]) color.name = patch.colors[color.id];
        if (patch.hex && patch.hex[color.id]) color.hex = patch.hex[color.id];
      });
    }
  }

  function applyOverrides() {
    applyCopy();
    if (!window.SITE || !window.PRODUCTS) return;
    var site = stored(SITE_KEY, "site");
    if (site && typeof site === "object") {
      if (site.phone) {
        SITE.phone = site.phone;
        var digits = String(site.phone).replace(/\D/g, "");
        if (digits) SITE.phoneHref = "tel:+" + digits;
      }
      if (site.hours) SITE.hours = site.hours;
      if (site.address) SITE.address = site.address;
      if (site.delivery && SITE.delivery) {
        SITE.delivery.forEach(function (row) {
          if (site.delivery[row.id] != null && site.delivery[row.id] !== "") {
            row.price = Number(site.delivery[row.id]) || 0;
          }
        });
      }
    }
    var patches = stored(PRODUCT_KEY, "products") || {};
    if (!patches || typeof patches !== "object") return;
    Object.keys(patches).forEach(function (id) {
      var patch = patches[id];
      if (!patch || typeof patch !== "object") return;
      var product = PRODUCTS.filter(function (item) { return item.id === id; })[0];
      if (product) {
        patchProduct(product, patch);
        return;
      }
      if (!patch.name || !patch.category) return;
      PRODUCTS.push(customProduct(id, patch));
    });
    for (var i = PRODUCTS.length - 1; i >= 0; i--) {
      if (PRODUCTS[i].custom && !patches[PRODUCTS[i].id]) PRODUCTS.splice(i, 1);
    }
  }

  function copyValue(key, fallback) {
    var live = window.COPY || {};
    return live[key] != null ? live[key] : fallback;
  }

  function defaultBanner() {
    return {
      slides: [
        {
          id: "offer",
          type: "offer",
          on: true,
          kicker: copyValue("home.promoKicker", "шок-цена"),
          title: copyValue("home.promoTitle", "самая дешевая плитка в ДНР"),
          text: copyValue("home.promoText", "метр плиты 400 дешевле «Старого города»"),
          btn: copyValue("home.promoBtn", "Забрать плиту"),
          note: copyValue("home.promoNote", "выгода {gap}/м²"),
          leftId: "plita-400",
          rightId: "block-hollow",
        },
        {
          id: "plita",
          type: "photo",
          on: true,
          productId: "plita-400",
          kicker: copyValue("home.slide2Kicker", "Плита на складе"),
          title: copyValue("home.slide2Title", "Плита\nтротуарная"),
          text: copyValue("home.slide2Text", "{price}/м² · {size}"),
          btn: copyValue("home.slide2Btn", "Купить"),
        },
        {
          id: "hollow",
          type: "photo",
          on: true,
          productId: "block-hollow",
          kicker: copyValue("home.slide3Kicker", "Блок на складе"),
          title: copyValue("home.slide3Title", "Шлакоблок\nпустотелый"),
          text: copyValue("home.slide3Text", "{price}/шт · {size}"),
          btn: copyValue("home.slide3Btn", "Купить"),
        },
      ],
    };
  }

  function bannerData() {
    var saved = stored(BANNER_KEY, "banner");
    if (!saved || !Array.isArray(saved.slides) || !saved.slides.length) return defaultBanner();
    return saved;
  }

  function undoQuietBanner(banner) {
    if (!banner || !Array.isArray(banner.slides)) return banner;
    var quiet = false;
    var slides = banner.slides.map(function (slide) {
      if (!slide || slide.type !== "offer") return slide;
      if (String(slide.kicker || "").trim() !== "Плита на складе") return slide;
      if (String(slide.text || "") !== "{price} за 1 м²") return slide;
      quiet = true;
      return Object.assign({}, slide, {
        kicker: "шок-цена",
        title: "самая дешевая плитка в ДНР ",
        text: "метр плиты 400 дешевле «Старого города»",
        btn: "Забрать плиту",
        note: "выгода {gap}/м²",
      });
    });
    if (!quiet) return banner;
    slides = slides.map(function (slide) {
      if (!slide || slide.id !== "plita" || slide.on !== false) return slide;
      return Object.assign({}, slide, { on: true });
    });
    return { slides: slides };
  }

  function applyBanner() {
    var local = read(BANNER_KEY, null);
    var saved = local != null ? local : stored(BANNER_KEY, "banner");
    var restored = undoQuietBanner(saved);
    if (restored !== saved && local != null) write(BANNER_KEY, restored);
    window.KDBanner = restored && Array.isArray(restored.slides) && restored.slides.length ? restored : null;
  }

  applyOverrides();
  applyBanner();

  var remoteLeads = null;

  function leads() {
    if (remoteLeads) return remoteLeads;
    var all = read("kd-leads-v1", []);
    return Array.isArray(all) ? all : [];
  }

  function saveLeads(all) {
    write("kd-leads-v1", all);
  }

  function sendLead(item) {
    return fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(item),
    }).then(function (res) {
      if (!res.ok) throw new Error("lead");
      if (res.status === 204) return null;
      return res.json();
    }).then(function (saved) {
      if (!saved || !saved.n) return;
      if (remoteLeads) {
        var found = false;
        remoteLeads = remoteLeads.map(function (row) {
          if (row && row.n === saved.n) {
            found = true;
            return saved;
          }
          return row;
        });
        if (!found) remoteLeads.push(saved);
      }
      var local = read("kd-leads-v1", []);
      if (Array.isArray(local)) {
        write("kd-leads-v1", local.map(function (row) {
          return row && row.n === saved.n ? saved : row;
        }));
      }
    }).catch(function () {});
  }

  function pullLeads() {
    return fetch("/api/leads").then(function (res) {
      if (!res.ok) throw new Error("leads");
      return res.json();
    }).then(function (rows) {
      if (!Array.isArray(rows)) return;
      var seen = {};
      rows.forEach(function (item) {
        if (item && item.n) seen[item.n] = true;
      });
      var local = read("kd-leads-v1", []);
      var extra = [];
      if (Array.isArray(local)) {
        local.forEach(function (item) {
          if (item && item.n && !seen[item.n]) {
            rows.push(item);
            extra.push(item);
          }
        });
      }
      remoteLeads = rows;
      extra.forEach(sendLead);
      if (document.body.classList.contains("is-admin")) repaint();
    }).catch(function () {});
  }

  function isOrder(item) {
    return !!(item && (item.kind === "order" || item.summary));
  }

  function orders() {
    return leads().filter(isOrder).slice().reverse();
  }

  function callbacks() {
    return leads().filter(function (item) { return item && !isOrder(item); }).slice().reverse();
  }

  function freshOrders() {
    return orders().filter(function (item) {
      return !item.status || item.status === "Принят" || item.status === "Новый";
    }).length;
  }

  function freshCalls() {
    return callbacks().filter(function (item) {
      return !item.status || item.status === "Новая";
    }).length;
  }

  function signedIn() {
    return sessionOk;
  }

  function catName(id) {
    return { tile: "Плитка", block: "Шлакоблок", border: "Бордюр", bulk: "Сыпучие" }[id] || id;
  }

  function findLead(n) {
    return leads().filter(function (item) { return item && item.n === n; })[0] || null;
  }

  function setStatus(n, status) {
    var item = null;
    leads().forEach(function (row) {
      if (row && row.n === n) {
        row.status = status;
        item = row;
      }
    });
    if (!remoteLeads) {
      saveLeads(leads());
    } else {
      var local = read("kd-leads-v1", []);
      if (Array.isArray(local)) {
        local.forEach(function (row) {
          if (row && row.n === n) row.status = status;
        });
        write("kd-leads-v1", local);
      }
    }
    if (item) return sendLead(item);
    return Promise.resolve();
  }

  function mailNotes(item) {
    var log = Array.isArray(item.mailLog) ? item.mailLog : [];
    if (!log.length) {
      if (item.mail) return '<p class="ea-note">Письма о статусе уйдут на ' + esc(item.mail) + ".</p>";
      return '<p class="ea-note">У заказа нет почты, статус письмом не уйдёт.</p>';
    }
    return log.map(function (row) {
      if (!row) return "";
      if (row.ok) return '<p class="ea-note">Письмо «' + esc(row.status) + "» отправлено на " + esc(row.to || item.mail || "") + ".</p>";
      return '<p class="ea-error">' + esc(row.status || "Письмо") + ": " + esc(row.error || "не отправлено") + "</p>";
    }).join("");
  }

  function isAdmin() {
    return !!(sessionUser && sessionUser.role === "admin");
  }

  function roleName(role) {
    return role === "admin" ? "администратор" : "менеджер";
  }

  function whoAmI() {
    if (!sessionUser) return "";
    return '<p class="ea-who">' + esc(sessionUser.name) + "<small>" + roleName(sessionUser.role) + "</small></p>";
  }

  function accessLine() {
    if (!sessionUser) return "";
    if (isAdmin()) return "Вы администратор: в разделе «Люди» можно добавить менеджера.";
    return "Вы менеджер: можно вести заказы, товары и тексты. Людей добавляет администратор.";
  }

  function staffHtml() {
    if (!isAdmin()) {
      return shell("staff", "Люди", '<p class="ea-lead">Раздел только для администратора. Менеджер правит каталог, заказы, тексты, баннер и контакты.</p>');
    }
    return shell(
      "staff",
      "Люди",
      '<p class="ea-lead">Менеджеры ведут сайт: заказы, заявки, товары, тексты, баннер и контакты. Добавлять людей может только администратор. Пароль после сохранения больше не показывается.</p>' +
      '<form class="ea-form" id="staff-create">' +
      '<label class="ea-field">Имя<input name="name" required maxlength="80" autocomplete="off"></label>' +
      '<label class="ea-field">Логин<input name="username" required maxlength="32" autocomplete="off"></label>' +
      '<label class="ea-field">Пароль<input name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></label>' +
      '<label class="ea-field">Роль<select name="role"><option value="manager">Менеджер</option><option value="admin">Администратор</option></select></label>' +
      '<button class="ea-btn" type="submit">Добавить</button>' +
      '<p class="ea-error" id="staff-error" hidden></p>' +
      '<p class="ea-note" id="staff-saved" hidden>Человек добавлен. Передайте логин и пароль лично.</p>' +
      "</form>" +
      '<div class="ea-staff" id="staff-list"><p class="ea-note">Загрузка…</p></div>'
    );
  }

  function staffTable(rows) {
    if (!rows || !rows.length) return '<p class="ea-note">Пока никого нет.</p>';
    var selfId = sessionUser ? sessionUser.id : 0;
    return (
      '<table class="ea-table"><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Доступ</th><th>Новый пароль</th><th></th></tr></thead><tbody>' +
      rows.map(function (person) {
        var mine = person.id === selfId;
        return (
          '<tr data-staff-id="' + person.id + '" data-staff-login="' + esc(person.username) + '">' +
          '<td><input name="name" value="' + esc(person.name) + '" maxlength="80" autocomplete="off"></td>' +
          "<td>" + esc(person.username) + "</td>" +
          '<td><select name="role"><option value="manager"' + (person.role === "manager" ? " selected" : "") + ">Менеджер</option>" +
          '<option value="admin"' + (person.role === "admin" ? " selected" : "") + ">Администратор</option></select></td>" +
          '<td><label class="ea-check"><input name="active" type="checkbox"' + (person.active ? " checked" : "") + (mine ? " disabled" : "") + "> работает</label></td>" +
          '<td><input name="password" type="password" maxlength="72" autocomplete="new-password" placeholder="не менять"></td>' +
          '<td><div class="ea-staff-actions"><button class="ea-btn" type="button" data-staff="save">Сохранить</button>' +
          (mine ? "" : '<button class="ea-btn ea-btn-line" type="button" data-staff="delete">Удалить</button>') +
          "</div></td></tr>"
        );
      }).join("") +
      "</tbody></table>"
    );
  }

  function staffMessage(text) {
    var msg = String(text || "").trim();
    if (!msg || msg === "unauthorized") return "Нужно войти заново.";
    return msg;
  }

  function staffError(root, message) {
    var err = root.querySelector("#staff-error");
    if (!err) return;
    err.hidden = !message;
    err.textContent = message || "";
  }

  function loadStaff(root) {
    var box = root.querySelector("#staff-list");
    if (!box) return;
    fetch("/api/staff", { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) return res.text().then(function (text) { throw new Error(staffMessage(text)); });
      return res.json();
    }).then(function (rows) {
      if (!box.isConnected) return;
      box.innerHTML = staffTable(rows);
    }).catch(function (ex) {
      if (box.isConnected) staffError(root, ex.message || "Список людей не загрузился.");
    });
  }

  function menu(section) {
    function item(id, href, label, count) {
      return (
        '<a class="ea-link' + (section === id ? " is-on" : "") + '" href="' + href + '">' +
        "<span>" + label + "</span>" +
        (count ? '<b class="ea-badge">' + count + "</b>" : "") +
        "</a>"
      );
    }
    return (
      '<aside class="ea-side">' +
      '<a class="ea-brand" href="#/admin">Каменный двор<small>Админпанель</small></a>' +
      item("dashboard", "#/admin", "Главная", 0) +
      '<p class="ea-sec">Обращения</p>' +
      item("orders", "#/admin/orders", "Заказы", freshOrders()) +
      item("callbacks", "#/admin/callbacks", "Заявки на звонок", freshCalls()) +
      '<p class="ea-sec">Каталог</p>' +
      item("products", "#/admin/products", "Товары", 0) +
      '<p class="ea-sec">Сайт</p>' +
      item("pages", "#/admin/pages", "Тексты страниц", 0) +
      item("banner", "#/admin/banner", "Баннер", 0) +
      '<p class="ea-sec">Склад</p>' +
      item("settings", "#/admin/settings", "Контакты и доставка", 0) +
      (isAdmin() ? '<p class="ea-sec">Доступ</p>' + item("staff", "#/admin/staff", "Люди", 0) : "") +
      '<div class="ea-side-foot">' + whoAmI() + '<a href="#/">На сайт</a><br><button type="button" data-admin="logout">Выйти</button></div>' +
      "</aside>"
    );
  }

  function shell(section, title, body) {
    return (
      '<div class="ea">' +
      menu(section) +
      '<main class="ea-main"><h1>' + esc(title) + "</h1>" + body + "</main></div>"
    );
  }

  function loginHtml(error) {
    return (
      '<form class="ea-login" id="admin-login">' +
      "<h1>Каменный двор</h1>" +
      '<p class="ea-lead">Вход для сотрудников склада.</p>' +
      (error ? '<p class="ea-error">Неверный логин или пароль.</p>' : "") +
      '<label class="ea-field">Логин<input name="username" autocomplete="username" required></label>' +
      '<label class="ea-field">Пароль<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<button class="ea-btn" type="submit">Войти</button>' +
      "</form>"
    );
  }

  function dashboardHtml() {
    var productCount = PRODUCTS.filter(function (p) { return !p.hidden; }).length;
    var body =
      '<p class="ea-lead">Используйте меню слева. Заказы и звонки пишутся в базу, цены правятся здесь и сразу видны в каталоге. ' + accessLine() + "</p>" +
      '<div class="ea-stats">' +
      '<a class="ea-stat" href="#/admin/orders"><b>' + freshOrders() + "</b><span>новых заказов</span></a>" +
      '<a class="ea-stat" href="#/admin/callbacks"><b>' + freshCalls() + "</b><span>звонков без ответа</span></a>" +
      '<a class="ea-stat" href="#/admin/products"><b>' + productCount + "</b><span>позиций в каталоге</span></a>" +
      '<a class="ea-stat" href="#/admin/settings"><b>' + esc(SITE.phone) + "</b><span>телефон на сайте</span></a>" +
      "</div>";
    return shell("dashboard", "Добро пожаловать", body);
  }

  function statusSelect(item, options) {
    var current = item.status || options[0];
    return (
      '<select data-admin="status" data-lead="' + esc(item.n) + '">' +
      options.map(function (name) {
        return '<option' + (name === current ? " selected" : "") + ">" + esc(name) + "</option>";
      }).join("") +
      "</select>"
    );
  }

  function ordersHtml() {
    var rows = orders().map(function (item) {
      return (
        "<tr><td><a href=\"#/admin/orders/" + encodeURIComponent(item.n) + "\">" + esc(item.n) + "</a></td>" +
        "<td>" + esc(when(item.at)) + "</td>" +
        "<td>" + esc(item.name) + "<br>" + esc(item.phone) + (item.mail ? "<br>" + esc(item.mail) : "") + "</td>" +
        "<td>" + esc(item.summary || "") + "</td>" +
        "<td>" + (item.total != null ? money(item.total) : "") + "</td>" +
        "<td>" + statusSelect(item, ["Принят", "Собран", "Отгружен", "Отменён"]) + "</td></tr>"
      );
    }).join("");
    var body =
      '<p class="ea-lead">Заказы из корзины. Статусы «Принят», «Собран» и «Отгружен» уходят письмом на почту клиента.</p>' +
      (rows
        ? '<div class="ea-card"><table class="ea-table"><thead><tr><th>Номер</th><th>Когда</th><th>Клиент</th><th>Состав</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<p class="ea-note">Заказов пока нет.</p>');
    return shell("orders", "Заказы", body);
  }

  function orderHtml(n) {
    var item = findLead(n);
    if (!item || !isOrder(item)) {
      return shell("orders", "Нет такого заказа", '<p><a class="ea-back" href="#/admin/orders">К списку</a></p>');
    }
    var lines = Array.isArray(item.lines)
      ? "<ul>" + item.lines.map(function (line) {
        return "<li>" + esc(line.name) + (line.color ? " (" + esc(line.color) + ")" : "") + " — " + esc(line.qty) + " " + esc(line.unit) + ", " + money(line.sum) + "</li>";
      }).join("") + "</ul>"
      : "<p>" + esc(item.summary || "") + "</p>";
    var body =
      '<a class="ea-back" href="#/admin/orders">К списку</a>' +
      '<p class="ea-lead">' + esc([when(item.at), item.name, item.phone, item.mail].filter(Boolean).join(" · ")) + "</p>" +
      '<p class="ea-field">Статус ' + statusSelect(item, ["Принят", "Собран", "Отгружен", "Отменён"]) + "</p>" +
      mailNotes(item) +
      lines +
      (item.total != null ? "<p><b>" + money(item.total) + "</b></p>" : "") +
      (item.comment ? "<p>" + esc(item.comment) + "</p>" : "");
    return shell("orders", item.n, body);
  }

  function callbacksHtml() {
    var rows = callbacks().map(function (item) {
      return (
        "<tr><td>" + esc(item.n || "—") + "</td><td>" + esc(when(item.at)) + "</td><td>" + esc(item.name) + "</td><td>" + esc(item.phone) + "</td><td>" + esc(item.comment || "") + "</td><td>" +
        statusSelect(item, ["Новая", "Перезвонили", "Закрыта"]) + "</td></tr>"
      );
    }).join("");
    var body =
      '<p class="ea-lead">Заявки с кнопки «Заказать звонок».</p>' +
      (rows
        ? '<div class="ea-card"><table class="ea-table"><thead><tr><th>Номер</th><th>Когда</th><th>Имя</th><th>Телефон</th><th>Комментарий</th><th>Статус</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<p class="ea-note">Заявок пока нет.</p>');
    return shell("callbacks", "Заявки на звонок", body);
  }

  function productsHtml() {
    var rows = PRODUCTS.map(function (p) {
      return (
        '<tr data-product-row="' + esc((p.name + " " + p.id).toLowerCase()) + '"><td><a href="#/admin/products/' + encodeURIComponent(p.id) + '">' + esc(p.name) + "</a>" +
        (p.hidden ? ' <span class="ea-note">скрыт</span>' : "") + "</td><td>" + esc(catName(p.category)) + "</td><td>" + money(p.price) + "/" + esc(p.unit) + "</td><td>" + esc(p.stock) + "</td><td>" + (p.popular ? "да" : "") + "</td></tr>"
      );
    }).join("");
    var body =
      '<div class="ea-toolbar"><input id="admin-q" type="search" placeholder="Название" aria-label="Поиск товара"><a class="ea-btn" href="#/admin/products/new">Добавить товар</a></div>' +
      '<div class="ea-card"><table class="ea-table"><thead><tr><th>Название</th><th>Раздел</th><th>Цена</th><th>Наличие</th><th>Ходовой</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    return shell("products", "Товары", body);
  }

  function productHtml(id) {
    var p = PRODUCTS.filter(function (item) { return item.id === id; })[0];
    if (!p) return shell("products", "Нет такой позиции", '<p><a class="ea-back" href="#/admin/products">К списку</a></p>');
    return productFormHtml(p);
  }

  function productFormHtml(p) {
    var isNew = !p;
    var cat = p ? p.category : "tile";
    var stocks = ["В наличии", "Под заказ, 3 дня", "Нет на складе"];
    if (p && stocks.indexOf(p.stock) === -1) stocks.unshift(p.stock);
    var units = ["м²", "шт", "м³", "т"];
    if (p && units.indexOf(p.unit) === -1) units.unshift(p.unit);
    var colorFields = "";
    var colorsText = "";
    if (isNew) {
      colorsText = "Серый #8d8d86\nКрасный #9d3b32\nКоричневый #6d4b34";
    } else if (p.custom) {
      colorsText = p.colors.map(function (c) { return c.name + " " + c.hex; }).join("\n");
    } else {
      colorFields = p.colors.map(function (color) {
        return '<label class="ea-field">Цвет «' + esc(color.name) + "»<input name=\"color-" + esc(color.id) + '" value="' + esc(color.name) + '"></label>';
      }).join("");
    }
    var body =
      '<a class="ea-back" href="#/admin/products">К списку</a>' +
      '<form class="ea-form" id="admin-product" data-id="' + esc(p ? p.id : "") + '">' +
      '<label class="ea-field">Название<input name="name" value="' + esc(p ? p.name : "") + '" required></label>' +
      '<label class="ea-field">Раздел<select name="category">' +
      [["tile", "Плитка"], ["block", "Шлакоблок"], ["border", "Бордюр"], ["bulk", "Сыпучие"]].map(function (row) {
        return '<option value="' + row[0] + '"' + (row[0] === cat ? " selected" : "") + ">" + row[1] + "</option>";
      }).join("") +
      "</select></label>" +
      '<label class="ea-field">Коротко о позиции<textarea name="lead" rows="3">' + esc(p ? p.lead : "") + "</textarea></label>" +
      '<label class="ea-field">Куда кладут<textarea name="usage" rows="2">' + esc(p ? p.usage : "") + "</textarea></label>" +
      '<label class="ea-field">Размер на карточке<input name="size" value="' + esc(p ? p.size : "") + '"></label>' +
      '<label class="ea-field">Толщина, мм<input name="thickness" inputmode="decimal" value="' + esc(p ? p.thickness : "60") + '"></label>' +
      '<label class="ea-field">Штук в 1 м²<input name="pcsPerM2" inputmode="decimal" value="' + esc(p ? p.pcsPerM2 : "1") + '"></label>' +
      '<label class="ea-field">Подпись количества в калькуляторе<input name="inputLabel" value="' + esc(p ? p.inputLabel : "") + '"></label>' +
      '<label class="ea-field">Марка<input name="mark" value="' + esc(p ? p.mark : "") + '"></label>' +
      '<label class="ea-field">Морозостойкость<input name="frost" value="' + esc(p ? p.frost : "") + '"></label>' +
      '<label class="ea-field">Норма<input name="standard" value="' + esc(p ? p.standard : "") + '"></label>' +
      '<label class="ea-field">Вес<input name="weight" value="' + esc(p ? p.weight : "") + '"></label>' +
      '<label class="ea-field">Сколько в метре<input name="piecesLabel" value="' + esc(p ? p.piecesLabel : "") + '"></label>' +
      '<label class="ea-field">Поддон<input name="pallet" value="' + esc(p ? p.pallet : "") + '"></label>' +
      colorFields +
      (isNew || (p && p.custom)
        ? '<label class="ea-field">Цвета — по одному в строке, можно с кодом<textarea name="colors" rows="3" placeholder="Серый #8d8d86">' + esc(colorsText) + "</textarea></label>"
        : "") +
      '<label class="ea-field">Цена, ₽ за единицу<input name="price" inputmode="decimal" value="' + esc(p ? p.price : "") + '" required></label>' +
      '<label class="ea-field">Единица<select name="unit">' + units.map(function (name) {
        return '<option' + (p && name === p.unit ? " selected" : "") + ">" + esc(name) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="ea-field">Наличие<select name="stock">' + stocks.map(function (name) {
        return '<option' + (p && name === p.stock ? " selected" : "") + ">" + esc(name) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="ea-check"><input type="checkbox" name="popular"' + (p && p.popular ? " checked" : "") + "> Ходовой, выше в каталоге</label>" +
      '<label class="ea-check"><input type="checkbox" name="hidden"' + (p && p.hidden ? " checked" : "") + "> Скрыть с витрины</label>" +
      '<label class="ea-field">Фото фактуры<img class="ea-photo" id="admin-photo-preview" alt="Фото товара"' + (p ? ' src="' + esc(photoSrc(p.id)) + '"' : " hidden") + '>' +
      '<input id="admin-photo" name="photo" type="file" accept="image/*"></label>' +
      (p && photos[p.id]
        ? '<label class="ea-check"><input type="checkbox" name="dropPhoto"> Убрать загруженное и вернуть складской снимок</label>'
        : "") +
      '<p class="ea-note">Без фото на витрине показывается заглушка. Цвет заказа по-прежнему красится только на модели.</p>' +
      '<button class="ea-btn" type="submit">' + (isNew ? "Добавить товар" : "Сохранить") + "</button>" +
      (p && p.custom
        ? '<button class="ea-btn ea-btn-line ea-danger" type="button" id="admin-product-delete">Удалить товар</button>'
        : "") +
      '<p class="ea-error" id="admin-photo-error" hidden>Не удалось прочитать фото. Выберите другой файл.</p>' +
      '<p class="ea-note" id="admin-saved" hidden>Сохранено.</p>' +
      "</form>";
    return shell("products", isNew ? "Новый товар" : p.name, body);
  }

  function deliveryPrice(id) {
    var row = (SITE.delivery || []).filter(function (item) { return item.id === id; })[0];
    return row ? row.price : 0;
  }

  function settingsHtml() {
    var body =
      '<p class="ea-lead">Телефон, адрес и цены доставки с главной, шапки и калькулятора.</p>' +
      '<form class="ea-form" id="admin-site">' +
      '<label class="ea-field">Телефон<input name="phone" value="' + esc(SITE.phone) + '" required></label>' +
      '<label class="ea-field">Часы<input name="hours" value="' + esc(SITE.hours) + '" required></label>' +
      '<label class="ea-field">Адрес<input name="address" value="' + esc(SITE.address) + '" required></label>' +
      '<label class="ea-field">Доставка по городу, ₽<input name="city" inputmode="decimal" value="' + esc(deliveryPrice("city")) + '"></label>' +
      '<label class="ea-field">До 30 км, ₽<input name="near" inputmode="decimal" value="' + esc(deliveryPrice("near")) + '"></label>' +
      '<button class="ea-btn" type="submit">Сохранить</button>' +
      '<p class="ea-note" id="admin-saved" hidden>Сохранено.</p>' +
      "</form>";
    return shell("settings", "Контакты и доставка", body);
  }

  function copyPages() {
    return window.COPY_PAGES || [];
  }

  function copyPage(id) {
    return copyPages().filter(function (page) { return page.id === id; })[0] || null;
  }

  function dealPlaceholder(key) {
    function byId(id) {
      return PRODUCTS.filter(function (item) { return item.id === id; })[0];
    }
    var plita = byId("plita-400");
    var old = byId("stary-gorod");
    var hollow = byId("block-hollow");
    var solid = byId("block-solid");
    var garden = byId("border-garden");
    var road = byId("border-road");
    if (key === "home.deal1" && plita && old) return "На " + money(old.price - plita.price) + " за м² дешевле «Старого города»";
    if (key === "home.deal2" && hollow && solid) return "На " + money(solid.price - hollow.price) + " за штуку дешевле полнотелого";
    if (key === "home.deal3" && garden && road) return "На " + money(road.price - garden.price) + " за метр дешевле дорожного";
    return "";
  }

  function pagesHtml() {
    var links = copyPages().map(function (page) {
      return '<a href="#/admin/pages/' + page.id + '">' + esc(page.title) + "</a>";
    }).join("");
    var body =
      '<p class="ea-lead">Тексты шапки, главной, каталога, карточки, калькулятора, доставки, контактов, корзины, избранного и заказов. Название, описание и цвета каждой позиции — в «Товарах». Телефон, часы и цены доставки — в «Контактах и доставке».</p>' +
      '<div class="ea-page-list">' + links + "</div>";
    return shell("pages", "Тексты страниц", body);
  }

  function pageCopyHtml(id) {
    var page = copyPage(id);
    if (!page) return shell("pages", "Нет такой страницы", '<p><a class="ea-back" href="#/admin/pages">К списку</a></p>');
    var patch = read(COPY_KEY, {}) || {};
    var fields = page.fields.map(function (field) {
      var key = field[0];
      var stored = Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : field[2];
      var hold = dealPlaceholder(key);
      var control = field[3]
        ? '<textarea name="' + esc(key) + '" rows="4">' + esc(stored) + "</textarea>"
        : '<input name="' + esc(key) + '" value="' + esc(stored) + '"' + (hold ? ' placeholder="' + esc(hold) + '"' : "") + ">";
      return (
        '<label class="ea-field" data-copy-field="' + esc((field[1] + " " + stored).toLowerCase()) + '">' +
        esc(field[1]) + control + "</label>"
      );
    }).join("");
    var body =
      '<a class="ea-back" href="#/admin/pages">Все страницы</a>' +
      '<div class="ea-toolbar"><input id="copy-q" type="search" placeholder="Найти строку" aria-label="Поиск строки"></div>' +
      '<form class="ea-form ea-form-wide" id="admin-copy" data-page="' + esc(page.id) + '">' +
      fields +
      '<div class="ea-actions"><button class="ea-btn" type="submit">Сохранить</button>' +
      '<button class="ea-btn ea-btn-line" type="button" data-admin="reset-copy">Вернуть исходные тексты</button></div>' +
      '<p class="ea-note" id="admin-saved" hidden>Сохранено. На сайте уже новый текст.</p>' +
      "</form>";
    return shell("pages", page.title, body);
  }

  function productOptions(selected) {
    return PRODUCTS.map(function (product) {
      return '<option value="' + esc(product.id) + '"' + (product.id === selected ? " selected" : "") + ">" + esc(product.name) + "</option>";
    }).join("");
  }

  function bannerHtml() {
    var data = bannerData();
    var cards = data.slides.map(function (slide, index) {
      var last = index === data.slides.length - 1;
      var tools =
        '<div class="ea-banner-tools">' +
        '<button class="ea-btn ea-btn-line" type="button" data-banner="up" data-id="' + esc(slide.id) + '"' + (index === 0 ? " disabled" : "") + ">Выше</button>" +
        '<button class="ea-btn ea-btn-line" type="button" data-banner="down" data-id="' + esc(slide.id) + '"' + (last ? " disabled" : "") + ">Ниже</button>" +
        (slide.type === "photo"
          ? '<button class="ea-btn ea-btn-line" type="button" data-banner="remove" data-id="' + esc(slide.id) + '">Убрать кадр</button>'
          : "") +
        "</div>";
      var show =
        '<label class="ea-check"><input type="checkbox" name="on-' + esc(slide.id) + '"' + (slide.on === false ? "" : " checked") + "> Показывать на сайте</label>";
      var texts =
        '<input type="hidden" name="type-' + esc(slide.id) + '" value="' + esc(slide.type) + '">' +
        '<label class="ea-field">Строка сверху<input name="kicker-' + esc(slide.id) + '" value="' + esc(slide.kicker || "") + '"></label>' +
        '<label class="ea-field">Заголовок. Новая строка — новый ряд<textarea name="title-' + esc(slide.id) + '" rows="3">' + esc(slide.title || "") + "</textarea></label>" +
        '<label class="ea-field">Текст<textarea name="text-' + esc(slide.id) + '" rows="3">' + esc(slide.text || "") + "</textarea></label>" +
        '<label class="ea-field">Кнопка<input name="btn-' + esc(slide.id) + '" value="' + esc(slide.btn || "") + '"></label>';
      var extra = "";
      if (slide.type === "offer") {
        extra =
          '<p class="ea-note">На кадре плита 400 и «Старый город». В бирке {gap} — разница их цен.</p>' +
          '<label class="ea-field">Бирка выгоды<input name="note-' + esc(slide.id) + '" value="' + esc(slide.note || "") + '"></label>';
      } else {
        var custom = !!photos["banner-" + slide.id];
        extra =
          '<p class="ea-note">В тексте можно писать {price} и {size} — цена и размер выбранного товара.</p>' +
          '<label class="ea-field">Товар на кадре<select name="product-' + esc(slide.id) + '">' + productOptions(slide.productId) + "</select></label>" +
          '<img class="ea-photo" data-banner-preview="' + esc(slide.id) + '" src="' + esc(bannerSrc(slide.id, slide.productId)) + '" alt="">' +
          '<label class="ea-field">Своё фото для этого кадра<input type="file" name="photo-' + esc(slide.id) + '" accept="image/*"></label>' +
          (custom
            ? '<label class="ea-check"><input type="checkbox" name="drop-' + esc(slide.id) + '"> Убрать своё фото и вернуть снимок товара</label>'
            : "");
      }
      return (
        '<fieldset class="ea-banner"><legend>' +
        (slide.type === "offer" ? "Кадр со склада" : "Кадр " + (index + 1)) +
        "</legend>" +
        show +
        texts +
        extra +
        tools +
        "</fieldset>"
      );
    }).join("");
    var body =
      '<p class="ea-lead">Кадры плашки на главной. Первый сравнивает плиту 400 со «Старым городом», остальные — фото. Всё хранится в этом браузере.</p>' +
      '<form class="ea-form ea-form-wide" id="admin-banner" data-ids="' + esc(data.slides.map(function (slide) { return slide.id; }).join(",")) + '">' +
      cards +
      '<div class="ea-actions"><button class="ea-btn" type="submit">Сохранить</button>' +
      '<button class="ea-btn ea-btn-line" type="button" data-banner="add">Добавить кадр</button>' +
      '<button class="ea-btn ea-btn-line" type="button" data-banner="reset">Вернуть исходные кадры</button></div>' +
      '<p class="ea-error" id="admin-photo-error" hidden>Фото не прочиталось. Выберите другой файл.</p>' +
      '<p class="ea-note" id="admin-saved" hidden>Сохранено. На главной уже новый баннер.</p>' +
      "</form>";
    return shell("banner", "Баннер", body);
  }

  function html(parts) {
    if (!signedIn()) return loginHtml(false);
    var section = parts[1] || "dashboard";
    if (section === "orders" && parts[2]) return orderHtml(decodeURIComponent(parts[2]));
    if (section === "orders") return ordersHtml();
    if (section === "callbacks") return callbacksHtml();
    if (section === "products" && parts[2] === "new") return productFormHtml(null);
    if (section === "products" && parts[2]) return productHtml(decodeURIComponent(parts[2]));
    if (section === "products") return productsHtml();
    if (section === "pages" && parts[2]) return pageCopyHtml(parts[2]);
    if (section === "pages") return pagesHtml();
    if (section === "banner") return bannerHtml();
    if (section === "settings") return settingsHtml();
    if (section === "staff") return staffHtml();
    return dashboardHtml();
  }

  function repaint() {
    var raw = (location.hash || "#/admin").replace(/^#/, "");
    var parts = raw.split("?")[0].split("/").filter(Boolean);
    var view = document.getElementById("view");
    if (!view) return;
    view.innerHTML = html(parts);
    hook(view);
  }

  function hook(root) {
    if (!root) return;
    var login = root.querySelector("#admin-login");
    if (login) {
      login.addEventListener("submit", function (e) {
        e.preventDefault();
        var button = login.querySelector("button");
        if (button) button.disabled = true;
        fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            username: login.username.value.trim(),
            password: login.password.value,
          }),
        }).then(function (res) {
          if (!res.ok) {
            root.innerHTML = loginHtml(true);
            hook(root);
            return null;
          }
          return res.json();
        }).then(function (user) {
          if (!user) return;
          sessionOk = true;
          sessionUser = user;
          pullLeads();
          if (location.hash !== "#/admin") location.hash = "#/admin";
          else repaint();
        }).catch(function () {
          root.innerHTML = loginHtml(true);
          hook(root);
        });
      });
    }
    var logout = root.querySelector("[data-admin=logout]");
    if (logout) {
      logout.addEventListener("click", function () {
        fetch("/api/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
          sessionOk = false;
          sessionUser = null;
          remoteLeads = null;
          repaint();
        });
      });
    }
    var staffCreate = root.querySelector("#staff-create");
    if (staffCreate) {
      loadStaff(root);
      staffCreate.addEventListener("submit", function (e) {
        e.preventDefault();
        var button = staffCreate.querySelector("button");
        if (button) button.disabled = true;
        staffError(root, "");
        var saved = root.querySelector("#staff-saved");
        if (saved) saved.hidden = true;
        fetch("/api/staff", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: staffCreate.name.value.trim(),
            username: staffCreate.username.value.trim(),
            password: staffCreate.password.value,
            role: staffCreate.role.value,
          }),
        }).then(function (res) {
          if (!res.ok) return res.text().then(function (text) { throw new Error(staffMessage(text)); });
          staffCreate.name.value = "";
          staffCreate.username.value = "";
          staffCreate.password.value = "";
          if (saved) {
            saved.hidden = false;
            saved.textContent = "Человек добавлен. Передайте логин и пароль лично.";
          }
          loadStaff(root);
        }).catch(function (ex) {
          staffError(root, ex.message);
        }).then(function () {
          if (button) button.disabled = false;
        });
      });
    }
    var staffList = root.querySelector("#staff-list");
    if (staffList) {
      staffList.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-staff]");
        if (!btn) return;
        var tr = btn.closest("tr");
        if (!tr) return;
        var id = tr.getAttribute("data-staff-id");
        staffError(root, "");
        if (btn.getAttribute("data-staff") === "delete") {
          var loginName = tr.getAttribute("data-staff-login") || "этого человека";
          if (!window.confirm("Удалить «" + loginName + "»? Вход под этим логином перестанет работать.")) return;
          fetch("/api/staff?id=" + encodeURIComponent(id), { method: "DELETE", credentials: "same-origin" }).then(function (res) {
            if (!res.ok) return res.text().then(function (text) { throw new Error(staffMessage(text)); });
            loadStaff(root);
          }).catch(function (ex) {
            staffError(root, ex.message);
          });
          return;
        }
        var active = tr.querySelector("[name=active]");
        var nextName = tr.querySelector("[name=name]").value.trim();
        var nextRole = tr.querySelector("[name=role]").value;
        fetch("/api/staff?id=" + encodeURIComponent(id), {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nextName,
            role: nextRole,
            active: !!(active && active.checked),
            password: tr.querySelector("[name=password]").value,
          }),
        }).then(function (res) {
          if (!res.ok) return res.text().then(function (text) { throw new Error(staffMessage(text)); });
          tr.querySelector("[name=password]").value = "";
          if (sessionUser && String(sessionUser.id) === String(id)) {
            sessionUser.name = nextName;
            sessionUser.role = nextRole;
            if (nextRole !== "admin") {
              if (location.hash !== "#/admin") location.hash = "#/admin";
              else repaint();
              return;
            }
            var who = root.querySelector(".ea-who");
            if (who) who.innerHTML = esc(nextName) + "<small>" + roleName(nextRole) + "</small>";
          }
          var saved = root.querySelector("#staff-saved");
          if (saved) {
            saved.hidden = false;
            saved.textContent = "Сохранено.";
          }
        }).catch(function (ex) {
          staffError(root, ex.message);
        });
      });
    }
    root.querySelectorAll("[data-admin=status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        setStatus(sel.dataset.lead, sel.value).then(function () { repaint(); });
      });
    });
    var q = root.querySelector("#admin-q");
    if (q) {
      q.addEventListener("input", function () {
        var value = q.value.trim().toLowerCase();
        root.querySelectorAll("[data-product-row]").forEach(function (row) {
          row.hidden = !!(value && row.dataset.productRow.indexOf(value) === -1);
        });
      });
    }
    var productForm = root.querySelector("#admin-product");
    if (productForm) {
      var photoInput = productForm.querySelector("#admin-photo");
      var preview = productForm.querySelector("#admin-photo-preview");
      if (photoInput && preview) {
        photoInput.addEventListener("change", function () {
          var picked = photoInput.files && photoInput.files[0];
          if (!picked) return;
          preview.src = URL.createObjectURL(picked);
          preview.hidden = false;
        });
      }
      var deleteBtn = productForm.querySelector("#admin-product-delete");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", function () {
          var id = productForm.dataset.id;
          if (!id || !window.confirm("Удалить товар из каталога? Действие нельзя отменить.")) return;
          var patches = stored(PRODUCT_KEY, "products") || {};
          if (!patches || typeof patches !== "object") patches = {};
          delete patches[id];
          write(PRODUCT_KEY, patches);
          applyOverrides();
          publish({ products: patches }).then(function () {
            deletePhoto(id);
            dropFilePhoto(id).catch(function () {});
            location.hash = "#/admin/products";
            repaint();
          }, function () {
            markSaved(document.getElementById("admin-saved"), false);
          });
        });
      }
      productForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var isNew = !productForm.dataset.id;
        var id = productForm.dataset.id || "p" + Date.now().toString(36);
        var fields = productForm.elements;
        var file = fields.photo.files && fields.photo.files[0];
        var drop = fields.dropPhoto && fields.dropPhoto.checked && !file;
        var button = productForm.querySelector("button[type=submit]");
        var fail = productForm.querySelector("#admin-photo-error");
        if (button) button.disabled = true;
        if (fail) fail.hidden = true;
        var photoJob = Promise.resolve();
        if (file) photoJob = compressPhoto(file).then(function (blob) {
          return putPhoto(id, blob).then(function () { return sendPhoto(id, blob); });
        });
        else if (drop) photoJob = deletePhoto(id).then(function () { return dropFilePhoto(id); });
        photoJob.then(function () {
          var patches = stored(PRODUCT_KEY, "products") || {};
          if (!patches || typeof patches !== "object") patches = {};
          var patch = {
            name: fields.name.value.trim(),
            category: fields.category.value,
            unit: fields.unit.value,
            lead: fields.lead.value.trim(),
            usage: fields.usage.value.trim(),
            size: fields.size.value.trim(),
            thickness: fields.thickness.value.trim(),
            pcsPerM2: fields.pcsPerM2.value.trim(),
            inputLabel: fields.inputLabel.value.trim(),
            mark: fields.mark.value.trim(),
            frost: fields.frost.value.trim(),
            standard: fields.standard.value.trim(),
            weight: fields.weight.value.trim(),
            piecesLabel: fields.piecesLabel.value.trim(),
            pallet: fields.pallet.value.trim(),
            colors: {},
            price: Number(String(fields.price.value).replace(",", ".")) || 0,
            stock: fields.stock.value,
            popular: fields.popular.checked,
            hidden: fields.hidden.checked,
          };
          if (isNew) patch.custom = true;
          if (fields.colors) {
            patch.hex = {};
            String(fields.colors.value).split(/\n|,/).forEach(function (line) {
              var row = line.trim();
              if (!row) return;
              var match = row.match(/^(.*?)\s*(#[0-9a-fA-F]{3,8})?$/);
              var name = (match && match[1] ? match[1] : row).trim() || "Цвет";
              var key = "c" + (Object.keys(patch.colors).length + 1);
              patch.colors[key] = name;
              if (match && match[2]) patch.hex[key] = match[2];
            });
            if (!Object.keys(patch.colors).length) {
              patch.colors.c1 = "Серый";
              patch.hex.c1 = "#8d8d86";
            }
          } else {
            Array.prototype.forEach.call(fields, function (field) {
              if (field.name && field.name.indexOf("color-") === 0 && field.value.trim()) {
                patch.colors[field.name.slice(6)] = field.value.trim();
              }
            });
          }
          patches[id] = patch;
          write(PRODUCT_KEY, patches);
          applyOverrides();
          if (button) button.disabled = false;
          publish({ products: patches }).then(function () {
            if (isNew) {
              location.hash = "#/admin/products";
              repaint();
              return;
            }
            if (file || drop) repaint();
            markSaved(document.getElementById("admin-saved"), true);
          }, function () {
            if (file || drop) repaint();
            markSaved(document.getElementById("admin-saved"), false);
          });
        }).catch(function () {
          if (button) button.disabled = false;
          if (fail) fail.hidden = false;
        });
      });
    }
    var siteForm = root.querySelector("#admin-site");
    if (siteForm) {
      siteForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var saved = stored(SITE_KEY, "site") || {};
        var fields = siteForm.elements;
        saved.phone = fields.phone.value.trim();
        saved.hours = fields.hours.value.trim();
        saved.address = fields.address.value.trim();
        saved.delivery = saved.delivery || {};
        saved.delivery.city = Number(String(fields.city.value).replace(",", ".")) || 0;
        saved.delivery.near = Number(String(fields.near.value).replace(",", ".")) || 0;
        write(SITE_KEY, saved);
        applyOverrides();
        publish({ site: saved }).then(function () {
          markSaved(document.getElementById("admin-saved"), true);
        }, function () {
          markSaved(document.getElementById("admin-saved"), false);
        });
      });
    }
    var copyForm = root.querySelector("#admin-copy");
    if (copyForm) {
      var copyQ = root.querySelector("#copy-q");
      if (copyQ) {
        copyQ.addEventListener("input", function () {
          var value = copyQ.value.trim().toLowerCase();
          root.querySelectorAll("[data-copy-field]").forEach(function (field) {
            field.hidden = !!(value && field.dataset.copyField.indexOf(value) === -1);
          });
        });
      }
      copyForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var page = copyPage(copyForm.dataset.page);
        var patch = stored(COPY_KEY, "copy") || {};
        if (!page) return;
        page.fields.forEach(function (field) {
          var key = field[0];
          var input = copyForm.elements[key];
          if (!input) return;
          var value = input.value;
          if (value === field[2]) delete patch[key];
          else patch[key] = value;
        });
        write(COPY_KEY, patch);
        applyCopy();
        window.dispatchEvent(new Event("kd-copy"));
        publish({ copy: patch }).then(function () {
          markSaved(document.getElementById("admin-saved"), true);
        }, function () {
          markSaved(document.getElementById("admin-saved"), false);
        });
      });
      var reset = root.querySelector("[data-admin=reset-copy]");
      if (reset) {
        reset.addEventListener("click", function () {
          var page = copyPage(copyForm.dataset.page);
          var patch = stored(COPY_KEY, "copy") || {};
          if (!page) return;
          page.fields.forEach(function (field) { delete patch[field[0]]; });
          write(COPY_KEY, patch);
          applyCopy();
          window.dispatchEvent(new Event("kd-copy"));
          publish({ copy: patch }).then(function () { repaint(); });
        });
      }
    }
    var bannerForm = root.querySelector("#admin-banner");
    if (bannerForm) {
      bannerForm.querySelectorAll("input[type=file]").forEach(function (input) {
        input.addEventListener("change", function () {
          var file = input.files && input.files[0];
          var id = input.name.replace(/^photo-/, "");
          var preview = bannerForm.querySelector('[data-banner-preview="' + id + '"]');
          if (!file || !preview) return;
          preview.src = URL.createObjectURL(file);
        });
      });
      bannerForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var fields = bannerForm.elements;
        var slides = slidesFromBannerForm(bannerForm);
        var button = bannerForm.querySelector("button[type=submit]");
        var fail = bannerForm.querySelector("#admin-photo-error");
        if (button) button.disabled = true;
        if (fail) fail.hidden = true;
        Promise.all(slides.map(function (slide) {
          if (slide.type !== "photo") return Promise.resolve();
          var fileInput = fields["photo-" + slide.id];
          var file = fileInput && fileInput.files && fileInput.files[0];
          var dropInput = fields["drop-" + slide.id];
          var drop = dropInput && dropInput.checked && !file;
          if (file) return compressPhoto(file).then(function (blob) { return putPhoto("banner-" + slide.id, blob); });
          if (drop) return deletePhoto("banner-" + slide.id);
          return Promise.resolve();
        })).then(function () {
          saveBannerSlides(slides);
          if (button) button.disabled = false;
          repaint();
          var note = document.getElementById("admin-saved");
          if (note) note.hidden = false;
        }).catch(function () {
          if (button) button.disabled = false;
          if (fail) fail.hidden = false;
        });
      });
      bannerForm.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-banner]");
        if (!btn || btn.type === "submit") return;
        var action = btn.dataset.banner;
        var slides = slidesFromBannerForm(bannerForm);
        if (action === "add") {
          var first = PRODUCTS[0];
          slides.push({
            id: "b" + Date.now().toString(36),
            type: "photo",
            on: true,
            productId: first ? first.id : "",
            kicker: "На складе",
            title: first ? first.name : "",
            text: "{price} · {size}",
            btn: "Открыть",
          });
          saveBannerSlides(slides);
          repaint();
          return;
        }
        if (action === "reset") {
          var jobs = slides.filter(function (slide) { return slide.type === "photo"; }).map(function (slide) {
            return photos["banner-" + slide.id] ? deletePhoto("banner-" + slide.id) : Promise.resolve();
          });
          Promise.all(jobs).then(function () {
            localStorage.removeItem(BANNER_KEY);
            publish({ banner: null });
            applyBanner();
            window.dispatchEvent(new Event("kd-banner"));
            repaint();
          });
          return;
        }
        var index = slides.findIndex(function (slide) { return slide.id === btn.dataset.id; });
        if (index < 0) return;
        if (action === "remove" && slides[index].type === "photo") {
          var gone = slides[index];
          slides.splice(index, 1);
          var wipe = photos["banner-" + gone.id] ? deletePhoto("banner-" + gone.id) : Promise.resolve();
          wipe.then(function () {
            saveBannerSlides(slides);
            repaint();
          });
          return;
        }
        if (action === "up" && index > 0) {
          var prev = slides[index - 1];
          slides[index - 1] = slides[index];
          slides[index] = prev;
        } else if (action === "down" && index < slides.length - 1) {
          var next = slides[index + 1];
          slides[index + 1] = slides[index];
          slides[index] = next;
        } else return;
        saveBannerSlides(slides);
        repaint();
      });
    }
  }

  function slidesFromBannerForm(form) {
    var ids = String(form.dataset.ids || "").split(",").filter(Boolean);
    var fields = form.elements;
    return ids.map(function (id) {
      var type = fields["type-" + id] ? fields["type-" + id].value : "photo";
      var slide = {
        id: id,
        type: type,
        on: !!(fields["on-" + id] && fields["on-" + id].checked),
        kicker: fields["kicker-" + id] ? fields["kicker-" + id].value : "",
        title: fields["title-" + id] ? fields["title-" + id].value : "",
        text: fields["text-" + id] ? fields["text-" + id].value : "",
        btn: fields["btn-" + id] ? fields["btn-" + id].value : "",
      };
      if (type === "offer") {
        slide.note = fields["note-" + id] ? fields["note-" + id].value : "";
        slide.leftId = fields["left-" + id] ? fields["left-" + id].value : "";
        slide.rightId = fields["right-" + id] ? fields["right-" + id].value : "";
      } else {
        slide.productId = fields["product-" + id] ? fields["product-" + id].value : "";
      }
      return slide;
    });
  }

  function saveBannerSlides(slides) {
    var banner = { slides: slides };
    write(BANNER_KEY, banner);
    publish({ banner: banner });
    applyBanner();
    window.dispatchEvent(new Event("kd-banner"));
  }

  window.KDAdmin = { html: html, hook: hook, photoSrc: photoSrc, bannerSrc: bannerSrc };
  fetch("/api/session", { credentials: "same-origin" }).then(function (res) {
    if (!res.ok) {
      sessionOk = false;
      sessionUser = null;
      if (document.body.classList.contains("is-admin")) repaint();
      return;
    }
    return res.json().then(function (user) {
      sessionOk = true;
      sessionUser = user;
      pullLeads();
      if (document.body.classList.contains("is-admin")) repaint();
    });
  }).catch(function () {});
})();
