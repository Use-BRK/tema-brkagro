/* BRK Upsell — comportamento da seção de upsell (snippets/brk-upsell.liquid).
 *
 * - Adicionar: /cart/add.js com a property `_brk_upsell` = id da campanha (o desconto é
 *   aplicado pela function do app BRK Apps). Depois re-renderiza o minicart
 *   (cart-notification.brkRefreshMinicart) ou, na página do carrinho, a seção dos itens
 *   (CartUtils.updateCartUI do cart.js) — a própria seção de upsell some/atualiza junto.
 * - Carrossel (setas + scroll) e troca de variação.
 * - Microsoft Clarity: todo clique vira evento personalizado `upsell_<ação>` e
 *   `upsell_<ação>__<campanha>`, com as tags `upsell_campanha` e `upsell_local`.
 *
 * Carregado em todas as páginas (snippets/scripts-tag.liquid): a seção chega por HTML
 * re-renderizado do minicart, onde <script> não executa.
 */
(() => {
  if (customElements.get("brk-upsell")) return;

  const viewed = new Set();

  function clarity(...args) {
    try {
      if (typeof window.clarity === "function") window.clarity(...args);
    } catch (e) {
      /* Clarity indisponível: ignora */
    }
  }

  class BrkUpsell extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      this.campaign = this.dataset.campaign || "";
      this.slug = this.dataset.campaignSlug || this.campaign;
      this.placement = this.dataset.placement || "minicart";
      this.track = this.querySelector("[data-upsell-track]");

      this.addEventListener("click", (e) => this.onClick(e));
      this.addEventListener("change", (e) => this.onChange(e));
      if (this.track) {
        this.track.addEventListener("scroll", () => this.updateNav(), { passive: true });
        this._resize = () => this.updateNav();
        window.addEventListener("resize", this._resize);
        requestAnimationFrame(() => this.updateNav());
      }
      this.observeView();
    }

    disconnectedCallback() {
      if (this._resize) window.removeEventListener("resize", this._resize);
      if (this._io) this._io.disconnect();
    }

    // Evento no Clarity (genérico + por campanha) com o contexto da sessão.
    track_(action) {
      clarity("set", "upsell_campanha", this.slug);
      clarity("set", "upsell_local", this.placement);
      clarity("event", `upsell_${action}`);
      clarity("event", `upsell_${action}__${this.slug}`);
      clarity("event", `upsell_${action}__${this.placement}`);
    }

    // `upsell_view` uma vez por campanha/local por página, quando a seção fica visível.
    observeView() {
      const key = `${this.campaign}|${this.placement}`;
      if (viewed.has(key)) return;
      const fire = () => {
        if (viewed.has(key)) return;
        viewed.add(key);
        this.track_("view");
      };
      if (!("IntersectionObserver" in window)) return fire();
      this._io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          this._io.disconnect();
          fire();
        }
      }, { threshold: 0.4 });
      this._io.observe(this);
    }

    onClick(e) {
      const nav = e.target.closest("[data-upsell-nav]");
      if (nav) {
        e.preventDefault();
        this.scroll(nav.dataset.upsellNav === "next" ? 1 : -1);
        this.track_(`nav_${nav.dataset.upsellNav}`);
        return;
      }
      const add = e.target.closest("[data-upsell-add]");
      if (add) {
        e.preventDefault();
        this.add(add);
        return;
      }
      if (e.target.closest('[data-upsell-action="product_click"]')) {
        this.track_("product_click");
      }
    }

    onChange(e) {
      const select = e.target.closest("[data-upsell-variant]");
      if (!select) return;
      const card = select.closest(".brk-upsell__card");
      const option = select.selectedOptions[0];
      const button = card.querySelector("[data-upsell-add]");
      button.dataset.variantId = select.value;
      button.disabled = Boolean(option && option.disabled);
      const final = card.querySelector("[data-upsell-final]");
      if (final && option) final.textContent = option.dataset.final || final.textContent;
      let compare = card.querySelector("[data-upsell-compare]");
      if (option && option.dataset.compare) {
        if (!compare) {
          compare = document.createElement("s");
          compare.className = "brk-upsell__compare";
          compare.dataset.upsellCompare = "";
          final.before(compare);
        }
        compare.textContent = option.dataset.compare;
        final.classList.add("is-sale");
      } else if (compare) {
        compare.remove();
        final.classList.remove("is-sale");
      }
      this.track_("variant_change");
    }

    scroll(dir) {
      if (!this.track) return;
      const card = this.track.querySelector(".brk-upsell__card");
      const step = card ? card.getBoundingClientRect().width + 10 : this.track.clientWidth;
      this.track.scrollBy({ left: dir * step, behavior: "smooth" });
    }

    updateNav() {
      if (!this.track) return;
      const max = this.track.scrollWidth - this.track.clientWidth;
      this.dataset.scrollable = max > 4 ? "true" : "false";
      const prev = this.querySelector('[data-upsell-nav="prev"]');
      const next = this.querySelector('[data-upsell-nav="next"]');
      if (prev) prev.disabled = this.track.scrollLeft <= 4;
      if (next) next.disabled = this.track.scrollLeft >= max - 4;
    }

    showError(card, message) {
      const el = card.querySelector(".brk-upsell__error");
      if (!el) return;
      el.textContent = message;
      el.hidden = !message;
    }

    async add(button) {
      if (button.disabled || button.classList.contains("is-loading")) return;
      const card = button.closest(".brk-upsell__card");
      const variantId = Number(button.dataset.variantId);
      if (!variantId) return;
      this.track_("add");
      this.showError(card, "");
      button.classList.add("is-loading");
      button.disabled = true;

      try {
        const base = (window.routes && window.routes.cart_add_url) || "/cart/add";
        const res = await fetch(base.endsWith(".js") ? base : `${base}.js`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            items: [{ id: variantId, quantity: 1, properties: { _brk_upsell: this.campaign } }],
          }),
        });
        const data = await res.json();
        if (!res.ok || data.status || data.errors) {
          throw new Error(data.description || data.message || "Não foi possível adicionar este produto.");
        }
        button.classList.remove("is-loading");
        button.classList.add("is-added");
        this.track_("add_ok");
        document.dispatchEvent(new CustomEvent("brk-upsell:added", { detail: { campaign: this.campaign, variantId, placement: this.placement } }));
        await this.refreshCart();
      } catch (err) {
        console.error("[brk-upsell]", err);
        this.track_("add_error");
        button.classList.remove("is-loading");
        button.disabled = false;
        this.showError(card, err && err.message ? err.message : "Não foi possível adicionar este produto.");
      }
    }

    // Usa o que o tema oferece (fishing: brkRefreshMinicart / CartUtils); senão busca a seção
    // nova e troca o HTML (agro e motors não têm essas funções). Recarregar a página é o
    // último recurso.
    async refreshCart() {
      try {
        if (this.placement === "cart") await this.refreshCartPage();
        else await this.refreshMinicart();
      } catch (err) {
        console.error("[brk-upsell] refresh", err);
        window.location.reload();
      }
    }

    async refreshMinicart() {
      const notification = document.querySelector("cart-notification");
      if (notification && typeof notification.brkRefreshMinicart === "function") {
        return notification.brkRefreshMinicart();
      }
      const [html, cart] = await Promise.all([
        fetch(`${window.location.pathname}?section_id=minicart-form`).then((r) => r.text()),
        fetch("/cart.js").then((r) => r.json()),
      ]);
      const form = document.getElementById("minicart-form");
      const fresh = new DOMParser().parseFromString(html, "text/html").querySelector("#minicart-form");
      if (!form || !fresh) throw new Error("minicart-form não encontrado");
      form.innerHTML = fresh.innerHTML;
      this.afterCartChange(cart);
      if (notification && typeof notification.cartAction === "function") notification.cartAction();
    }

    async refreshCartPage() {
      const section = document.getElementById("main-cart-items");
      if (!section) throw new Error("main-cart-items não encontrado");
      const sectionId = section.dataset.id;
      const cartItems = document.querySelector("cart-items");
      const [html, cart] = await Promise.all([
        fetch(`${window.location.pathname}?section_id=${sectionId}`).then((r) => r.text()),
        fetch("/cart.js").then((r) => r.json()),
      ]);
      if (typeof CartUtils !== "undefined" && cartItems && typeof cartItems.getSectionsToRender === "function") {
        CartUtils.updateCartUI({
          parsedState: { ...cart, sections: { [sectionId]: html } },
          sectionsToRender: cartItems.getSectionsToRender(),
          cartInstance: cartItems,
          totalsSelector: ".cart-info .totals",
        });
      } else {
        const fresh = new DOMParser().parseFromString(html, "text/html").getElementById("main-cart-items");
        if (!fresh) throw new Error("seção do carrinho não encontrada");
        section.innerHTML = fresh.innerHTML;
      }
      this.afterCartChange(cart);
    }

    // Contadores, total do cabeçalho, barras de frete/brinde e imagens lazy do tema.
    afterCartChange(cart) {
      document.querySelectorAll(".cart-count").forEach((el) => {
        el.innerHTML = el.classList.contains("cart-count-drawer")
          ? `(${cart.item_count})`
          : cart.item_count > 100 ? "~" : cart.item_count;
      });
      const total = document.querySelector("header-total-price");
      if (total && typeof total.updateTotal === "function") total.updateTotal(cart);
      document.querySelectorAll("free-ship-progress-bar").forEach((el) => {
        if (typeof el.init === "function") el.init(cart.items_subtotal_price);
      });
      if (window.GiftProgressBar && typeof window.GiftProgressBar.scheduleSync === "function") {
        window.GiftProgressBar.scheduleSync();
      }
      if (typeof BlsLazyloadImg !== "undefined" && typeof BlsLazyloadImg.init === "function") BlsLazyloadImg.init();
    }
  }

  customElements.define("brk-upsell", BrkUpsell);
})();
