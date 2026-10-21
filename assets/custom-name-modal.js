/*
 * Camisa personalizada — modal de personalização (protótipo).
 * - Abre via botão (.cnm-open-js[data-target="#id"]).
 * - Preview em <canvas>: desenha o mockup (frente/costas) + nome na posição/fonte.
 * - Zoom/pan no preview.
 * - "Comprar Personalizada": add em 2 passos (camisa -> PE1198 nested com PNG + properties).
 * Sem dependências externas. Mockups e config vêm de data-attributes do <custom-name-modal>.
 * Modo carrinho (data-cart-mode, snippets/cart-custom-name-modal.liquid): anexa o PE1198 a uma
 * camisa que já está no minicart. Na página do produto o arquivo é incluído 2x (bloco + snippet
 * global): o guard abaixo faz só a 1ª inclusão rodar.
 */
(function () {
if (window.__brkCnmLoaded) return;
window.__brkCnmLoaded = true;
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

    // data-lazy (modal do minicart, presente em todas as páginas): mockups e fonte só ao abrir
    this.lazy = this.hasAttribute("data-lazy");
    if (!this.lazy) this.preloadImages();
    this.bindEvents();

    // Modo carrinho: o modal fica fora do <cart-notification>; sem isso, o clique
    // dentro dele conta como "fora do drawer" e fecha o minicart por trás.
    if (this.hasAttribute("data-cart-mode")) this.addEventListener("click", (e) => e.stopPropagation());

    // defaults
    this.setSide("frente");
    const activeMode = this.querySelector("[data-mode].active") || this.querySelector("[data-mode]");
    if (activeMode) this.setMode(activeMode.dataset.mode, activeMode);
    this.syncBuyEnabled();
    if (!this.lazy) this.ensureFontThenDraw();
  }

  maxLen() { return this.state.mode === "company" ? 30 : 20; }

  /* Formata conforme o modo. Nome = Title Case (conectores minúsculos); Empresa = MAIÚSCULO preservando Enter. */
  formatName(raw) {
    // Sanitiza: mantém letras/acentos, números, espaço e . ' - ; remove emojis e demais símbolos.
    // Normaliza variantes de apóstrofo (’ ‘ ´ `) para o apóstrofo reto.
    const clean = (raw || "").normalize("NFC").replace(/[’‘´`]/g, "'");
    if (this.state.mode === "company") {
      // EMPRESA: maiúsculo, preserva as quebras de linha (Enter) feitas pelo cliente
      return clean
        .replace(/[^\p{L}0-9 .'\-\n]/gu, "")
        .toUpperCase()
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n");
    }
    // NOME: Title Case (mantém acentos) + conectores em minúsculo (da, de, do...)
    const s = clean.replace(/[^\p{L}0-9 .'\-]/gu, "").replace(/\s+/g, " ").replace(/^\s/, "");
    const titled = s.toLowerCase().replace(/(^|\s|['\-])([\p{L}0-9])/gu, (m, sep, ch) => sep + ch.toUpperCase());
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
    // Sigla/inicial (1-2 letras, COM ou SEM ponto): "G", "G.", "S.", "Jr" — nunca fica sozinha na linha
    const isAbbrev = (w) => /^\p{L}{1,2}\.?$/u.test(w);
    const words = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const lines = [];
    let buffer = "";
    words.forEach((w) => {
      if (NAME_CONNECTORS.has(w.toLowerCase())) {
        // conector (da/de/do...) gruda na próxima palavra
        buffer = buffer ? buffer + " " + w : w;
      } else if (isAbbrev(w)) {
        // sigla gruda na palavra ANTERIOR — quebra só depois dela (nunca isola a sigla)
        if (buffer) buffer = buffer + " " + w;
        else if (lines.length) lines[lines.length - 1] += " " + w;
        else buffer = w;
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
    if (this.lazy && !this._lazyLoaded) {
      this._lazyLoaded = true;
      if (!document.querySelector('link[href*="family=Oswald"]')) {
        const font = document.createElement("link");
        font.rel = "stylesheet";
        font.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@600&display=swap";
        document.head.appendChild(font);
      }
      this.preloadImages();
    }
    this.hidden = false;
    document.documentElement.style.overflow = "hidden";
    this.ensureFontThenDraw();
  }

  /* Modo carrinho: abre para uma linha do minicart (dados do link .cnm-cart-open-js). */
  openForLine(line) {
    this._line = line;
    const info = this.querySelector(".cnm__cart-product");
    if (info) info.textContent = [line.title, line.variantTitle].filter(Boolean).join(" — ");
    const split = this.querySelector(".cnm__cart-split");
    if (split) split.hidden = !(line.quantity > 1);
    // cada camisa começa do zero (Nome, Frente, campo vazio)
    if (this.nameInput) this.nameInput.value = "";
    this.state.name = "";
    const nameMode = this.querySelector('[data-mode="name"]');
    if (nameMode) this.setMode("name", nameMode);
    this.setSide("frente");
    if (this.counter) this.counter.textContent = `0/${this.maxLen()}`;
    if (this.acceptInput) this.acceptInput.checked = false;
    const msg = this.querySelector(".cnm__msg");
    if (msg) msg.hidden = true;
    this.syncBuyEnabled();
    this.open();
  }

  // Dados das variantes (id + options) embutidos no bloco.
  getVariantsData() {
    if (this._variantsData) return this._variantsData;
    try {
      const el = this.querySelector(".cnm__variants-data");
      this._variantsData = el ? JSON.parse(el.textContent) : [];
    } catch (e) {
      this._variantsData = [];
    }
    return this._variantsData;
  }

  // Valores selecionados por grupo de opção, na ordem da posição (option1, option2...).
  getSelectedOptions() {
    const groups = Array.from(this.querySelectorAll(".cnm__options"));
    groups.sort((a, b) => Number(a.dataset.optionPosition) - Number(b.dataset.optionPosition));
    return groups.map((g) => {
      const checked = g.querySelector("input.cnm__opt-input:checked");
      return checked ? checked.value : null;
    });
  }

  // Encontra a variante cujas options batem com a seleção.
  resolveVariantId(options) {
    const match = this.getVariantsData().find(
      (v) =>
        Array.isArray(v.options) &&
        v.options.length === options.length &&
        v.options.every((opt, i) => opt === options[i])
    );
    return match ? match.id : null;
  }

  /* Reflete no modal a variante selecionada na página ao abrir (marca as opções; o cliente pode trocar depois). */
  syncSizeFromProduct() {
    const forms = Array.from(document.querySelectorAll('form[action*="/cart/add"]'));
    const form = forms.find((f) => !((f.getAttribute("id") || "").startsWith("sticky"))) || forms[0];
    const input = form && form.querySelector('[name="id"]');
    const currentId = input && input.value;
    if (!currentId) return;
    const variant = this.getVariantsData().find((v) => String(v.id) === String(currentId));
    if (!variant || !Array.isArray(variant.options)) return;
    const groups = Array.from(this.querySelectorAll(".cnm__options"));
    groups.sort((a, b) => Number(a.dataset.optionPosition) - Number(b.dataset.optionPosition));
    groups.forEach((g, i) => {
      g.querySelectorAll("input.cnm__opt-input").forEach((r) => {
        if (r.value === variant.options[i]) r.checked = true;
      });
    });
  }
  close() {
    this.hidden = true;
    document.documentElement.style.overflow = "";
  }

  /* ---------- carrinho (2 passos) ---------- */
  getShirtVariantId() {
    // 1) resolve pela seleção de opções no modal (1 grupo por opção: Cor, Tamanho...)
    const groups = this.querySelectorAll(".cnm__options");
    if (groups.length) {
      const opts = this.getSelectedOptions();
      if (opts.every(Boolean)) {
        const id = this.resolveVariantId(opts);
        if (id) return String(id);
      }
    }
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
    if (this.hasAttribute("data-cart-mode")) return this.buyForCartLine(name);
    const shirtId = this.getShirtVariantId();
    if (!shirtId) { this.flash("Selecione as opções do produto."); return; }
    if (!this.cfg.variantId) { this.flash("Produto de personalização não configurado."); return; }

    if (buyBtn) { buyBtn.disabled = true; buyBtn.dataset.loading = "true"; }
    try {
      // Brindes/add-ons do app BRK Bundles marcados na página: o modal não submete o
      // form do produto, então pede os itens à API do app ANTES de adicionar a camisa
      // (o limite por carrinho é calculado sem ela) e os adiciona DEPOIS que ela entrou.
      const bundles = window.BRKBundles;
      let bundleItems = [];
      if (bundles && typeof bundles.prepareAddons === "function") {
        try {
          bundleItems = await bundles.prepareAddons({ quantity: 1 });
        } catch (e) {
          bundleItems = [];
        }
        if (bundleItems === null) return; // fechou o popup do bundle → cancela
      }

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
      // origem da personalização (oculta no checkout, vai pro pedido): produto | minicart
      fd.append("items[1][properties][_origem]", "produto");

      const r2 = await fetch(this.root + "cart/add.js", { method: "POST", headers: { Accept: "application/json" }, body: fd });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error((d2 && d2.description) || "Erro ao adicionar ao carrinho");

      // Add-ons do bundle (falha aqui não desfaz a compra da camisa)
      if (bundleItems.length) await bundles.addAddons(bundleItems);

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

  /* Modo carrinho: tira 1 unidade da camisa do carrinho e a devolve como linha
     própria com o PE1198 aninhado (vale para 1 ou N unidades).
     - A camisa nova leva a property oculta _brk_perso (valor único): sem ela o
       Shopify soma na linha igual que já existe e o nome ficaria preso a todas as
       unidades. O app da Intelipost regrava as properties das linhas a cada mudança
       no carrinho (_Preço com desconto), o que troca as keys e funde linhas iguais;
       a property única mantém a personalizada separada.
     - Ordem: baixa 1 unidade da linha original (localizada no /cart.js na hora: a
       key do minicart pode ter mudado) e só depois adiciona a personalizada. Ao
       contrário, o Intelipost (que relê o carrinho após cada add e regrava as linhas
       com a quantidade que leu) devolvia a unidade retirada. Se o add falhar, a
       unidade volta; no fim confere a quantidade e corrige se foi revertida. */
  async buyForCartLine(name) {
    const line = this._line;
    const buyBtn = this.querySelector(".cnm__buy");
    if (!line || !line.variantId) { this.flash("Não foi possível identificar a camisa no carrinho."); return; }
    if (!this.cfg.variantId) { this.flash("Produto de personalização não configurado."); return; }

    if (buyBtn) { buyBtn.disabled = true; buyBtn.dataset.loading = "true"; }
    const postJson = (path, data) =>
      fetch(this.root + path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) });
    const getCart = () => fetch(this.root + "cart.js", { cache: "no-store", headers: { Accept: "application/json" } }).then((r) => r.json());
    // linha "simples" da camisa: mesma variante, sem pai/filho (= ainda sem PE1198), fora de bundle/brinde
    const findSource = (cart) => {
      const items = (cart && cart.items) || [];
      const parentKeys = new Set(items.filter((i) => i.parent_relationship).map((i) => i.parent_relationship.parent_key));
      const ok = items.filter((i) => {
        const p = i.properties || {};
        return String(i.variant_id) === String(line.variantId) && !i.parent_relationship && !parentKeys.has(i.key) &&
          !p._brk_bundle && p._brk_gift_progress !== "true";
      });
      return ok.find((i) => i.key === line.key) || ok[0] || null;
    };
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    try {
      const src0 = findSource(await getCart());
      if (!src0) throw new Error("Essa camisa não está mais disponível para personalizar no carrinho.");
      const expected = src0.quantity - 1;

      // 1) baixa 1 unidade da linha original
      const rc = await postJson("cart/change.js", { id: src0.key, quantity: expected });
      if (!rc.ok) throw new Error("O carrinho mudou. Tente novamente.");
      const restore = async () => {
        try {
          const src = findSource(await getCart());
          if (src) await postJson("cart/change.js", { id: src.key, quantity: src.quantity + 1 });
          else await postJson("cart/add.js", { items: [{ id: Number(line.variantId), quantity: 1 }] });
        } catch (e) {}
      };

      // 2) adiciona a camisa personalizada (linha própria) + PE1198
      const tag = String(Date.now());
      const blob = await this.exportPng();
      const fd = new FormData();
      fd.append("items[0][id]", String(line.variantId));
      fd.append("items[0][quantity]", "1");
      fd.append("items[0][properties][_brk_perso]", tag);
      fd.append("items[1][id]", String(this.cfg.variantId));
      fd.append("items[1][quantity]", "1");
      fd.append("items[1][parent_id]", String(line.variantId));
      if (line.sku) fd.append("items[1][properties][Produto]", line.sku);
      fd.append("items[1][properties][Tipo]", this.state.modeLabel);
      fd.append("items[1][properties][Nome]", name);
      fd.append("items[1][properties][Local]", this.state.side === "frente" ? "Frente" : "Costas");
      fd.append("items[1][properties][Posição]", this.state.posLabel || "");
      if (blob) fd.append("items[1][properties][Arte]", blob, "personalizacao.png");
      fd.append("items[1][properties][_origem]", "minicart");
      let r;
      try {
        r = await fetch(this.root + "cart/add.js", { method: "POST", headers: { Accept: "application/json" }, body: fd });
      } catch (e) {
        await restore();
        throw e;
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        await restore();
        throw new Error((d && d.description) || "Erro ao adicionar a personalização");
      }

      // 3) confere: o Intelipost pode regravar a linha original com a quantidade antiga
      if (expected > 0) {
        for (let attempt = 0; attempt < 2; attempt++) {
          await wait(1200);
          const src = findSource(await getCart());
          if (!src || src.quantity <= expected) break;
          await postJson("cart/change.js", { id: src.key, quantity: expected });
        }
      }

      this._line = null;
      this.close();
    } catch (e) {
      this.flash((e && e.message) || "Não foi possível adicionar a personalização.");
    } finally {
      if (buyBtn) delete buyBtn.dataset.loading;
      this.syncBuyEnabled();
      // atualiza o minicart (e a página /cart) mesmo em erro (a linha pode ter mudado)
      const cn = document.querySelector("cart-notification");
      if (cn && typeof cn.refreshMinicartSection === "function") {
        try { await cn.refreshMinicartSection(); } catch (e) {}
      }
      await this.refreshCartPage();
    }
  }

  /* Página /cart (sections/main-cart-items): re-renderiza os itens como o próprio
     tema faz (assets/cart.js, CartItems.splitBrkAddon). Fora do /cart não faz nada. */
  async refreshCartPage() {
    const items = document.querySelector("cart-items");
    const main = document.getElementById("main-cart-items");
    if (!items || !main || typeof items.getSectionsToRender !== "function") return;
    try {
      const sectionId = items.getSectionsToRender()[0].section;
      const [html, cart] = await Promise.all([
        fetch(`${window.location.pathname}?section_id=${sectionId}`, { cache: "no-store" }).then((r) => r.text()),
        fetch(this.root + "cart.json", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (typeof CartUtils === "undefined") { window.location.reload(); return; }
      CartUtils.updateCartCount(cart.item_count);
      CartUtils.updateHeaderTotalPrice(cart);
      CartUtils.updateFreeShippingBar(cart.items_subtotal_price);
      CartUtils.updateCartUI({
        parsedState: { ...cart, sections: { [sectionId]: html } },
        sectionsToRender: items.getSectionsToRender(),
        cartInstance: items,
        totalsSelector: ".cart-info .totals",
      });
    } catch (e) {
      window.location.reload();
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

// Abertura pelo minicart: link .cnm-cart-open-js (snippets/cart-item.liquid) → #cnm-cart
document.addEventListener("click", (e) => {
  const trigger = e.target.closest(".cnm-cart-open-js");
  if (!trigger) return;
  e.preventDefault();
  const modal = document.getElementById("cnm-cart");
  if (!modal || typeof modal.openForLine !== "function") return;
  modal.openForLine({
    key: trigger.dataset.lineKey,
    variantId: trigger.dataset.variantId,
    quantity: Number(trigger.dataset.quantity) || 1,
    sku: trigger.dataset.sku || "",
    title: trigger.dataset.title || "",
    variantTitle: trigger.dataset.variantTitle || "",
  });
});
})();
