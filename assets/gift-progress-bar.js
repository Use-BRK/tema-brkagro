if (!customElements.get("gift-progress-bar")) {
class GiftProgressBar extends HTMLElement {
  constructor() {
    super();
    this.modal = null;
    this.modalContent = null;
    this.qualifyingSubtotalCents = Number(this.dataset.order) || 0;
    this.addEventListener("click", this.onGiftBarClick.bind(this));
    this.init(this.dataset.order);
  }

  static cartPromise = null;
  static syncTimer = null;

  static isGiftLine(item) {
    return (
      item &&
      item.properties &&
      String(item.properties._brk_gift_progress) === "true"
    );
  }

  static getShippingProtectionProductIds() {
    return new Set(
      Array.from(document.querySelectorAll("gift-progress-bar"))
        .map((bar) => Number(bar.dataset.shippingProtectionProductId))
        .filter(Boolean)
    );
  }

  static isShippingProtectionLine(item) {
    if (!item) return false;
    const shippingProtectionProductIds = GiftProgressBar.getShippingProtectionProductIds();
    return shippingProtectionProductIds.has(Number(item.product_id));
  }
  static getQualifyingSubtotal(cart) {
    if (!cart || !Array.isArray(cart.items)) return 0;
    return cart.items.reduce((subtotal, item) => {
      if (GiftProgressBar.isGiftLine(item)) return subtotal;
      if (GiftProgressBar.isShippingProtectionLine(item)) return subtotal;
      return subtotal + Number(item.final_line_price || item.line_price || 0);
    }, 0);
  }

  static fetchCart(force = false) {
    if (!force && GiftProgressBar.cartPromise) {
      return GiftProgressBar.cartPromise;
    }

    const root =
      window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
    GiftProgressBar.cartPromise = fetch(`${root}cart.js`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => response.json())
      .finally(() => {
        GiftProgressBar.cartPromise = null;
      });

    return GiftProgressBar.cartPromise;
  }

  static scheduleSync() {
    clearTimeout(GiftProgressBar.syncTimer);
    GiftProgressBar.syncTimer = setTimeout(() => {
      GiftProgressBar.syncAllFromCart();
    }, 80);
  }

  static syncAllFromCart(force = false) {
    return GiftProgressBar.fetchCart(force)
      .then((cart) => {
        GiftProgressBar.updateCartShell(cart);
        GiftProgressBar.renderAll(cart);
        return cart;
      })
      .catch((error) => {
        console.error("Error syncing gift progress bar:", error);
      });
  }

  static renderAll(cart) {
    const qualifyingSubtotal = GiftProgressBar.getQualifyingSubtotal(cart);
    document.querySelectorAll("gift-progress-bar").forEach((bar) => {
      bar.cart = cart;
      bar.render(qualifyingSubtotal);
    });
  }

  static updateCartShell(cart) {
    if (!cart) return;

    if (cart.item_count !== undefined) {
      document.querySelectorAll(".cart-count").forEach((el) => {
        if (el.classList.contains("cart-count-drawer")) {
          el.innerHTML = `(${cart.item_count})`;
        } else {
          el.innerHTML = cart.item_count > 100 ? "~" : cart.item_count;
        }
      });
    }

    const headerTotalPrice = document.querySelector("header-total-price");
    if (
      headerTotalPrice &&
      typeof headerTotalPrice.updateTotal === "function"
    ) {
      headerTotalPrice.updateTotal(cart);
    }
  }

  init(orders) {
    this.render(Number(orders) || 0);
    GiftProgressBar.scheduleSync();
  }

  getTiers() {
    const json = this.querySelector(".gift-progress-bar-data");
    if (!json) return [];

    try {
      const tiers = JSON.parse(json.textContent);
      return tiers
        .filter((tier) => tier && Number(tier.threshold) > 0 && tier.variantId)
        .sort((a, b) => Number(a.threshold) - Number(b.threshold));
    } catch (error) {
      console.error("Invalid gift progress bar JSON:", error);
      return [];
    }
  }

  getCurrencyRate() {
    const rate =
      window.Shopify && Shopify.currency ? Number(Shopify.currency.rate) : 1;
    return rate || 1;
  }

  getThresholdByCurrency(tier) {
    return Number(tier.threshold) * this.getCurrencyRate();
  }

  getUnlockedTiers() {
    const order = this.qualifyingSubtotalCents / 100;
    return this.getTiers().filter((tier) => {
      return order >= this.getThresholdByCurrency(tier);
    });
  }

  getTierVariants(tier) {
    if (!tier || !Array.isArray(tier.variants)) return [];
    return tier.variants.filter((variant) => variant && variant.id);
  }

  getVariantById(tier, variantId) {
    const variants = this.getTierVariants(tier);
    return (
      variants.find((variant) => String(variant.id) === String(variantId)) ||
      variants.find((variant) => String(variant.id) === String(tier.variantId)) ||
      variants.find((variant) => variant.available !== false) ||
      variants[0] ||
      null
    );
  }

  formatMoney(cents) {
    if (window.Shopify && typeof Shopify.formatMoney === "function") {
      const moneyFormat = window.cartStrings
        ? cartStrings.money_format
        : undefined;
      return Shopify.formatMoney(cents, moneyFormat);
    }
    return cents / 100;
  }

  stripCongratulations(message) {
    return String(message || "").replace(/^Parab\S*ns!\s*/i, "");
  }

  render(orders) {
    const tiers = this.getTiers();
    if (!tiers.length) return;

    this.qualifyingSubtotalCents = Number(orders) || 0;
    const order = this.qualifyingSubtotalCents / 100;
    const highestThreshold = this.getThresholdByCurrency(tiers[tiers.length - 1]);
    const progress = highestThreshold
      ? Math.min((order / highestThreshold) * 100, 100)
      : 0;
    const unlockedTiers = this.getUnlockedTiers();
    const remainingUnlockedCount =
      this.getRemainingUnlockedTiers(unlockedTiers).length;
    const nextTier = tiers.find((tier) => {
      return order < this.getThresholdByCurrency(tier);
    });

    this.setProgressBar(progress, unlockedTiers.length > 0);
    this.setProgressBarTitle(
      order,
      nextTier,
      unlockedTiers.length,
      remainingUnlockedCount
    );
  }

  setProgressBarTitle(order, nextTier, unlockedCount, remainingUnlockedCount) {
    const title = this.querySelector(".gift-bar-message");
    if (!title) return;

    title.classList.remove("opacity-0");
    if (unlockedCount > 0) {
      if (nextTier) {
        const nextThreshold = this.getThresholdByCurrency(nextTier);
        const amountLeft = Math.max((nextThreshold - order) * 100, 0);
        const giftLabel = unlockedCount === 1 ? "brinde" : "brindes";
        title.innerHTML = `Você desbloqueou ${unlockedCount} ${giftLabel}. Faltam ${this.formatMoney(
          amountLeft
        )} para liberar o próximo brinde.`;
      } else {
        title.innerHTML =
          this.stripCongratulations(this.dataset.feAvaiable) ||
          "Você desbloqueou todos os brindes disponíveis! 🎁";
      }
    } else {
      const firstTier = this.getTiers()[0];
      const firstThreshold = this.getThresholdByCurrency(firstTier);
      const amountLeft = Math.max((firstThreshold - order) * 100, 0);
      const unavailable = this.stripCongratulations(
        this.dataset.feUnavaiable || ""
      );
      title.innerHTML = unavailable.replace(
        "{{ amount }}",
        this.formatMoney(amountLeft)
      );
    }

    this.updateRedeemButton(remainingUnlockedCount);
  }

  getRemainingUnlockedTiers(unlockedTiers, cart = this.cart) {
    if (!Array.isArray(unlockedTiers)) return [];
    if (!cart || !Array.isArray(cart.items)) return unlockedTiers;
    return unlockedTiers.filter((tier) => {
      return !this.isTierInCart(tier, cart);
    });
  }

  updateRedeemButton(remainingUnlockedCount) {
    const actions = this.querySelector(".gift-bar-actions");
    const button = this.querySelector("[data-gift-redeem]");
    const count = Number(remainingUnlockedCount) || 0;
    if (actions) {
      actions.classList.toggle("hidden", count === 0);
    }
    if (button) {
      const label = this.dataset.redeemLabel || "Resgatar brindes";
      button.textContent = `${label} (${count})`;
      button.disabled = count === 0;
    }
  }

  setProgressBar(progress, unlocked) {
    const p = this.querySelector(".progress");
    if (p) {
      p.style.width = progress + "%";
    }
    this.classList.toggle("cart_gift_unlocked", Boolean(unlocked));
  }

  onGiftBarClick(event) {
    const trigger = event.target.closest("[data-gift-redeem]");
    if (!trigger) return;
    event.preventDefault();
    this.openGiftModal();
  }

  isTierInCart(tier, cart) {
    if (!cart || !Array.isArray(cart.items)) return false;
    return cart.items.some((item) => {
      if (!GiftProgressBar.isGiftLine(item)) return false;
      return (
        Number(item.variant_id) === Number(tier.variantId) ||
        String(item.properties._brk_gift_tier) === String(tier.tier)
      );
    });
  }

  buildModalContent(cart) {
    const content = document.createElement("div");
    content.className = "gift-progress-modal__content";

    const eligibleTiers = this.getUnlockedTiers();
    const title = document.createElement("h3");
    title.className = "gift-progress-modal__title";
    title.textContent = this.dataset.modalTitle || "Escolha seus brindes";
    content.appendChild(title);

    if (!eligibleTiers.length) {
      const empty = document.createElement("p");
      empty.className = "gift-progress-modal__empty";
      empty.textContent =
        this.dataset.modalEmpty || "Nenhum brinde disponivel para o subtotal atual.";
      content.appendChild(empty);
      return content;
    }

    const list = document.createElement("div");
    list.className = "gift-progress-modal__list";

    eligibleTiers.forEach((tier) => {
      const variants = this.getTierVariants(tier);
      const selectedVariant = this.getVariantById(tier, tier.variantId);
      const item = document.createElement("div");
      item.className = "gift-progress-modal__item";

      const media = document.createElement("a");
      media.className = "gift-progress-modal__media";
      media.href = tier.url || "#";
      let image = null;
      const imageSrc =
        (selectedVariant && selectedVariant.image) || tier.image || "";
      if (imageSrc) {
        image = document.createElement("img");
        image.src = imageSrc;
        image.alt = tier.title || "Brinde";
        image.loading = "lazy";
        media.appendChild(image);
      }

      const info = document.createElement("div");
      info.className = "gift-progress-modal__info";

      const name = document.createElement("a");
      name.className = "gift-progress-modal__name";
      name.href = tier.url || "#";
      name.textContent = tier.title || "Brinde";
      info.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "gift-progress-modal__meta";
      meta.textContent = `Liberado em ${this.formatMoney(
        this.getThresholdByCurrency(tier) * 100
      )}`;
      info.appendChild(meta);

      let variantSelect = null;
      if (variants.length > 1) {
        variantSelect = document.createElement("select");
        variantSelect.className = "gift-progress-modal__variant";
        variantSelect.setAttribute("aria-label", "Escolha a variação do brinde");
        variants.forEach((variant) => {
          const option = document.createElement("option");
          option.value = String(variant.id);
          option.textContent = variant.title;
          option.disabled = variant.available === false;
          if (
            selectedVariant &&
            String(variant.id) === String(selectedVariant.id)
          ) {
            option.selected = true;
          }
          variantSelect.appendChild(option);
        });
        info.appendChild(variantSelect);
      }

      const button = document.createElement("button");
      const alreadyAdded = this.isTierInCart(tier, cart);
      const selectedAvailable =
        selectedVariant && selectedVariant.available !== false;
      button.type = "button";
      button.className = "gift-progress-modal__add btn-primary";
      button.dataset.giftAdd = String(
        selectedVariant ? selectedVariant.id : tier.variantId
      );
      button.textContent = alreadyAdded ? "Adicionado" : "Adicionar";
      button.disabled = alreadyAdded || !selectedAvailable;

      if (variantSelect) {
        variantSelect.disabled = alreadyAdded;
        variantSelect.addEventListener("change", () => {
          const variant = this.getVariantById(tier, variantSelect.value);
          if (!variant) return;
          button.dataset.giftAdd = String(variant.id);
          button.disabled = alreadyAdded || variant.available === false;
          if (image && variant.image) {
            image.src = variant.image;
          }
        });
      }

      button.addEventListener("click", () => {
        const variantId = variantSelect
          ? variantSelect.value
          : button.dataset.giftAdd;
        this.addGift(button, tier, variantId);
      });

      item.appendChild(media);
      item.appendChild(info);
      item.appendChild(button);
      list.appendChild(item);
    });

    content.appendChild(list);
    this.modalContent = content;
    return content;
  }

  openGiftModal() {
    GiftProgressBar.syncAllFromCart(true).then((cart) => {
      const content = this.buildModalContent(cart);
      if (window.tingle && typeof tingle.modal === "function") {
        this.modal = new tingle.modal({
          footer: false,
          stickyFooter: false,
          closeMethods: ["overlay", "button", "escape"],
          cssClass: ["gift-progress-modal"],
        });
        this.modal.setContent(content);
        this.modal.open();
      } else {
        const wrapper = document.createElement("div");
        wrapper.className = "gift-progress-modal-fallback";
        wrapper.appendChild(content);
        document.body.appendChild(wrapper);
      }
    });
  }

  addGift(button, tier, variantId) {
    const variant = this.getVariantById(tier, variantId);
    if (!tier || !variant || !variant.id || button.disabled) return;

    button.disabled = true;
    button.classList.add("loading");
    button.textContent = "Adicionando";

    const sectionsToRender = this.getSectionsToRender();
    const body = {
      items: [
        {
          id: Number(variant.id),
          quantity: 1,
          properties: {
            _brk_gift_progress: "true",
            _brk_gift_tier: String(tier.tier),
            _brk_gift_threshold: String(tier.threshold),
            _brk_gift_handle: String(tier.handle || ""),
            _brk_gift_variant: String(variant.id),
          },
        },
      ],
    };

    if (sectionsToRender.length) {
      body.sections = sectionsToRender.map((section) => section.section);
      body.sections_url = window.location.pathname;
    }

    fetch(routes.cart_add_url, {
      ...fetchConfig(),
      body: JSON.stringify(body),
    })
      .then((response) => response.json())
      .then((response) => {
        if (response.errors || response.status) {
          throw new Error(response.description || response.message || response.errors);
        }
        this.updateSections(response.sections, sectionsToRender);
        return GiftProgressBar.syncAllFromCart(true);
      })
      .then((cart) => {
        if (
          this.modal &&
          typeof this.modal.isOpen === "function" &&
          this.modal.isOpen()
        ) {
          this.modal.setContent(this.buildModalContent(cart));
        }
        this.toast("Brinde adicionado ao carrinho.", "success");
      })
      .catch((error) => {
        console.error("Error adding gift:", error);
        button.disabled = false;
        button.textContent = "Adicionar";
        this.toast("Nao foi possivel adicionar o brinde.", "error");
      })
      .finally(() => {
        button.classList.remove("loading");
        if (typeof BlsLazyloadImg !== "undefined") {
          BlsLazyloadImg.init();
        }
        const cartNotification = document.querySelector("cart-notification");
        if (
          cartNotification &&
          typeof cartNotification.cartAction === "function"
        ) {
          cartNotification.cartAction();
        }
      });
  }

  getSectionsToRender() {
    const sections = [];
    if (document.getElementById("minicart-form")) {
      sections.push({
        id: "minicart-form",
        section: "minicart-form",
        selector: "#minicart-form",
      });
    }

    const mainCartItems = document.getElementById("main-cart-items");
    if (mainCartItems && mainCartItems.dataset.id) {
      sections.push({
        id: "main-cart-items",
        section: mainCartItems.dataset.id,
        selector: "#main-cart-items",
      });
    }

    return sections.filter((section, index, list) => {
      return list.findIndex((item) => item.section === section.section) === index;
    });
  }

  updateSections(sections, sectionsToRender) {
    if (!sections || !sectionsToRender.length) return;

    sectionsToRender.forEach((section) => {
      if (!sections[section.section]) return;
      const html = new DOMParser().parseFromString(
        sections[section.section],
        "text/html"
      );
      const source = html.querySelector(section.selector);
      const target = document.getElementById(section.id);
      if (!source || !target) return;

      target.innerHTML = source.innerHTML;
    });
  }

  toast(message, type) {
    if (typeof showToast !== "function") return;
    const className =
      type === "success"
        ? "newsletter-form__message--success success"
        : "line-item-error-1 error";
    const modalType = type === "success" ? "modal-success" : "modal-error";
    showToast(
      `<div class="mt-10 ${className} form__message inline-flex align-center" tabindex="-1"><span>${message}</span></div>`,
      3000,
      modalType
    );
  }
}
window.GiftProgressBar = GiftProgressBar;
customElements.define("gift-progress-bar", GiftProgressBar);
}