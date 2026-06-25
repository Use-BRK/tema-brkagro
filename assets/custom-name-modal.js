/*
 * Camisa personalizada — modal de personalização (protótipo).
 * - Abre via botão (.cnm-open-js[data-target="#id"]).
 * - Preview em <canvas>: desenha o mockup (frente/costas) + nome na posição/fonte.
 * - Zoom/pan no preview.
 * - "Comprar Personalizada": add em 2 passos (camisa -> PE1198 nested com PNG + properties).
 * Sem dependências externas. Mockups e config vêm de data-attributes do <custom-name-modal>.
 */
// Conectores de nomes compostos (ficam em minúsculo e grudam na palavra seguinte na quebra)
const NAME_CONNECTORS = new Set(["da", "de", "do", "das", "dos", "e", "di", "du", "del", "la", "le", "van", "von"]);

class CustomNameModal extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;

    this.root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    this.cfg = {
      variantId: this.dataset.variantId,
      price: this.dataset.price || "29,90",
      mockups: { frente: this.dataset.mockupFrente, costas: this.dataset.mockupCostas },
      positions: JSON.parse(this.dataset.positions || "{}"),
    };

    // Fonte fixa padrão (sem seletor de fonte); cor é definida na produção pra preservar o design da camisa.
    this.state = { name: "", font: "Oswald", fontLabel: "Oswald", side: "frente", posKey: null, posLabel: null, mode: "name", modeLabel: "Nome" };
    this.images = {};
    this.zoom = 1;
    this.tx = 0;
    this.ty = 0;

    this.canvas = this.querySelector(".cnm__canvas");
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.stage = this.querySelector(".cnm__stage");
    this.nameInput = this.querySelector(".cnm__name");
    this.nameLabel = this.querySelector(".cnm__name-label");
    this.counter = this.querySelector(".cnm__counter");
    this.acceptInput = this.querySelector(".cnm__accept");
    this.buyBtn = this.querySelector(".cnm__buy");

    this.preloadImages();
    this.bindEvents();

    // defaults
    this.setSide("frente");
    const activeMode = this.querySelector("[data-mode].active") || this.querySelector("[data-mode]");
    if (activeMode) this.setMode(activeMode.dataset.mode, activeMode);
    this.syncBuyEnabled();
    this.ensureFontThenDraw();
  }

  maxLen() { return this.state.mode === "company" ? 30 : 20; }

  /* Formata conforme o modo. Nome = Title Case (conectores minúsculos); Empresa = MAIÚSCULO preservando Enter. */
  formatName(raw) {
    if (this.state.mode === "company") {
      // EMPRESA: maiúsculo, preserva as quebras de linha (Enter) feitas pelo cliente
      return (raw || "").toUpperCase().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
    }
    // NOME: Title Case (mantém acentos) + conectores em minúsculo (da, de, do...)
    const s = (raw || "").replace(/\s+/g, " ").replace(/^\s/, "");
    const titled = s.toLowerCase().replace(/(^|\s|['’\-])([\p{L}])/gu, (m, sep, ch) => sep + ch.toUpperCase());
    return titled.split(" ").map((w, i) => (i > 0 && NAME_CONNECTORS.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(" ");
  }

  /* Quebra o texto em linhas pro canvas:
     - costas: SEMPRE uma linha só
     - empresa (frente): respeita as quebras manuais (Enter) do cliente
     - nome (frente): uma palavra por linha; conectores (da/de/do...) grudam na palavra seguinte */
  computeLines(raw) {
    if (this.state.side === "costas") {
      return [raw.replace(/\s+/g, " ").trim()].filter(Boolean);
    }
    if (this.state.mode === "company") {
      return raw.split("\n").map((s) => s.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
    }
    const words = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const lines = [];
    let buffer = "";
    words.forEach((w) => {
      if (NAME_CONNECTORS.has(w.toLowerCase())) {
        buffer = buffer ? buffer + " " + w : w;
      } else {
        lines.push(buffer ? buffer + " " + w : w);
        buffer = "";
      }
    });
    if (buffer) { if (lines.length) lines[lines.length - 1] += " " + buffer; else lines.push(buffer); }
    return lines;
  }

  /* ---------- setup ---------- */
  preloadImages() {
    ["frente", "costas"].forEach((side) => {
      const url = this.cfg.mockups[side];
      if (!url) return;
      const img = new Image();
      img.crossOrigin = "anonymous"; // permite exportar o canvas (toBlob) sem "tainted"
      img.onload = () => { this.images[side] = img; if (this.state.side === side) this.draw(); };
      img.src = url;
    });
  }

  bindEvents() {
    // nome — formata ao vivo (Capitalizado ou MAIÚSCULO) e reflete no canvas
    if (this.nameInput) {
      this.nameInput.addEventListener("input", () => {
        const atEnd = this.nameInput.selectionStart === this.nameInput.value.length;
        const formatted = this.formatName(this.nameInput.value).slice(0, this.maxLen());
        this.nameInput.value = formatted;
        if (atEnd) {
          try { this.nameInput.setSelectionRange(formatted.length, formatted.length); } catch (e) {}
        }
        this.state.name = formatted;
        if (this.counter) this.counter.textContent = `${formatted.length}/${this.maxLen()}`;
        this.draw();
      });
      // no modo NOME a quebra de linha é automática (por palavra) — Enter não cria linha
      this.nameInput.addEventListener("keydown", (e) => {
        if (this.state.mode !== "company" && e.key === "Enter") e.preventDefault();
      });
    }
    // modo: Nome / Nome da Empresa
    this.querySelectorAll("[data-mode]").forEach((btn) =>
      btn.addEventListener("click", () => this.setMode(btn.dataset.mode, btn))
    );
    // frente / costas
    this.querySelectorAll("[data-side]").forEach((btn) =>
      btn.addEventListener("click", () => this.setSide(btn.dataset.side))
    );
    // posições
    this.querySelectorAll("[data-pos-key]").forEach((btn) =>
      btn.addEventListener("click", () => this.selectPos(btn))
    );
    // fechar
    this.querySelectorAll(".cnm__close, .cnm__overlay").forEach((el) =>
      el.addEventListener("click", () => this.close())
    );
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    // comprar
    const buy = this.querySelector(".cnm__buy");
    if (buy) buy.addEventListener("click", () => this.buy());
    // zoom — APENAS pelos botões (sem wheel/pan no canvas, pra não bloquear o scroll do modal)
    const zin = this.querySelector(".cnm__zoom-in");
    const zout = this.querySelector(".cnm__zoom-out");
    if (zin) zin.addEventListener("click", () => this.setZoom(this.zoom + 0.3));
    if (zout) zout.addEventListener("click", () => this.setZoom(this.zoom - 0.3));
    // aceitar termos habilita o botão de comprar
    if (this.acceptInput) this.acceptInput.addEventListener("change", () => this.syncBuyEnabled());
  }

  syncBuyEnabled() {
    const ok = !!(this.acceptInput && this.acceptInput.checked);
    if (this.buyBtn) this.buyBtn.disabled = !ok;
  }

  /* ---------- state changes ---------- */
  setMode(mode, btn) {
    this.state.mode = mode === "company" ? "company" : "name";
    this.state.modeLabel = this.state.mode === "company" ? "Nome da empresa" : "Nome";
    this.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === this.state.mode));
    if (this.nameLabel) this.nameLabel.textContent = this.state.mode === "company" ? "Nome da empresa:" : "Nome:";
    if (this.nameInput) {
      this.nameInput.setAttribute("placeholder", this.state.mode === "company" ? "Nome da empresa (Enter = nova linha)" : "Digite o nome");
      this.nameInput.rows = this.state.mode === "company" ? 2 : 1;
      this.nameInput.maxLength = this.maxLen();
      // re-formata o que já estiver digitado
      const formatted = this.formatName(this.nameInput.value).slice(0, this.maxLen());
      this.nameInput.value = formatted;
      this.state.name = formatted;
      if (this.counter) this.counter.textContent = `${formatted.length}/${this.maxLen()}`;
    }
    this.draw();
  }

  setSide(side) {
    this.state.side = side;
    this.querySelectorAll("[data-side]").forEach((b) => b.classList.toggle("active", b.dataset.side === side));
    // mostra apenas o grupo de posições do lado escolhido
    this.querySelectorAll("[data-positions]").forEach((g) => { g.hidden = g.dataset.positions !== side; });
    // seleciona a 1a posição do lado
    const firstPos = this.querySelector(`[data-positions="${side}"] [data-pos-key]`);
    if (firstPos) this.selectPos(firstPos);
    else this.draw();
  }

  selectPos(btn) {
    this.querySelectorAll("[data-pos-key]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    this.state.posKey = btn.dataset.posKey;
    this.state.posLabel = btn.dataset.posLabel || btn.textContent.trim();
    this.draw();
  }

  setZoom(z) {
    this.zoom = Math.min(4, Math.max(1, Math.round(z * 100) / 100));
    if (this.zoom === 1) { this.tx = 0; this.ty = 0; }
    this.applyTransform();
  }

  applyTransform() {
    if (this.canvas) this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
  }

  /* ---------- render ---------- */
  ensureFontThenDraw() {
    const fam = this.state.font;
    if (fam && fam !== "sans-serif" && document.fonts && document.fonts.load) {
      document.fonts.load(`48px "${fam}"`).then(() => this.draw()).catch(() => this.draw());
    } else {
      this.draw();
    }
  }

  draw() {
    if (!this.ctx) return;
    const c = this.canvas, ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);
    const img = this.images[this.state.side];
    if (img) ctx.drawImage(img, 0, 0, c.width, c.height);

    const raw = this.state.name || "";
    const preset = this.cfg.positions[this.state.side] && this.cfg.positions[this.state.side][this.state.posKey];
    if (!raw.trim() || !preset) return;

    const lines = this.computeLines(raw);
    if (!lines.length) return;

    const fam = this.state.font || "sans-serif";
    const maxW = c.width * (preset.maxW || 0.3);
    let size = Math.round(c.width * 0.06);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = preset.color || "#ffffff";
    // encolhe até a linha mais larga caber na largura da área
    const widest = () => { ctx.font = `${size}px "${fam}"`; return Math.max(...lines.map((l) => ctx.measureText(l).width)); };
    while (widest() > maxW && size > 12) size -= 2;
    ctx.font = `${size}px "${fam}"`;

    const lineH = size * 1.12;
    const startY = c.height * preset.cy - (lineH * lines.length) / 2 + lineH / 2;
    lines.forEach((l, i) => ctx.fillText(l, c.width * preset.cx, startY + i * lineH));
  }

  exportPng() {
    return new Promise((resolve) => {
      if (!this.canvas) return resolve(null);
      try {
        this.canvas.toBlob((blob) => resolve(blob), "image/png");
      } catch (e) {
        // canvas "tainted" (CORS do mockup) — segue sem o PNG, com as properties de texto
        console.warn("[custom-name-modal] não foi possível exportar o PNG:", e);
        resolve(null);
      }
    });
  }

  /* ---------- modal ---------- */
  open() {
    // Portal: move o modal pra raiz do <body> para que position:fixed/z-index escapem
    // de qualquer ancestral com transform/contain (era o que jogava o topo sob o header).
    if (this.parentElement !== document.body) document.body.appendChild(this);
    this.syncSizeFromProduct(); // abre já no tamanho escolhido na página (sem descasar)
    this.hidden = false;
    document.documentElement.style.overflow = "hidden";
    this.ensureFontThenDraw();
  }

  /* Reflete no modal a variante selecionada na página ao abrir (o cliente pode trocar depois). */
  syncSizeFromProduct() {
    const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'));
    const form = forms.find((f) => !((f.getAttribute("id") || "").startsWith("sticky"))) || forms[0];
    const input = form && form.querySelector('[name="id"]');
    const currentId = input && input.value;
    if (!currentId) return;
    const pill = this.querySelector(`.cnm__sizes input[type="radio"][value="${currentId}"]`);
    if (pill && !pill.disabled) pill.checked = true;
  }
  close() {
    this.hidden = true;
    document.documentElement.style.overflow = "";
  }

  /* ---------- carrinho (2 passos) ---------- */
  getShirtVariantId() {
    // 1) tamanho escolhido no próprio modal (pills independentes = sem conflito com o form)
    const checked = this.querySelector('.cnm__sizes input[type="radio"]:checked');
    if (checked && checked.value) return checked.value;
    // 2) produto de variante única: usa a variante padrão
    if (this.dataset.defaultVariantId) return this.dataset.defaultVariantId;
    // 3) fallback: lê do form principal do produto
    //    Obs: usar getAttribute('id') — um <input name="id"> sombreia form.id.
    const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'));
    const form = forms.find((f) => !((f.getAttribute("id") || "").startsWith("sticky"))) || forms[0];
    const input = form && form.querySelector('[name="id"]');
    return input ? input.value : null;
  }

  /* SKU da variante selecionada do produto pai (para identificar no pedido) */
  getShirtSku(variantId) {
    try {
      const el = document.querySelector('[data-product-json], .productJson');
      if (!el) return "";
      const p = JSON.parse(el.textContent);
      const v = (p.variants || []).find((x) => String(x.id) === String(variantId));
      return (v && v.sku) || "";
    } catch (e) {
      return "";
    }
  }

  async buy() {
    const buyBtn = this.querySelector(".cnm__buy");
    const name = (this.state.name || "").trim();
    if (!name) { this.flash("Digite o nome (até 20 caracteres)."); this.nameInput && this.nameInput.focus(); return; }
    if (!this.state.posKey) { this.flash("Escolha a posição."); return; }
    if (this.acceptInput && !this.acceptInput.checked) { this.flash("Você precisa aceitar os termos de personalização."); return; }
    const shirtId = this.getShirtVariantId();
    if (!shirtId) { this.flash("Selecione as opções do produto."); return; }
    if (!this.cfg.variantId) { this.flash("Produto de personalização não configurado."); return; }

    if (buyBtn) { buyBtn.disabled = true; buyBtn.dataset.loading = "true"; }
    try {
      // Uma request só (FormData): camisa + PE1198 aninhado (parent_id = variant da camisa)
      // + PNG (file property) + properties de texto.
      const blob = await this.exportPng();
      const shirtSku = this.getShirtSku(shirtId);
      const fd = new FormData();
      fd.append("items[0][id]", String(shirtId));
      fd.append("items[0][quantity]", "1");
      fd.append("items[1][id]", String(this.cfg.variantId));
      fd.append("items[1][quantity]", "1");
      fd.append("items[1][parent_id]", String(shirtId));
      // "Produto" primeiro = código (SKU) do item ao qual a personalização pertence
      if (shirtSku) fd.append("items[1][properties][Produto]", shirtSku);
      fd.append("items[1][properties][Tipo]", this.state.modeLabel);
      fd.append("items[1][properties][Nome]", name);
      fd.append("items[1][properties][Local]", this.state.side === "frente" ? "Frente" : "Costas");
      fd.append("items[1][properties][Posição]", this.state.posLabel || "");
      if (blob) fd.append("items[1][properties][Arte]", blob, "personalizacao.png");

      const r2 = await fetch(this.root + "cart/add.js", { method: "POST", headers: { Accept: "application/json" }, body: fd });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error((d2 && d2.description) || "Erro ao adicionar ao carrinho");

      this.close();
      // Atualiza o conteúdo do minicart e abre o drawer (sem redirecionar pro /cart)
      const cn = document.querySelector("cart-notification");
      if (cn && typeof cn.refreshMinicartSection === "function") {
        try { await cn.refreshMinicartSection(); } catch (e) {}
        if (typeof cn.open === "function") cn.open();
      } else if (window.Shopify && Shopify.actions && typeof Shopify.actions.openCart === "function") {
        Shopify.actions.openCart();
      } else {
        window.location.href = this.root + "cart";
      }
    } catch (e) {
      this.flash((e && e.message) || "Não foi possível adicionar ao carrinho.");
    } finally {
      if (buyBtn) delete buyBtn.dataset.loading;
      this.syncBuyEnabled();
    }
  }

  flash(msg) {
    const el = this.querySelector(".cnm__msg");
    if (el) { el.textContent = msg; el.hidden = false; }
    else console.warn("[custom-name-modal]", msg);
  }
}
customElements.define("custom-name-modal", CustomNameModal);

// Abertura via qualquer botão com .cnm-open-js[data-target="#id"]
document.addEventListener("click", (e) => {
  const trigger = e.target.closest(".cnm-open-js");
  if (!trigger) return;
  e.preventDefault();
  const sel = trigger.getAttribute("data-target");
  const modal = sel && document.querySelector(sel);
  if (modal && typeof modal.open === "function") modal.open();
});
