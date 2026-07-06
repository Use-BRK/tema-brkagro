/**
 * PE1198 guard (tema) — feedback imediato no carrinho.
 *
 * O item de personalização (SKU PE1198) só pode ser comprado junto de uma peça,
 * via o modal "Quero meu nome na Camisa" (que anexa as properties Nome/Local).
 * Se o PE1198 entrar avulso (permalink de carrinho, botão escondido), este script:
 *   - bloqueia os botões de checkout (carrinho e minicart);
 *   - exibe a MESMA notificação de erro do tema (#cart-errors / antes do botão).
 *
 * Camada de UX: a garantia real (bloqueio à prova de contorno) é a Shopify
 * Function `valida-personalizado` no checkout. Aqui só antecipamos o feedback.
 */
(function () {
  var PERSO_SKU = "PE1198";
  var MSG =
    'O item de personalização (nome na camisa) não pode ser comprado separadamente. ' +
    'Use o botão "Quero meu nome na Camisa" na página do produto.';
  var ERROR_CLASS = "pe1198-guard-error";
  var offending = false;

  function isOffendingItem(item) {
    if ((item.sku || "").toUpperCase() !== PERSO_SKU) return false;
    var props = item.properties || {};
    var nome = (props["Nome"] || "").toString().trim();
    var local = (props["Local"] || "").toString().trim();
    return !nome || !local;
  }

  function errorMarkup() {
    return (
      '<div class="' + ERROR_CLASS +
      ' mt-10 error form__message inline-flex align-center" tabindex="-1" role="alert">' +
      '<svg width="18" height="18" fill="none" class="flex-auto">' +
      '<g stroke="#D0473E" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.3">' +
      '<path d="M7.977 1.198c.573-.482 1.498-.482 2.054 0l1.293 1.105a1.89 1.89 0 0 0 1.039.376h1.39c.868 0 1.58.712 1.58 1.58v1.39c0 .328.171.786.376 1.031l1.105 1.293c.482.573.482 1.497 0 2.054l-1.105 1.292c-.204.246-.376.704-.376 1.031v1.391c0 .867-.712 1.58-1.58 1.58h-1.39c-.328 0-.786.171-1.031.376L10.039 16.8c-.573.483-1.497.483-2.054 0l-1.292-1.104c-.246-.205-.712-.377-1.031-.377H4.23c-.867 0-1.58-.712-1.58-1.579v-1.399c0-.319-.163-.785-.367-1.023l-1.105-1.3c-.474-.565-.474-1.481 0-2.046l1.105-1.3c.204-.246.368-.705.368-1.024V4.267c0-.868.712-1.58 1.579-1.58h1.415c.328 0 .786-.171 1.031-.376l1.301-1.113Z"/>' +
      '<path d="M7 11l4-4M11 11 7 7"/></g></svg>' +
      '<span class="ml-5">' + MSG + "</span></div>"
    );
  }

  function checkoutButtons() {
    return document.querySelectorAll(
      '#checkout, .cart__checkout-button, .btn-checkout, button[name="checkout"]'
    );
  }

  function renderError(show) {
    // Página do carrinho: container nativo do tema.
    var cartErrors = document.getElementById("cart-errors");
    if (cartErrors) {
      var existing = cartErrors.querySelector("." + ERROR_CLASS);
      if (show && !existing) cartErrors.innerHTML = errorMarkup();
      else if (!show && existing) cartErrors.innerHTML = "";
    }
    // Minicart: injeta logo antes do botão de checkout do drawer.
    var miniBtn = document.querySelector('.btn-checkout[form="minicart"]');
    if (miniBtn && miniBtn.parentNode) {
      var miniExisting = miniBtn.parentNode.querySelector("." + ERROR_CLASS);
      if (show && !miniExisting) miniBtn.insertAdjacentHTML("beforebegin", errorMarkup());
      else if (!show && miniExisting) miniExisting.remove();
    }
  }

  function apply(show) {
    offending = show;
    checkoutButtons().forEach(function (btn) {
      if (show) {
        btn.setAttribute("disabled", "disabled");
        btn.setAttribute("aria-disabled", "true");
        btn.dataset.pe1198Blocked = "true";
      } else if (btn.dataset.pe1198Blocked) {
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-disabled");
        delete btn.dataset.pe1198Blocked;
      }
    });
    renderError(show);
  }

  var evaluating = false;
  function evaluate() {
    if (evaluating) return;
    evaluating = true;
    var root =
      (window.Shopify && Shopify.routes && Shopify.routes.root) || "/";
    fetch(root + "cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        apply((cart.items || []).some(isOffendingItem));
      })
      .catch(function () {})
      .then(function () { evaluating = false; });
  }

  // Bloqueio client-side: intercepta o clique/submit enquanto houver item avulso.
  document.addEventListener(
    "click",
    function (e) {
      if (!offending || !e.target.closest) return;
      var btn = e.target.closest(
        '#checkout, .btn-checkout, .cart__checkout-button, button[name="checkout"]'
      );
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      renderError(true);
      var el = document.querySelector("." + ERROR_CLASS);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    true
  );
  document.addEventListener(
    "submit",
    function (e) {
      if (!offending) return;
      var id = e.target && e.target.id;
      if (id === "cart" || id === "minicart") {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // Reavalia quando o carrinho muda (add/remove/qty re-renderizam o DOM).
  var debounce;
  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(evaluate, 250);
  }
  function observe() {
    var targets = [];
    var main = document.getElementById("main-cart-items");
    if (main) targets.push(main);
    document.querySelectorAll("cart-notification").forEach(function (n) { targets.push(n); });
    if (!targets.length) targets.push(document.body);
    var obs = new MutationObserver(schedule);
    targets.forEach(function (t) {
      obs.observe(t, { childList: true, subtree: true });
    });
  }

  function init() {
    evaluate();
    observe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
