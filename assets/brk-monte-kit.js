/* BRK — Monte seu Kit (sections/brk-monte-kit.liquid)
 *
 * Etapas: 1 público → 2 camisa (+tamanho) → 3 botina (+numeração) → 4 extras (opcional) → 5 resumo.
 * - Camisas vêm de /collections/<handle>/products.json (paginado, só disponíveis).
 * - Botinas e extras vêm do JSON da seção.
 * - Preço do kit exibido = camisa + botina − desconto do grupo da botina. O desconto real é
 *   um desconto automático da Shopify; aqui só mostra.
 * - Adiciona tudo num /cart/add.js; camisa e botina levam a property `_kit`.
 * - Clarity: eventos `kit_<acao>`.
 */
(() => {
  if (customElements.get("brk-monte-kit")) return;

  const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = (cents) => BRL.format((cents || 0) / 100);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clarity = (name) => {
    try { if (typeof window.clarity === "function") window.clarity("event", "kit_" + name); } catch (_) {}
  };
  const sized = (src, w) => {
    if (!src) return "";
    try {
      const u = new URL(src, window.location.origin);
      u.searchParams.set("width", w);
      return u.toString();
    } catch (_) { return src; }
  };

  // /products.json → mesmo formato do snippet brk-monte-kit-product-json
  const fromStorefront = (p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    type: p.product_type || "",
    url: "/products/" + p.handle,
    image: p.images?.[0]?.src || null,
    image2: p.images?.[1]?.src || null,
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      title: v.title,
      available: !!v.available,
      price: Math.round(parseFloat(v.price) * 100),
      compare: v.compare_at_price ? Math.round(parseFloat(v.compare_at_price) * 100) : 0,
    })),
  });
  const minPrice = (p) => {
    const av = p.variants.filter((v) => v.available);
    return Math.min(...(av.length ? av : p.variants).map((v) => v.price));
  };
  const isAvailable = (p) => p.variants.some((v) => v.available);
  // ícones de traço (24x24) para a barra
  const ICON_PATH = {
    shirt: '<path d="M8.5 3.5 4 5.8 2.5 10l3 1.4 1-2.1V20.5h11V9.3l1 2.1 3-1.4L20 5.8l-4.5-2.3"/><path d="M8.5 3.5c.6 1.6 1.9 2.5 3.5 2.5s2.9-.9 3.5-2.5"/><path d="M12 6v5"/>',
    boot: '<path d="M6.4 2.6c2.3.6 4.4.6 6.6 0l.3 7.9c2.4.8 4.9 2 6.7 3.4 1 .8 1.5 1.8 1.5 2.8V18H5.2c0-5.4.4-10.6 1.2-15.4z"/><path d="M6.2 5.4c2.4.6 4.6.6 6.9 0"/><path d="M5.2 18v2.6h3.9V18"/><path d="M9.1 19.5h11.6c.6 0 1-.4 1-1V18"/>',
    pants: '<path d="M6.5 3.5h11l1.2 17h-4.4L12 10l-2.3 10.5H5.3z"/><path d="M6.5 6.5h11M12 3.5v6.5"/>',
    glasses: '<path d="M2.5 10.5h19"/><path d="M3 10.5c0 3.2 1.4 5 4 5s3.8-1.8 3.8-5M13.2 10.5c0 3.2 1.4 5 3.8 5s4-1.8 4-5"/><path d="M10.8 11.2c.8-.6 1.6-.6 2.4 0"/>',
    cap: '<path d="M4 15.5c0-5 3.6-9 8-9s8 4 8 9"/><path d="M4 15.5h16.5c.9 0 1.5.7 1.5 1.5H4z"/><path d="M12 6.5v3M9.5 7.2c-.8 2-1.2 4.8-1.2 8.3"/>',
    bag: '<path d="M5 8h14l-1 12.5H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON_PATH[k] || ICON_PATH.bag}</svg>`;
  const iconFor = (title) =>
    /cal[çc]a/i.test(title) ? "pants" : /[óo]culos/i.test(title) ? "glasses" : /bon[ée]|chap[ée]u/i.test(title) ? "cap" : "bag";
  // coleções de "mais vendidos" etc. podem trazer boné/botina/kit: na etapa da camisa só entra camisa
  const NOT_SHIRT = /botina|bota|bon[eé]|chap[eé]u|kit|[oó]culos|cinto|bandana|meia|cal[çc]a|faca|fivela|pingente/i;
  const isShirt = (p) => !NOT_SHIRT.test(p.type) && !NOT_SHIRT.test(p.title);

  class BrkMonteKit extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.cfg = JSON.parse(this.querySelector("[data-bmk-config]").textContent);
      this.t = this.cfg.text;
      this.extras = (this.cfg.upsell.extras || []).filter((e) => e.products.length);
      this.hasUpsell = !!(this.cfg.upsell.enabled && this.extras.length);
      this.steps = this.hasUpsell ? [1, 2, 3, 4, 5] : [1, 2, 3, 5];
      if (!this.hasUpsell) {
        this.querySelector('[data-bmk-step-dot="4"]')?.remove();
        this.querySelector('[data-bmk-panel="4"]')?.remove();
        const last = this.querySelector('[data-bmk-step-dot="5"] .bmk__step-num');
        if (last) last.textContent = "4";
      }
      this.state = { step: 1, gender: null, shirt: null, boot: null, upsell: new Map() };
      this.shirtCache = new Map(); // handle -> {items, page, done}
      this.shirtIndex = new Map(); // product id -> product
      this.$ = (sel) => this.querySelector(sel);

      this.addEventListener("click", (e) => this.onClick(e));
      this.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.closeSheet();
      });
      this.render();
    }

    /* ---------- navegação ---------- */
    onClick(e) {
      const t = e.target.closest("button, [data-bmk-sheet-close]");
      if (!t || !this.contains(t)) return;
      const d = t.dataset;
      if (d.bmkGender) return this.pickGender(d.bmkGender);
      if (d.bmkGoto) return this.goto(+d.bmkGoto);
      if (d.bmkChip !== undefined) return this.selectChip(d.bmkChip);
      if (t.hasAttribute("data-bmk-more")) return this.loadShirts(this.activeHandle, true);
      if (d.bmkShirt) return this.openSheet("shirt", this.shirtIndex.get(+d.bmkShirt));
      if (d.bmkBoot) return this.openBoot(d.bmkBootGroup, +d.bmkBoot);
      if (d.bmkExtra) return this.toggleExtra(d.bmkExtra);
      if (d.bmkRail) {
        const rail = t.parentElement.querySelector(".bmk__carousel");
        if (rail) rail.scrollBy({ left: +d.bmkRail * rail.clientWidth * 0.8, behavior: "smooth" });
        return;
      }
      if (d.bmkUp) return this.openSheet("upsell", this.extras.flatMap((e) => e.products).find((p) => p.id === +d.bmkUp));
      if (d.bmkUpRemove) { this.state.upsell.delete(+d.bmkUpRemove); clarity("extra_remover"); return this.render(); }
      if (d.bmkSize) return this.pickSize(+d.bmkSize);
      if (t.hasAttribute("data-bmk-sheet-close")) return this.closeSheet();
      if (t.hasAttribute("data-bmk-sheet-confirm")) return this.confirmSheet();
      if (t.hasAttribute("data-bmk-next")) return this.next();
      if (t.hasAttribute("data-bmk-back")) return this.back();
      if (t.hasAttribute("data-bmk-add")) return this.addToCart();
      if (d.bmkEdit) return this.goto(+d.bmkEdit);
    }

    canEnter(step) {
      const s = this.state;
      if (step <= 1) return true;
      if (step === 2) return !!s.gender;
      if (step === 3) return !!s.shirt;
      return !!s.boot; // 4 e 5
    }
    goto(step) {
      if (!this.steps.includes(step) || !this.canEnter(step)) return;
      this.state.step = step;
      clarity("etapa_" + step);
      this.render();
      const top = this.getBoundingClientRect().top + window.scrollY - 90;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
    }
    next() {
      const i = this.steps.indexOf(this.state.step);
      if (i < this.steps.length - 1) this.goto(this.steps[i + 1]);
    }
    back() {
      const i = this.steps.indexOf(this.state.step);
      if (i > 0) this.goto(this.steps[i - 1]);
    }

    pickGender(g) {
      if (this.state.gender !== g) {
        this.state.gender = g;
        this.state.shirt = null;
        this.state.boot = null;
        this.activeHandle = null;
      }
      clarity("publico_" + g);
      this.goto(2);
    }

    /* ---------- preço ---------- */
    bootGroups() {
      return this.cfg.bootGroups.filter((g) => g.gender === this.state.gender);
    }
    kitPrice(shirtCents, bootCents, discount) {
      return Math.max(0, shirtCents + bootCents - discount);
    }
    totals() {
      const s = this.state;
      let full = 0, pay = 0;
      if (s.shirt) { full += s.shirt.variant.price; pay += s.shirt.variant.price; }
      if (s.boot) { full += s.boot.variant.price; pay += s.boot.variant.price; }
      if (s.shirt && s.boot) pay -= s.boot.group.discount;
      s.upsell.forEach((u) => { full += u.variant.price; pay += u.variant.price; });
      return { full, pay: Math.max(0, pay) };
    }

    /* ---------- render ---------- */
    render() {
      const s = this.state;
      this.dataset.step = s.step;
      this.querySelectorAll("[data-bmk-panel]").forEach((p) => (p.hidden = +p.dataset.bmkPanel !== s.step));
      // barra de progresso
      const idx = this.steps.indexOf(s.step);
      this.$("[data-bmk-fill]").style.width = (idx / (this.steps.length - 1)) * 100 + "%";
      this.querySelectorAll("[data-bmk-step-dot]").forEach((li) => {
        const n = +li.dataset.bmkStepDot;
        const i = this.steps.indexOf(n);
        li.classList.toggle("is-active", n === s.step);
        li.classList.toggle("is-done", i < idx || (n !== s.step && this.isDone(n)));
        li.querySelector("button").disabled = !this.canEnter(n);
      });
      if (s.step === 2) this.renderShirtStep();
      if (s.step === 3) this.renderBoots();
      if (s.step === 4) this.renderUpsell();
      if (s.step === 5) this.renderSummary();
      this.renderBar();
    }
    isDone(n) {
      const s = this.state;
      return (n === 1 && s.gender) || (n === 2 && s.shirt) || (n === 3 && s.boot) || (n === 4 && s.boot && s.step === 5);
    }

    renderBar() {
      const s = this.state;
      const bar = this.$("[data-bmk-bar]");
      bar.hidden = s.step === 1 || s.step === 5;
      document.documentElement.classList.toggle("bmk-bar-on", !bar.hidden);
      if (bar.hidden) return;
      const { full, pay } = this.totals();
      const slot = (ico, label, item, extra = false) => {
        const size = item && item.product.variants.length > 1 && item.variant.title.length <= 3 ? item.variant.title : "";
        return `<span class="bmk__slot${item ? " is-on" : ""}${extra ? " is-extra" : ""}" title="${esc(label)}${size ? " " + esc(size) : ""}">
          ${icon(ico)}${extra ? "" : item && size ? `<i>${esc(size)}</i>` : item ? `<i>✓</i>` : ""}
          <span class="visually-hidden">${esc(label)}</span>
        </span>`;
      };
      let slots = slot("shirt", "Camisa", s.shirt) + slot("boot", "Botina", s.boot);
      let stack = "";
      s.upsell.forEach((u, id) => {
        const cat = this.extras.find((e) => e.products.some((p) => p.id === id));
        stack += slot(iconFor(cat ? cat.title : u.product.title), cat ? cat.title : "Extra", u, true);
      });
      if (stack) slots += `<span class="bmk__slot-stack">${stack}</span>`;
      this.$("[data-bmk-bar-picks]").innerHTML = `
        <span class="bmk__bar-items">${slots}</span>
        <span class="bmk__bar-total">${full !== pay ? `<s>${money(full)}</s>` : ""}<strong>${full ? money(pay) : "R$ 0,00"}</strong>${full !== pay ? `<em>kit com desconto</em>` : ""}</span>`;
      this.$("[data-bmk-bar-price]").innerHTML = "";

      const next = this.$("[data-bmk-next]");
      const i = this.steps.indexOf(s.step);
      next.hidden = s.step === 5;
      next.disabled = !this.canEnter(this.steps[i + 1]);
      this.nextLabel ??= next.textContent.trim();
      next.textContent = s.step === 4 && !s.upsell.size ? "Pular" : this.nextLabel;
    }

    /* ---------- etapa 2: camisas ---------- */
    renderShirtStep() {
      const g = this.state.gender;
      const filters = this.cfg.filters.filter((f) => f.gender === g);
      const all = this.cfg.shirtCollections[g];
      const chips = filters.map((f) => ({ label: f.label, handle: f.handle }));
      if (all) chips.push({ label: this.cfg.allLabel || "Todas", handle: all });
      this.chips = chips;
      if (!this.activeHandle || !chips.some((c) => c.handle === this.activeHandle)) {
        this.activeHandle = chips[0]?.handle || null;
      }
      this.$("[data-bmk-chips]").innerHTML = chips
        .map(
          (c, i) =>
            `<button type="button" role="tab" class="bmk__chip${c.handle === this.activeHandle ? " is-active" : ""}" aria-selected="${c.handle === this.activeHandle}" data-bmk-chip="${i}">${esc(c.label)}</button>`
        )
        .join("");
      if (!this.activeHandle) {
        this.$("[data-bmk-shirts]").innerHTML = `<p class="bmk__empty">${esc(this.t.empty)}</p>`;
        return;
      }
      const cache = this.shirtCache.get(this.activeHandle);
      if (cache) this.paintShirts();
      else this.loadShirts(this.activeHandle, false);
    }
    selectChip(i) {
      const c = this.chips?.[+i];
      if (!c) return;
      this.activeHandle = c.handle;
      clarity("filtro_" + c.handle);
      this.renderShirtStep();
    }
    async loadShirts(handle, more) {
      if (!handle) return;
      let cache = this.shirtCache.get(handle);
      if (!cache) { cache = { items: [], page: 0, done: false, loading: false }; this.shirtCache.set(handle, cache); }
      if (cache.loading || cache.done) return;
      cache.loading = true;
      const grid = this.$("[data-bmk-shirts]");
      if (!more) grid.innerHTML = Array.from({ length: 8 }, () => `<div class="bmk__card is-skeleton"><div class="bmk__card-media"></div><div class="bmk__card-body"><span></span><span></span></div></div>`).join("");
      const moreBtn = this.$("[data-bmk-more]");
      moreBtn.classList.add("is-loading");
      try {
        const per = this.cfg.perPage || 24;
        // a coleção pode ter muitos esgotados: busca até juntar uma página de disponíveis
        let added = 0;
        while (added < per && !cache.done) {
          cache.page += 1;
          const r = await fetch(`/collections/${encodeURIComponent(handle)}/products.json?limit=${per}&page=${cache.page}`);
          if (!r.ok) throw new Error("HTTP " + r.status);
          const { products } = await r.json();
          if (!products.length || products.length < per) cache.done = true;
          products.map(fromStorefront).filter((p) => isAvailable(p) && isShirt(p)).forEach((p) => {
            if (cache.items.some((x) => x.id === p.id)) return;
            cache.items.push(p);
            this.shirtIndex.set(p.id, p);
            added++;
          });
        }
      } catch (err) {
        console.error("[brk-monte-kit] camisas", err);
        cache.page = Math.max(0, cache.page - 1);
      } finally {
        cache.loading = false;
        moreBtn.classList.remove("is-loading");
      }
      if (this.activeHandle === handle && this.state.step === 2) this.paintShirts();
    }
    paintShirts() {
      const cache = this.shirtCache.get(this.activeHandle);
      const grid = this.$("[data-bmk-shirts]");
      const sel = this.state.shirt?.product.id;
      // menor desconto do público = preço "a partir de" mais honesto
      const groups = this.bootGroups();
      const cheapest = groups.length
        ? Math.min(...groups.flatMap((g) => g.products.filter(isAvailable).map((b) => minPrice(b) - g.discount)))
        : null;
      grid.innerHTML = cache.items.length
        ? cache.items
            .map((p) => {
              const price = minPrice(p);
              const from = cheapest !== null && isFinite(cheapest) ? `<span class="bmk__card-kit">${esc(this.t.from)} <b>${money(price + cheapest)}</b></span>` : "";
              return `<button type="button" class="bmk__card${p.id === sel ? " is-selected" : ""}" data-bmk-shirt="${p.id}">
                <span class="bmk__card-media">
                  <img src="${esc(sized(p.image, 500))}" alt="${esc(p.title)}" loading="lazy" width="500" height="625">
                  ${p.image2 ? `<img class="bmk__card-alt" src="${esc(sized(p.image2, 500))}" alt="" loading="lazy" width="500" height="625">` : ""}
                  ${p.id === sel ? `<span class="bmk__card-check">✓ ${esc(this.state.shirt.variant.title)}</span>` : ""}
                </span>
                <span class="bmk__card-body">
                  <span class="bmk__card-title">${esc(p.title)}</span>
                  <span class="bmk__card-price">${money(price)}</span>
                  ${from}
                </span>
              </button>`;
            })
            .join("")
        : `<p class="bmk__empty">${esc(this.t.empty)}</p>`;
      this.$("[data-bmk-more]").hidden = cache.done;
    }

    /* ---------- etapa 3: botinas ---------- */
    renderBoots() {
      const shirt = this.state.shirt;
      const sel = this.state.boot;
      this.$("[data-bmk-boots]").innerHTML = this.bootGroups()
        .map((g) => {
          const items = g.products.filter(isAvailable);
          if (!items.length) return "";
          return `<div class="bmk__group">
            <div class="bmk__group-head">
              <h3>${esc(g.title)} <span class="bmk__group-count">${items.length}</span></h3>
              ${g.text ? `<p>${esc(g.text)}</p>` : ""}
            </div>
            <div class="bmk__grid bmk__grid--rail">
              ${items
                .map((b) => {
                  const price = minPrice(b);
                  const kit = shirt ? this.kitPrice(shirt.variant.price, price, g.discount) : null;
                  const isSel = sel && sel.product.id === b.id;
                  const sizesOk = b.variants.filter((v) => v.available).length;
                  const scene = this.cfg.bootPhoto === "scene" && b.scene;
                  const main = scene ? b.scene : b.image;
                  const alt = scene ? b.image : b.image2;
                  return `<button type="button" class="bmk__card bmk__card--boot${scene ? " is-scene" : ""}${isSel ? " is-selected" : ""}" data-bmk-boot="${b.id}" data-bmk-boot-group="${esc(g.id)}">
                    <span class="bmk__card-media">
                      <img src="${esc(sized(main, 500))}" alt="${esc(b.title)}" loading="lazy" width="500" height="500">
                      ${alt ? `<img class="bmk__card-alt" src="${esc(sized(alt, 500))}" alt="" loading="lazy" width="500" height="500">` : ""}
                      ${g.discount ? `<span class="bmk__badge">−R$ ${Math.round(g.discount / 100)}</span>` : ""}
                      ${sizesOk <= 3 ? `<span class="bmk__card-warn">Últimas numerações</span>` : ""}
                      ${isSel ? `<span class="bmk__card-check">✓ ${esc(sel.variant.title)}</span>` : ""}
                    </span>
                    <span class="bmk__card-body">
                      <span class="bmk__card-title">${esc(b.title)}</span>
                      ${kit !== null
                        ? `<span class="bmk__kit-box"><small>O kit sai por:</small><s>${money(shirt.variant.price + price)}</s><strong>${money(kit)}</strong></span>`
                        : `<span class="bmk__card-price">${money(price)}</span>`}
                    </span>
                  </button>`;
                })
                .join("")}
            </div>
          </div>`;
        })
        .join("") || `<p class="bmk__empty">${esc(this.t.empty)}</p>`;
    }
    openBoot(groupId, id) {
      const g = this.cfg.bootGroups.find((x) => x.id === groupId);
      const p = g?.products.find((x) => x.id === id);
      if (p) this.openSheet("boot", p, g);
    }

    /* ---------- etapa 4: extras ----------
     * Categorias empilhadas (calças, óculos, bonés). Tocar abre a categoria ali mesmo com um trilho
     * de produtos; tocar no produto abre a gaveta de tamanho. Uma categoria aberta por vez.
     */
    extrasFor() {
      const g = this.state.gender;
      return this.extras.filter((e) => e.gender === "todos" || e.gender === g);
    }
    toggleExtra(id) {
      this.openExtra = this.openExtra === id ? null : id;
      clarity("extra_categoria_" + (this.openExtra ? "abrir" : "fechar"));
      this.renderUpsell();
      if (this.openExtra) {
        const el = this.querySelector(`[data-bmk-extra-wrap="${CSS.escape(id)}"]`);
        if (el && el.getBoundingClientRect().top < 80) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    renderUpsell() {
      const list = this.extrasFor();
      if (this.openExtra && !list.some((e) => e.id === this.openExtra)) this.openExtra = null;
      this.$("[data-bmk-upsell]").innerHTML = list
        .map((e) => {
          const open = this.openExtra === e.id;
          const ids = new Set(e.products.map((p) => p.id));
          const chosen = [...this.state.upsell.keys()].filter((id) => ids.has(id)).length;
          const from = Math.min(...e.products.map(minPrice));
          const cover = e.image || e.products[0].scene || e.products[0].image;
          const isPhoto = !!(e.image || e.products[0].scene);
          return `<div class="bmk__extra${open ? " is-open" : ""}${chosen ? " has-pick" : ""}" data-bmk-extra-wrap="${esc(e.id)}">
            <button type="button" class="bmk__extra-head" data-bmk-extra="${esc(e.id)}" aria-expanded="${open}">
              <span class="bmk__extra-info">
                <span class="bmk__extra-title">${esc(e.title)}${chosen ? `<span class="bmk__extra-count">${chosen} no kit</span>` : ""}</span>
                ${e.text ? `<span class="bmk__extra-text">${esc(e.text)}</span>` : ""}
                <span class="bmk__extra-from">a partir de <b>${money(from)}</b></span>
              </span>
              <span class="bmk__extra-media${isPhoto ? " is-photo" : ""} is-focus-${esc(e.focus || "center")}" style="--bmk-zoom:${(e.zoom || 112) / 100}"><img src="${esc(sized(cover, 600))}" alt="" loading="lazy" width="600" height="600"></span>
              <span class="bmk__extra-chev" aria-hidden="true"></span>
            </button>
            ${open ? `<div class="bmk__extra-body">
              <button type="button" class="bmk__rail-nav is-prev" data-bmk-rail="-1" aria-label="Anterior"></button>
              <button type="button" class="bmk__rail-nav is-next" data-bmk-rail="1" aria-label="Próximo"></button>
              <div class="bmk__grid bmk__grid--rail bmk__grid--upsell bmk__carousel">
                ${e.products.map((p) => this.upsellCard(p)).join("")}
              </div>
            </div>` : ""}
          </div>`;
        })
        .join("");
    }
    upsellCard(p) {
      const chosen = this.state.upsell.get(p.id);
      return `<div class="bmk__card bmk__card--static${chosen ? " is-selected" : ""}">
        <button type="button" class="bmk__card-hit" data-bmk-up="${p.id}" aria-label="${esc(p.title)}"></button>
        <span class="bmk__card-media" style="aspect-ratio:${Math.min(1.25, Math.max(0.7, p.ratio || 1))}">
          <img src="${esc(sized(p.image, 500))}" alt="${esc(p.title)}" loading="lazy" width="500" height="500">
          ${chosen ? `<span class="bmk__card-check">✓ ${p.variants.length > 1 ? esc(chosen.variant.title) : "No kit"}</span>` : ""}
        </span>
        <span class="bmk__card-body">
          <span class="bmk__card-title">${esc(p.title)}</span>
          <span class="bmk__card-price">${money(minPrice(p))}</span>
          ${chosen
            ? `<button type="button" class="bmk__link" data-bmk-up-remove="${p.id}">Remover</button>`
            : `<span class="bmk__card-add">+ Adicionar</span>`}
        </span>
      </div>`;
    }

    /* ---------- etapa 5: resumo ---------- */
    renderSummary() {
      const s = this.state;
      if (!s.shirt || !s.boot) return;
      // camisa = foto humanizada (preenche); botina e extras = packshot inteiro, sem corte
      const line = (item, label, step, fit = "contain") => `
        <div class="bmk__line">
          <img class="is-${fit}" src="${esc(sized(item.product.image, 240))}" alt="" width="72" height="90">
          <div class="bmk__line-info">
            <small>${esc(label)}</small>
            <strong>${esc(item.product.title)}</strong>
            <span>${item.product.variants.length > 1 ? `Tamanho: <b>${esc(item.variant.title)}</b>` : ""}</span>
          </div>
          <div class="bmk__line-end">
            <span>${money(item.variant.price)}</span>
            ${step ? `<button type="button" class="bmk__link" data-bmk-edit="${step}">Trocar</button>` : ""}
          </div>
        </div>`;
      let html = line(s.shirt, "Camisa", 2, "cover") + line(s.boot, "Botina", 3);
      s.upsell.forEach((u) => (html += line(u, "Extra", this.hasUpsell ? 4 : 0)));
      const { full, pay } = this.totals();
      html += `<div class="bmk__totals">
        <div><span>Valor avulso</span><s>${money(full)}</s></div>
        <div class="is-save"><span>Você economizou</span><strong>${money(s.boot.group.discount)}</strong></div>
        <div class="is-total"><span>Total</span><strong>${money(pay)}</strong></div>
      </div>`;
      this.$("[data-bmk-summary]").innerHTML = html;
    }

    /* ---------- gaveta de tamanho ---------- */
    openSheet(kind, product, group) {
      if (!product) return;
      this.sheet = { kind, product, group, variant: null };
      const sheet = this.$("[data-bmk-sheet]");
      const current =
        kind === "shirt" ? this.state.shirt : kind === "boot" ? this.state.boot : this.state.upsell.get(product.id);
      if (current && current.product.id === product.id) this.sheet.variant = current.variant;
      const only = product.variants.length === 1 && product.variants[0].available ? product.variants[0] : null;
      if (only) this.sheet.variant = only;

      this.$("[data-bmk-sheet-media]").classList.toggle("is-contain", kind !== "shirt");
      this.$("[data-bmk-sheet-media]").innerHTML = `<img src="${esc(sized(product.image, 700))}" alt="${esc(product.title)}">`;
      this.$("[data-bmk-sheet-title]").textContent = product.title;
      this.$("[data-bmk-sheet-label]").textContent = product.variants.length > 1 ? (kind === "boot" ? this.t.number : this.t.size) : "";
      this.$("[data-bmk-sheet-sizes]").innerHTML =
        product.variants.length > 1
          ? product.variants
              .map(
                (v) =>
                  `<button type="button" class="bmk__size${this.sheet.variant?.id === v.id ? " is-active" : ""}" data-bmk-size="${v.id}" ${v.available ? "" : `disabled title="${esc(this.t.soldOut)}"`}>${esc(v.title)}</button>`
              )
              .join("")
          : "";
      this.paintSheet();
      sheet.hidden = false;
      document.documentElement.classList.add("bmk-lock");
      requestAnimationFrame(() => sheet.classList.add("is-open"));
      clarity("abrir_" + kind);
    }
    paintSheet() {
      const { kind, product, group, variant } = this.sheet;
      const v = variant || product.variants.find((x) => x.available) || product.variants[0];
      let price = `<b>${money(v.price)}</b>`;
      if (kind === "boot" && this.state.shirt) {
        const kit = this.kitPrice(this.state.shirt.variant.price, v.price, group.discount);
        price = `<span class="bmk__sheet-kit">${esc(this.t.kitPrice)} <b>${money(kit)}</b></span>`;
      }
      this.$("[data-bmk-sheet-price]").innerHTML = price;
      this.querySelectorAll("[data-bmk-size]").forEach((b) => b.classList.toggle("is-active", +b.dataset.bmkSize === variant?.id));
      const btn = this.$("[data-bmk-sheet-confirm]");
      btn.disabled = !variant;
      btn.textContent =
        kind === "shirt" ? this.t.confirmShirt : kind === "boot" ? this.t.confirmBoot : this.t.confirmUpsell;
    }
    pickSize(id) {
      if (!this.sheet) return;
      const v = this.sheet.product.variants.find((x) => x.id === id);
      if (!v || !v.available) return;
      this.sheet.variant = v;
      this.paintSheet();
    }
    closeSheet() {
      const sheet = this.$("[data-bmk-sheet]");
      if (sheet.hidden) return;
      sheet.classList.remove("is-open");
      document.documentElement.classList.remove("bmk-lock");
      setTimeout(() => (sheet.hidden = true), 200);
      this.sheet = null;
    }
    confirmSheet() {
      const sh = this.sheet;
      if (!sh?.variant) return;
      const item = { product: sh.product, variant: sh.variant };
      if (sh.kind === "shirt") {
        this.state.shirt = item;
        clarity("camisa_ok");
        this.closeSheet();
        return this.goto(3);
      }
      if (sh.kind === "boot") {
        this.state.boot = { ...item, group: sh.group };
        clarity("botina_ok");
        this.closeSheet();
        return this.next();
      }
      this.state.upsell.set(sh.product.id, item);
      clarity("extra_ok");
      this.closeSheet();
      this.render();
    }

    /* ---------- carrinho ---------- */
    async addToCart() {
      const s = this.state;
      if (!s.shirt || !s.boot) return;
      const btn = this.$("[data-bmk-add]");
      const err = this.$("[data-bmk-error]");
      err.hidden = true;
      btn.disabled = true;
      btn.classList.add("is-loading");
      const kitId = "K" + Date.now().toString(36).toUpperCase();
      const items = [
        { id: s.shirt.variant.id, quantity: 1, properties: { _kit: kitId } },
        { id: s.boot.variant.id, quantity: 1, properties: { _kit: kitId } },
        ...[...s.upsell.values()].map((u) => ({ id: u.variant.id, quantity: 1, properties: { _kit_extra: kitId } })),
      ];
      try {
        const r = await fetch((window.routes?.cart_add_url || "/cart/add") + ".js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ items }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.description || data.message || "erro");
        clarity("adicionado");
        await this.applyCode(s.boot.group.code);
        await this.afterAdd();
      } catch (e) {
        console.error("[brk-monte-kit] add", e);
        err.textContent = (e && e.message && e.message !== "erro" ? e.message + " — " : "") + this.t.error;
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.classList.remove("is-loading");
      }
    }
    // Cupom Compre X Ganhe Y do grupo da botina — mantém os cupons que já estavam no carrinho.
    async applyCode(code) {
      if (!code) return;
      try {
        const cart = await fetch("/cart.js").then((r) => r.json());
        const codes = (cart.discount_codes || []).map((d) => d.code).filter(Boolean);
        if (codes.some((c) => c.toUpperCase() === code.toUpperCase())) return;
        await fetch("/cart/update.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ discount: [...codes, code].join(",") }),
        });
      } catch (e) {
        console.error("[brk-monte-kit] cupom", e);
      }
    }
    async afterAdd() {
      const mode = this.cfg.afterAdd;
      if (mode === "checkout") return void (window.location.href = "/checkout");
      if (mode === "cart") return void (window.location.href = window.routes?.cart_url || "/cart");
      // drawer: mesmo caminho do brk-upsell (re-renderiza #minicart-form e abre)
      const notification = document.querySelector("cart-notification");
      try {
        if (!notification) throw new Error("sem minicart");
        if (typeof notification.brkRefreshMinicart === "function") {
          await notification.brkRefreshMinicart();
        } else {
          const [html, cart] = await Promise.all([
            fetch(`${window.location.pathname}?section_id=minicart-form`).then((r) => r.text()),
            fetch("/cart.js").then((r) => r.json()),
          ]);
          const form = document.getElementById("minicart-form");
          const fresh = new DOMParser().parseFromString(html, "text/html").querySelector("#minicart-form");
          if (!form || !fresh) throw new Error("minicart-form não encontrado");
          form.innerHTML = fresh.innerHTML;
          document.querySelectorAll(".cart-count").forEach((el) => {
            el.innerHTML = el.classList.contains("cart-count-drawer") ? `(${cart.item_count})` : cart.item_count;
          });
          if (typeof notification.cartAction === "function") notification.cartAction();
        }
        if (typeof notification.open === "function") notification.open();
        else throw new Error("minicart sem open()");
      } catch (e) {
        window.location.href = window.routes?.cart_url || "/cart";
      }
    }
  }

  customElements.define("brk-monte-kit", BrkMonteKit);
})();
