/*
  Promo 2ª peça — animação do aviso do carrinho/minicart (snippet brk-promo2-cart).
  Quando a economia aumenta (o cliente fechou um par), mostra por alguns segundos a mensagem de
  "desbloqueado" e depois troca para o valor economizado, contando de 0 até o valor.
  O carrinho é re-renderizado pelo tema (innerHTML), então observamos o DOM.
*/
(function () {
  var KEY = 'brkP2Saving';
  var UNLOCK_MS = 1800;
  var COUNT_MS = 700;

  function readLast() {
    try { var v = sessionStorage.getItem(KEY); return v === null ? null : parseInt(v, 10) || 0; } catch (e) { return null; }
  }
  function writeLast(v) {
    try { sessionStorage.setItem(KEY, String(v)); } catch (e) {}
  }
  function money(cents) {
    var parts = (cents / 100).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return 'R$ ' + parts[0] + ',' + parts[1];
  }
  function countUp(el, to) {
    var start = null;
    function frame(t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / COUNT_MS);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = money(Math.round(to * eased));
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function celebrate(box) {
    if (box.dataset.p2Animated) return;
    box.dataset.p2Animated = '1';
    box.classList.add('is-celebrating');
    setTimeout(function () {
      box.classList.remove('is-celebrating');
      box.classList.add('is-revealed');
      var amount = box.querySelector('[data-p2-amount]');
      if (amount) countUp(amount, parseInt(amount.dataset.cents, 10) || 0);
    }, UNLOCK_MS);
  }

  var pending = false;
  function scan() {
    pending = false;
    var boxes = document.querySelectorAll('.brk-promo2-cart[data-p2-saving]');
    if (!boxes.length) return;
    var saving = parseInt(boxes[0].dataset.p2Saving, 10) || 0;
    var last = readLast();
    if (last !== null && saving > last) {
      boxes.forEach(celebrate);
    } else {
      boxes.forEach(function (box) { box.dataset.p2Animated = '1'; });
    }
    writeLast(saving);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(scan, 60);
  }

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var added = list[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1 && (n.matches('.brk-promo2-cart') || n.querySelector('.brk-promo2-cart') || n.querySelector('.cart-footer, cart-items'))) {
          schedule();
          return;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();
