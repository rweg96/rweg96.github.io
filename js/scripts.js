(function () {
  'use strict';

  /* ----------------------------- Utilities ----------------------------- */
  class Dom {
    static $(sel, root = document) { return root.querySelector(sel); }
    static $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
    static make(tag, className = "", html = "") {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (html) el.innerHTML = html;
      return el;
    }
  }

  class Store {
    static getCart() {
      try { return JSON.parse(localStorage.getItem('cart')) || []; }
      catch { return []; }
    }
    static setCart(cart) { localStorage.setItem('cart', JSON.stringify(cart)); }
    static clearCart() { localStorage.removeItem('cart'); }

    // generic helpers (used by account)
    static get(key, fallback = null) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    }
    static set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
    static remove(key) { localStorage.removeItem(key); }
  }

  /* ------------------------------ Catalog ------------------------------ */
  class Catalog {
    static allProducts = [];

    static async load(csvPath = 'data/catalog.csv') {
      const grid = Dom.$('#catalog');
      if (!grid) return;

      try {
        const res = await fetch(csvPath);
        const text = await res.text();
        const lines = text.split('\n').slice(1);

        const products = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.split(',');
          const name = parts[0]?.trim();
          const price = parseFloat(parts[1]);
          const img = parts[2]?.trim();
          const category = parts[3]?.trim() || "Misc";
          if (!name || isNaN(price) || !img) continue;
          products.push({ name, price, img, category });
        }

        this.allProducts = products;
        this.render(products);
        this.populateCategories(products);
        this.bindToolbar();
      } catch (err) {
        console.log('Error loading products:', err);
      }
    }

    static render(list) {
      const grid = Dom.$('#catalog');
      if (!grid) return;
      grid.innerHTML = '';
      const frag = document.createDocumentFragment();

      list.forEach(({ name, price, img }) => {
        const col = Dom.make('div', 'col-md-3 col-sm-6 mb-4');
        col.innerHTML = `
          <div class="card shadow-sm h-100">
            <img src="${img}" class="card-img-top" alt="${name}" onerror="this.src='images/default.jpg';">
            <div class="card-body text-center">
              <h5>${name}</h5>
              <p>$${price.toFixed(2)}</p>
              <button class="btn btn-success btn-sm" data-action="add" data-name="${name}" data-price="${price}">
                Add to Cart
              </button>
            </div>
          </div>`;
        frag.appendChild(col);
      });

      grid.appendChild(frag);

      if (!grid._boundAddHandler) {
        grid.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action="add"]');
          if (!btn) return;
          const name = btn.getAttribute('data-name');
          const price = parseFloat(btn.getAttribute('data-price'));
          Cart.add(name, price);
          UI.updateCartCount();
        });
        grid._boundAddHandler = true;
      }
    }

    static populateCategories(products) {
      const select = Dom.$('#categoryFilter');
      if (!select) return;
      const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
      cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
      });
    }

    static bindToolbar() {
      const search = Dom.$('#searchInput');
      const catSel = Dom.$('#categoryFilter');
      const sortSel = Dom.$('#sortSelect');
      const handler = () => this.filterAndRender();
      [search, catSel, sortSel].forEach(el => el?.addEventListener('input', handler));
    }

    static filterAndRender() {
      const search = Dom.$('#searchInput')?.value.toLowerCase() || '';
      const cat = Dom.$('#categoryFilter')?.value || '';
      const sort = Dom.$('#sortSelect')?.value || 'name-asc';

      let filtered = this.allProducts.filter(p =>
        p.name.toLowerCase().includes(search) &&
        (cat ? p.category === cat : true)
      );

      switch (sort) {
        case 'price-asc': filtered.sort((a,b)=>a.price-b.price); break;
        case 'price-desc': filtered.sort((a,b)=>b.price-a.price); break;
        case 'name-desc': filtered.sort((a,b)=>b.name.localeCompare(a.name)); break;
        default: filtered.sort((a,b)=>a.name.localeCompare(b.name)); break;
      }

      this.render(filtered);
    }
  }

  /* -------------------------------- Cart -------------------------------- */
  class Cart {
    static add(name, price) {
      let cart = Store.getCart();
      let found = cart.find(i => i.name === name);
      if (found) found.quantity++;
      else cart.push({ name, price, quantity: 1 });
      Store.setCart(cart);
    }
    static changeQuantity(index, delta) {
      let cart = Store.getCart();
      if (!cart[index]) return;
      cart[index].quantity += delta;
      if (cart[index].quantity <= 0) cart.splice(index, 1);
      Store.setCart(cart);
    }
    static remove(index) {
      let cart = Store.getCart();
      cart.splice(index, 1);
      Store.setCart(cart);
    }
    static clear() { Store.clearCart(); }
    static count() { return Store.getCart().reduce((n, i) => n + i.quantity, 0); }
    static total() { return Store.getCart().reduce((s, i) => s + i.price * i.quantity, 0); }
    static items() { return Store.getCart(); }
  }

  /* -------------------------------- Coupons -------------------------------- */
  const coupons = [
    { code: "SAVE10", discount: 0.10, expires: "2025-12-31" },
    { code: "WELCOME5", discount: 0.05, expires: "2026-01-01" }
  ];

  let activeCoupon = null;

  function applyCoupon() {
    const input = document.getElementById("coupon-code");
    const message = document.getElementById("coupon-message");
    const enteredCode = input.value.trim().toUpperCase();
    const coupon = coupons.find(c => c.code === enteredCode);

    if (!coupon) {
      message.textContent = "❌ Invalid coupon code.";
      message.className = "text-danger small text-end";
      activeCoupon = null;
      updateCartTotal();
      return;
    }

    const today = new Date();
    const expiry = new Date(coupon.expires);
    if (today > expiry) {
      message.textContent = "⚠️ This coupon has expired.";
      message.className = "text-warning small text-end";
      activeCoupon = null;
      updateCartTotal();
      return;
    }

    activeCoupon = coupon;
    message.textContent = `✅ Coupon "${coupon.code}" applied successfully!`;
    message.className = "text-success small text-end";
    updateCartTotal();
  }

  function removeCoupon() {
    activeCoupon = null;
    const message = document.getElementById("coupon-message");
    message.textContent = "Coupon removed.";
    message.className = "text-muted small text-end";
    updateCartTotal();
  }

  function updateCartTotal() {
    const totalElement = document.getElementById("cart-total");
    let total = Cart.total();
    if (activeCoupon) {
      const discount = total * activeCoupon.discount;
      total -= discount;
    }
    if (totalElement) totalElement.textContent = total.toFixed(2);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const applyBtn = document.getElementById("apply-coupon");
    const removeBtn = document.getElementById("remove-coupon");
    if (applyBtn) applyBtn.addEventListener("click", applyCoupon);
    if (removeBtn) removeBtn.addEventListener("click", removeCoupon);
    updateCartTotal();
  });

  // -------------------------------- Checkout Logic --------------------------------
  function checkout() {
    let total = Cart.total();
    if (activeCoupon) {
      const discount = total * activeCoupon.discount;
      total -= discount;
    }

    alert(`✅ Checkout complete!\nFinal total: $${total.toFixed(2)}`);

    // rewards
    const pointsEarned = Math.floor(total / 10);
    const user = JSON.parse(localStorage.getItem('bb_user')) || null;
    if (user) {
      user.rewards = (user.rewards || 0) + pointsEarned;
      localStorage.setItem('bb_user', JSON.stringify(user));
      console.log(`🏆 ${pointsEarned} points earned! Total rewards: ${user.rewards}`);
    }

    Cart.clear();
    UI.renderCartTable("cart-items", "cart-total");
    UI.updateCartCount();
    updateCartTotal();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const checkoutBtn = document.getElementById("checkout-btn");
    if (checkoutBtn) checkoutBtn.addEventListener("click", checkout);
  });

  /* --------------------------------- UI --------------------------------- */
  class UI {
    static updateCartCount() {
      const badge = Dom.$('#cart-count');
      if (badge) badge.textContent = Cart.count();
    }

    static renderCartTable(itemsId = 'cart-items', totalId = 'cart-total') {
      const tbody = Dom.$('#' + itemsId);
      const totalEl = Dom.$('#' + totalId);
      if (!tbody || !totalEl) return;

      const cart = Cart.items();
      tbody.innerHTML = '';
      let total = 0;

      cart.forEach((item, i) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const tr = Dom.make('tr');
        tr.innerHTML =
          '<td>' + item.name + '</td>' +
          '<td>' +
            '<button class="btn btn-sm btn-outline-secondary" data-action="dec" data-index="' + i + '">-</button> ' +
            item.quantity +
            ' <button class="btn btn-sm btn-outline-secondary" data-action="inc" data-index="' + i + '">+</button>' +
          '</td>' +
          '<td>$' + item.price.toFixed(2) + '</td>' +
          '<td>$' + itemTotal.toFixed(2) + '</td>' +
          '<td><button class="btn btn-danger btn-sm" data-action="remove" data-index="' + i + '">Remove</button></td>';
        tbody.appendChild(tr);
      });

      totalEl.textContent = total.toFixed(2);

      if (!tbody._boundCartHandler) {
        tbody.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          const action = btn.getAttribute('data-action');
          const index = parseInt(btn.getAttribute('data-index'));
          if (Number.isNaN(index)) return;

          if (action === 'dec') Cart.changeQuantity(index, -1);
          else if (action === 'inc') Cart.changeQuantity(index, +1);
          else if (action === 'remove') Cart.remove(index);

          UI.renderCartTable(itemsId, totalId);
          UI.updateCartCount();
        });
        tbody._boundCartHandler = true;
      }
    }
  }

  /* --------------------------- Account (View/Edit) --------------------------- */
  class UserAuth {
    static key = 'bb_user';
    static sessionKey = 'bb_session'; // NEW
    static get() {
      try { return JSON.parse(localStorage.getItem(this.key)) || null; }
      catch { return null; }
    }
    static save(u)  { localStorage.setItem(this.key, JSON.stringify(u)); }
    static update(patch) {
      const u = this.get() || {};
      const next = { ...u, ...patch };
      this.save(next);
      return next;
    }
    static del()    { localStorage.removeItem(this.key); }
    static isLoggedIn() { return !!this.get(); }
    static login()  { try { sessionStorage.setItem(this.sessionKey, '1'); } catch(_){} }           // NEW
    static logout() { try { sessionStorage.removeItem(this.sessionKey); } catch(_){} }             // NEW
    static isSessionActive() { try { return !!sessionStorage.getItem(this.sessionKey); } catch(_) { return false; } } // NEW
  }

  // NEW: small UI guard to hide/scrub on logout (safe no-ops if markup not present)
  class AuthUI {
    static refresh() {
      const session = UserAuth.isSessionActive();
      const hasUser = !!UserAuth.get();
      const isLoggedIn = session && hasUser;

      Dom.$all('[data-auth="require"]').forEach(el => el.classList.toggle('d-none', !isLoggedIn));
      Dom.$all('[data-auth="guest"]').forEach(el => el.classList.toggle('d-none',  isLoggedIn));

      if (!isLoggedIn) this.scrubSensitive();
    }
    static scrubSensitive() {
      ['#fullName','#email','#password','#address','#billing'].forEach(sel => {
        const el = Dom.$(sel);
        if (el) el.value = '';
      });
      Dom.$all('[data-user-text]').forEach(el => { el.textContent = ''; });
    }
  }

  class AccountPage {
    static form() { return Dom.$('#registerForm') || Dom.$('#accountForm'); }

    static populate() {
      const f = this.form(); if (!f) return;

      const u = UserAuth.get();
      const session = UserAuth.isSessionActive();

      if (!u || !session) {
        // Logged out OR no user: show Create mode & blank fields
        ['#fullName','#email','#password','#address','#billing'].forEach(sel => {
          const el = Dom.$(sel); if (el) el.value = '';
        });
        Dom.$('#deleteAccount')?.classList.add('d-none');
        const h = Dom.$('#accountHeading'); if (h) h.textContent = 'Create Your Account';
        const submit = f.querySelector('[type="submit"]'); if (submit) submit.textContent = 'Create Account';
        return;
      }

      // Logged in: show Edit UI with values
      const setIf = (id, v) => { const el = Dom.$(id); if (el) el.value = v ?? ''; };
      setIf('#fullName', u.fullName);
      setIf('#email',    u.email);
      setIf('#password', u.password);
      setIf('#address',  u.address);
      setIf('#billing',  u.billing);

      const h = Dom.$('#accountHeading'); if (h) h.textContent = 'Edit Account';
      const submit = f.querySelector('[type="submit"]'); if (submit) submit.textContent = 'Save Changes';
      Dom.$('#deleteAccount')?.classList.remove('d-none');
    }

    static resetToCreate() { // NEW
      const f = this.form(); if (!f) return;
      ['#fullName','#email','#password','#address','#billing'].forEach(sel => {
        const el = Dom.$(sel); if (el) el.value = '';
      });
      Dom.$('#deleteAccount')?.classList.add('d-none');
      const h = Dom.$('#accountHeading'); if (h) h.textContent = 'Create Your Account';
      const submit = f.querySelector('[type="submit"]'); if (submit) submit.textContent = 'Create Account';
    }

    static bind() {
      const f = this.form(); if (!f) return;

      const delBtn = Dom.$('#deleteAccount');
      if (delBtn) delBtn.classList.toggle('d-none', !UserAuth.get());

      f.addEventListener('submit', (e) => {
        e.preventDefault();

        const val = (id) => Dom.$(id)?.value?.trim() || '';
        const fullName = val('#fullName');
        const email    = val('#email');
        const password = val('#password');
        const address  = val('#address');
        const billing  = val('#billing');

        if (!fullName || !email || !password) {
          alert('Name, email, and password are required.');
          return;
        }

        if (UserAuth.isLoggedIn()) {
          UserAuth.update({ fullName, email, password, address, billing });
          UserAuth.login();                // NEW
          AuthUI.refresh();                // NEW
          alert('Account updated.');
          NavbarUser.render();
        } else {
          UserAuth.save({
            id: 'u-' + Math.random().toString(36).slice(2,8),
            fullName, email, password, address, billing
          });
          UserAuth.login();                // NEW
          AuthUI.refresh();                // NEW
          alert('Account created.');
          NavbarUser.render();
          this.populate();
        }
      });

      if (delBtn) {
        delBtn.addEventListener('click', () => {
          if (!confirm('Delete your account? This cannot be undone.')) return;
          UserAuth.del();
          UserAuth.logout();               // NEW
          AuthUI.refresh();                // NEW
          alert('Account deleted.');
          NavbarUser.render();
          this.resetToCreate();            // NEW
        });
      }

      // Account-page logout button (exists only if you added it in HTML)
      const logoutBtn = Dom.$('#logoutAccount');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          UserAuth.logout();               // NEW
          AuthUI.refresh();                // NEW
          alert('Logged out.');
          NavbarUser.render();
          this.resetToCreate();            // NEW
        });
      }
    }
  }

  /* ------------------------------ Navbar User ------------------------------ */
  class NavbarUser {
  static mount() {
  const navRight = document.querySelector('.navbar .navbar-nav.ms-auto');
  if (!navRight) return;

  // status slot (make it flex-centered)
  if (!document.getElementById('nav-user-status')) {
    const li = document.createElement('li');
    li.id = 'nav-user-status';
    li.className = 'nav-item ms-2 d-flex align-items-center'; // centered
    li.innerHTML = '<span class="nav-link small py-0"></span>'; // tighter line-height
    navRight.insertBefore(li, navRight.firstChild);
  }

  // logout button (also flex-centered)
  if (!document.getElementById('nav-logout')) {
    const li = document.createElement('li');
    li.id = 'nav-logout';
    li.className = 'nav-item ms-2 d-none d-flex align-items-center'; // centered + hidden by default
    li.innerHTML = '<button class="btn btn-outline-light btn-sm py-0" type="button">Logout</button>';

    const statusLi = document.getElementById('nav-user-status');
    if (statusLi) navRight.insertBefore(li, statusLi.nextSibling);

    li.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      UserAuth.logout();
      AuthUI.refresh();
      NavbarUser.render();
      if (AccountPage.form()) AccountPage.resetToCreate();
      // optional: location.href = 'index.html';
    });
  }

  this.render();
}


    static render() {
      const slot = document.querySelector('#nav-user-status .nav-link');
      const logoutLi = document.getElementById('nav-logout');
      if (!slot) return;

      const u = (typeof UserAuth !== 'undefined') ? UserAuth.get() : null;
      const session = (typeof UserAuth !== 'undefined') ? UserAuth.isSessionActive() : false;

      slot.textContent = (u && session) ? `Logged in as ${u.email}` : '';
      if (logoutLi) logoutLi.classList.toggle('d-none', !(u && session));
    }
  }

  /* -------------------------------- App --------------------------------- */
  class App {
    static init() {
      Catalog.load('data/catalog.csv');
      UI.updateCartCount();
      if (Dom.$('#cart-items')) {
        UI.renderCartTable('cart-items', 'cart-total');
      }
      NavbarUser.mount();
      NavbarUser.render();

      if (AccountPage.form()) { AccountPage.bind(); AccountPage.populate(); }

      Dom.$all('[data-clear-cart]').forEach(btn => {
        btn.addEventListener('click', () => {
          Cart.clear();
          UI.renderCartTable('cart-items', 'cart-total');
          UI.updateCartCount();
        });
      });

      AuthUI.refresh(); // NEW: ensure correct state on first paint
    }
  }

  window.addEventListener('DOMContentLoaded', App.init);

  /* -------------------------------- Lists - Creation/Edit/Deletion --------------------------------- */
  class ShoppingList {
    constructor(name) {
      this.name = name;
      this.items = [];
      this.dateCreated = new Date();
    }

    getInfo() {
      return `${this.name} (Created: ${this.dateCreated.toLocaleString()})`;
    }
  }

  // Renders list management (add/del/edit)
  class ListManager {
    constructor(containerId) {
      this.lists = [];
      this.container = document.getElementById(containerId);
    }

    addList(name) {
      if (!name.trim()) return alert("Name your list:");
      const list = new ShoppingList(name);
      this.lists.push(list);
      this.render();
    }

    deleteList(index) {
      this.lists.splice(index, 1);
      this.render();
    }

    render() {
      this.container.innerHTML = "";

      this.lists.forEach((list, index) => {
        const li = document.createElement("li");
        li.className = "list-group-item";

        const listHeader = document.createElement("div");
        listHeader.className = "d-flex justify-content-between align-items-center mb-2";
        listHeader.innerHTML = `<strong>${list.name}</strong><br><small class="text-muted">${list.dateCreated.toLocaleString()}</small>`;

        const actions = document.createElement("div");

        const editBtn = document.createElement("button");
        editBtn.className = "btn btn-sm btn-primary me-2";
        editBtn.innerHTML = '<i class="bi bi-pencil-fill"></i>';
        editBtn.addEventListener("click", () => this.editList(index));
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn-sm btn-danger";
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i>';
        deleteBtn.addEventListener("click", () => this.deleteList(index));
        actions.appendChild(deleteBtn);

        listHeader.appendChild(actions);
        li.appendChild(listHeader);

        if (list.items.length > 0) {
          const ul = document.createElement("ul");
          ul.className = "list-group list-group-flush";
          list.items.forEach(item => {
            const itemLi = document.createElement("li");
            itemLi.className = "list-group-item py-1";
            itemLi.textContent = item;
            ul.appendChild(itemLi);
          });
          li.appendChild(ul);
        }

        this.container.appendChild(li);
      });
    }
  }

  // Page load + opens modal, creating + editing lists
  document.addEventListener("DOMContentLoaded", () => {
    const manager = new ListManager("listsContainer");

    const openModalBtn = document.getElementById("openCreateListBtn");
    const saveListBtn = document.getElementById("saveListBtn");
    const listModal = new bootstrap.Modal(document.getElementById("listModal"));
    const listNameInput = document.getElementById("listNameInput");
    const listItemsInput = document.getElementById("listItemsInput");

    let editIndex = null;

    openModalBtn.addEventListener("click", () => {
      editIndex = null;
      listNameInput.value = "";
      listItemsInput.value = "";
      document.getElementById("listModalLabel").textContent = "Create New List";
      saveListBtn.textContent = "Create";
      listModal.show();
    });

    saveListBtn.addEventListener("click", () => {
      const name = listNameInput.value.trim();
      const items = listItemsInput.value
        .split("\n")
        .map(i => i.trim())
        .filter(i => i);

      if (!name) return alert("Please enter a list name");

      if (editIndex !== null) {

        const list = manager.lists[editIndex];
        list.name = name;
        list.items = items;
      } else {

        const list = new ShoppingList(name);
        list.items = items;
        manager.lists.push(list);
      }

      manager.render();
      listModal.hide();
    });

    // Opens modal for list editing
    ListManager.prototype.editList = function(index) {
      const list = this.lists[index];
      editIndex = index;
      listNameInput.value = list.name;
      listItemsInput.value = list.items.join("\n");
      document.getElementById("listModalLabel").textContent = "Edit List";
      saveListBtn.textContent = "Save Changes";
      listModal.show();
    };
  });

  /* ------------------Homepage stuff ---------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    const user = JSON.parse(localStorage.getItem('bb_user')) || null;
    const rewardsSec = document.getElementById("rewardsSection");
    const rewardsDisplay = document.getElementById("rewardPoints");

    // Show rewards if logged in (account exists)
    if (user) {
      rewardsSec?.classList.remove('d-none');
      if (rewardsDisplay) rewardsDisplay.textContent = user.rewards || 0;
    }

    // Load featured items
    const featured = document.getElementById("featuredItems");
    if (featured) {
      fetch('data/catalog.csv')
        .then(r => r.text())
        .then(text => {
          const rows = text.split('\n').slice(1);
          const products = rows
            .map(line => line.split(','))
            .filter(p => p.length >= 3)
            .map(p => ({
              name: p[0].trim(),
              price: parseFloat(p[1]),
              img: p[2].trim()
            }))
            .filter(p => p.name && !isNaN(p.price) && p.img);

          // Pick a few random products
          const sample = products.sort(() => 0.5 - Math.random()).slice(0, 4);

          featured.innerHTML = sample.map(({ name, price, img }) => `
            <div class="col-md-3 col-sm-6 mb-4">
              <div class="card shadow-sm h-100">
                <img src="${img}" class="card-img-top" alt="${name}" onerror="this.src='images/default.jpg';">
                <div class="card-body text-center">
                  <h6>${name}</h6>
                  <p>$${price.toFixed(2)}</p>
                  <button class="btn btn-success btn-sm" data-name="${name}" data-price="${price}">
                    Add to Cart
                  </button>
                </div>
              </div>
            </div>`).join('');

          // Handle Add to Cart button clicks
          featured.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-name]");
            if (!btn) return;

            const name = btn.getAttribute("data-name");
            const price = parseFloat(btn.getAttribute("data-price"));

            Cart.add(name, price);
            UI.updateCartCount();
          });
        })
        .catch(err => console.error("Error loading featured items:", err));
    }

    const couponContainer = document.getElementById("couponSection");
    if (couponContainer) {
      const availableCoupons = [
        { code: "SAVE10", discount: 10, description: "10% off your entire order (expires 12/31/2025)" },
        { code: "WELCOME5", discount: 5, description: "5% off for new shoppers (expires 01/01/2026)" }
      ];

      couponContainer.innerHTML = availableCoupons.map(coupon => `
        <div class="col-md-4 col-sm-6 mb-4">
          <div class="card shadow-sm h-100 border-success">
            <div class="card-body text-center">
              <h5 class="text-success mb-2">${coupon.code}</h5>
              <p class="mb-1">${coupon.description}</p>
              <span class="badge bg-success">${coupon.discount}% OFF</span>
            </div>
          </div>
        </div>
      `).join('');
    }
  });

})();
