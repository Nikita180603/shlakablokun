/* Пример админки по устройству EasyAdmin из Донснабкомплекта.
   Вход и правки живут в этом браузере, сервера за ними нет. */
(function () {
  var PRODUCT_KEY = "kd-admin-products-v1";
  var SITE_KEY = "kd-admin-site-v1";
  var COPY_KEY = "kd-admin-copy-v1";
  var SESSION_KEY = "kd-admin-ok";
  var DEMO_LOGIN = "admin";
  var DEMO_PASSWORD = "sklad";
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

  function putPhoto(id, blob) {
    return openDb().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("photos", "readwrite");
        tx.objectStore("photos").put(blob, id);
        tx.oncomplete = function () {
          rememberPhoto(id, blob);
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function deletePhoto(id) {
    return openDb().then(function (database) {
      return new Promise(function (resolve, reject) {
        var tx = database.transaction("photos", "readwrite");
        tx.objectStore("photos").delete(id);
        tx.oncomplete = function () {
          if (photos[id]) URL.revokeObjectURL(photos[id]);
          delete photos[id];
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

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
    return photos[id] || "img/" + id + ".jpg";
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
    var patch = read(COPY_KEY, {});
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

  function applyOverrides() {
    applyCopy();
    if (!window.SITE || !window.PRODUCTS) return;
    var site = read(SITE_KEY, null);
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
    var patches = read(PRODUCT_KEY, {});
    if (!patches || typeof patches !== "object") return;
    PRODUCTS.forEach(function (product) {
      var patch = patches[product.id];
      if (!patch) return;
      if (patch.name) product.name = patch.name;
      if (patch.price != null && patch.price !== "") product.price = Number(patch.price) || 0;
      if (patch.stock) product.stock = patch.stock;
      if (patch.popular != null) product.popular = !!patch.popular;
      if (patch.hidden != null) product.hidden = !!patch.hidden;
      ["lead", "size", "piecesLabel", "pallet", "mark", "frost", "standard", "weight", "usage", "inputLabel"].forEach(function (key) {
        if (patch[key] != null) product[key] = patch[key];
      });
      if (patch.colors && typeof patch.colors === "object") {
        product.colors.forEach(function (color) {
          if (patch.colors[color.id]) color.name = patch.colors[color.id];
        });
      }
    });
  }

  applyOverrides();

  function leads() {
    var all = read("kd-leads-v1", []);
    return Array.isArray(all) ? all : [];
  }

  function saveLeads(all) {
    write("kd-leads-v1", all);
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
    return sessionStorage.getItem(SESSION_KEY) === "1";
  }

  function catName(id) {
    return { tile: "Плитка", block: "Шлакоблок", border: "Бордюр", bulk: "Сыпучие" }[id] || id;
  }

  function findLead(n) {
    return leads().filter(function (item) { return item && item.n === n; })[0] || null;
  }

  function setStatus(n, status) {
    var all = leads();
    all.forEach(function (item) {
      if (item && item.n === n) item.status = status;
    });
    saveLeads(all);
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
      '<p class="ea-sec">Склад</p>' +
      item("settings", "#/admin/settings", "Контакты и доставка", 0) +
      '<div class="ea-side-foot"><a href="#/">На сайт</a><br><button type="button" data-admin="logout">Выйти</button></div>' +
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
      '<p class="ea-lead">Пример входа, как в админке Донснабкомплекта. Логин <b>admin</b>, пароль <b>sklad</b>.</p>' +
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
      '<p class="ea-lead">Используйте меню слева. Заказы и звонки — из этого браузера, цены правятся здесь и сразу видны в каталоге.</p>' +
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
        "<td>" + esc(item.name) + "<br>" + esc(item.phone) + "</td>" +
        "<td>" + esc(item.summary || "") + "</td>" +
        "<td>" + (item.total != null ? money(item.total) : "") + "</td>" +
        "<td>" + statusSelect(item, ["Принят", "Собран", "Отгружен", "Отменён"]) + "</td></tr>"
      );
    }).join("");
    var body =
      '<p class="ea-lead">Заказы из корзины на этом компьютере.</p>' +
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
      '<p class="ea-lead">' + esc([when(item.at), item.name, item.phone].filter(Boolean).join(" · ")) + "</p>" +
      '<p class="ea-field">Статус ' + statusSelect(item, ["Принят", "Собран", "Отгружен", "Отменён"]) + "</p>" +
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
      '<div class="ea-toolbar"><input id="admin-q" type="search" placeholder="Название" aria-label="Поиск товара"></div>' +
      '<div class="ea-card"><table class="ea-table"><thead><tr><th>Название</th><th>Раздел</th><th>Цена</th><th>Наличие</th><th>Ходовой</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    return shell("products", "Товары", body);
  }

  function productHtml(id) {
    var p = PRODUCTS.filter(function (item) { return item.id === id; })[0];
    if (!p) return shell("products", "Нет такой позиции", '<p><a class="ea-back" href="#/admin/products">К списку</a></p>');
    var stocks = ["В наличии", "Под заказ, 3 дня", "Нет на складе"];
    if (stocks.indexOf(p.stock) === -1) stocks.unshift(p.stock);
    var body =
      '<a class="ea-back" href="#/admin/products">К списку</a>' +
      '<form class="ea-form" id="admin-product" data-id="' + esc(p.id) + '">' +
      '<label class="ea-field">Название<input name="name" value="' + esc(p.name) + '" required></label>' +
      '<label class="ea-field">Коротко о позиции<textarea name="lead" rows="3">' + esc(p.lead) + "</textarea></label>" +
      '<label class="ea-field">Куда кладут<textarea name="usage" rows="2">' + esc(p.usage) + "</textarea></label>" +
      '<label class="ea-field">Размер на карточке<input name="size" value="' + esc(p.size) + '"></label>' +
      '<label class="ea-field">Подпись количества в калькуляторе<input name="inputLabel" value="' + esc(p.inputLabel) + '"></label>' +
      '<label class="ea-field">Марка<input name="mark" value="' + esc(p.mark) + '"></label>' +
      '<label class="ea-field">Морозостойкость<input name="frost" value="' + esc(p.frost) + '"></label>' +
      '<label class="ea-field">Норма<input name="standard" value="' + esc(p.standard) + '"></label>' +
      '<label class="ea-field">Вес<input name="weight" value="' + esc(p.weight) + '"></label>' +
      '<label class="ea-field">Сколько в метре<input name="piecesLabel" value="' + esc(p.piecesLabel) + '"></label>' +
      '<label class="ea-field">Поддон<input name="pallet" value="' + esc(p.pallet) + '"></label>' +
      p.colors.map(function (color) {
        return '<label class="ea-field">Цвет «' + esc(color.name) + "»<input name=\"color-" + esc(color.id) + '" value="' + esc(color.name) + '"></label>';
      }).join("") +
      '<label class="ea-field">Цена, ₽ за ' + esc(p.unit) + '<input name="price" inputmode="decimal" value="' + esc(p.price) + '" required></label>' +
      '<label class="ea-field">Наличие<select name="stock">' + stocks.map(function (name) {
        return '<option' + (name === p.stock ? " selected" : "") + ">" + esc(name) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="ea-check"><input type="checkbox" name="popular"' + (p.popular ? " checked" : "") + "> Ходовой, выше в каталоге</label>" +
      '<label class="ea-check"><input type="checkbox" name="hidden"' + (p.hidden ? " checked" : "") + "> Скрыть с витрины</label>" +
      '<label class="ea-field">Фото фактуры<img class="ea-photo" id="admin-photo-preview" alt="Фото ' + esc(p.name) + '" src="' + esc(photoSrc(p.id)) + '">' +
      '<input id="admin-photo" name="photo" type="file" accept="image/*"></label>' +
      (photos[p.id]
        ? '<label class="ea-check"><input type="checkbox" name="dropPhoto"> Убрать загруженное и вернуть складской снимок</label>'
        : "") +
      '<p class="ea-note">На витрине снимок открывается переключателем «Фото». Цвет заказа по-прежнему красится только на модели.</p>' +
      '<button class="ea-btn" type="submit">Сохранить</button>' +
      '<p class="ea-error" id="admin-photo-error" hidden>Не удалось прочитать фото. Выберите другой файл.</p>' +
      '<p class="ea-note" id="admin-saved" hidden>Сохранено. В каталоге уже новые цена и фото.</p>' +
      "</form>";
    return shell("products", p.name, body);
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

  function html(parts) {
    if (!signedIn()) return loginHtml(false);
    var section = parts[1] || "dashboard";
    if (section === "orders" && parts[2]) return orderHtml(decodeURIComponent(parts[2]));
    if (section === "orders") return ordersHtml();
    if (section === "callbacks") return callbacksHtml();
    if (section === "products" && parts[2]) return productHtml(decodeURIComponent(parts[2]));
    if (section === "products") return productsHtml();
    if (section === "pages" && parts[2]) return pageCopyHtml(parts[2]);
    if (section === "pages") return pagesHtml();
    if (section === "settings") return settingsHtml();
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
        var ok = login.username.value.trim() === DEMO_LOGIN && login.password.value === DEMO_PASSWORD;
        if (!ok) {
          root.innerHTML = loginHtml(true);
          hook(root);
          return;
        }
        sessionStorage.setItem(SESSION_KEY, "1");
        if (location.hash !== "#/admin") location.hash = "#/admin";
        else repaint();
      });
    }
    var logout = root.querySelector("[data-admin=logout]");
    if (logout) {
      logout.addEventListener("click", function () {
        sessionStorage.removeItem(SESSION_KEY);
        repaint();
      });
    }
    root.querySelectorAll("[data-admin=status]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        setStatus(sel.dataset.lead, sel.value);
        repaint();
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
          var file = photoInput.files && photoInput.files[0];
          if (!file) return;
          var url = URL.createObjectURL(file);
          preview.src = url;
        });
      }
      productForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var id = productForm.dataset.id;
        var fields = productForm.elements;
        var file = fields.photo.files && fields.photo.files[0];
        var drop = fields.dropPhoto && fields.dropPhoto.checked && !file;
        var button = productForm.querySelector("button");
        var fail = productForm.querySelector("#admin-photo-error");
        if (button) button.disabled = true;
        if (fail) fail.hidden = true;
        var photoJob = Promise.resolve();
        if (file) photoJob = compressPhoto(file).then(function (blob) { return putPhoto(id, blob); });
        else if (drop) photoJob = deletePhoto(id);
        photoJob.then(function () {
          var patches = read(PRODUCT_KEY, {});
          if (!patches || typeof patches !== "object") patches = {};
          patches[id] = {
            name: fields.name.value.trim(),
            lead: fields.lead.value.trim(),
            usage: fields.usage.value.trim(),
            size: fields.size.value.trim(),
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
          Array.prototype.forEach.call(fields, function (field) {
            if (field.name && field.name.indexOf("color-") === 0 && field.value.trim()) {
              patches[id].colors[field.name.slice(6)] = field.value.trim();
            }
          });
          write(PRODUCT_KEY, patches);
          applyOverrides();
          if (button) button.disabled = false;
          if (file || drop) {
            repaint();
            var again = document.getElementById("admin-saved");
            if (again) again.hidden = false;
          } else {
            var note = document.getElementById("admin-saved");
            if (note) note.hidden = false;
          }
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
        var stored = read(SITE_KEY, {}) || {};
        var fields = siteForm.elements;
        stored.phone = fields.phone.value.trim();
        stored.hours = fields.hours.value.trim();
        stored.address = fields.address.value.trim();
        stored.delivery = stored.delivery || {};
        stored.delivery.city = Number(String(fields.city.value).replace(",", ".")) || 0;
        stored.delivery.near = Number(String(fields.near.value).replace(",", ".")) || 0;
        write(SITE_KEY, stored);
        applyOverrides();
        var note = document.getElementById("admin-saved");
        if (note) note.hidden = false;
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
        var patch = read(COPY_KEY, {}) || {};
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
        var note = document.getElementById("admin-saved");
        if (note) note.hidden = false;
      });
      var reset = root.querySelector("[data-admin=reset-copy]");
      if (reset) {
        reset.addEventListener("click", function () {
          var page = copyPage(copyForm.dataset.page);
          var patch = read(COPY_KEY, {}) || {};
          if (!page) return;
          page.fields.forEach(function (field) { delete patch[field[0]]; });
          write(COPY_KEY, patch);
          applyCopy();
          window.dispatchEvent(new Event("kd-copy"));
          repaint();
        });
      }
    }
  }

  window.KDAdmin = { html: html, hook: hook, photoSrc: photoSrc };
})();
