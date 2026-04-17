(function() {
  var form = document.querySelector('form[action*="/cart/add"]');
  if (!form) return;

  var TIMEOUT = 5000;

  window.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      if (!customElements.get('product-form')) {
        var idInput = form.querySelector('[name="id"]');
        if (idInput) idInput.disabled = false;

        var btn = form.querySelector('[type="submit"]');
        if (btn) {
          btn.removeAttribute('aria-disabled');
          btn.classList.remove('loading');
          var skeleton = btn.closest('.skeleton');
          if (skeleton) skeleton.classList.remove('skeleton');
        }
        console.warn('[product-form-safety] product-form CE not defined after 5s, form enabled as native');
        return;
      }

      var pf = document.querySelector('product-form');
      if (pf && !pf.cart) {
        pf.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        if (pf.cart) {
          console.warn('[product-form-safety] Fixed product-form.cart reference');
        }
      }

      var btn = form.querySelector('[type="submit"]');
      var idInput = form.querySelector('[name="id"]');
      if (btn && btn.disabled && idInput && idInput.value) {
        var url = window.location.pathname + '.js';
        fetch(url).then(function(r) { return r.json(); }).then(function(product) {
          var variant = product.variants.find(function(v) {
            return String(v.id) === String(idInput.value);
          });
          if (variant && variant.available) {
            btn.disabled = false;
            btn.removeAttribute('aria-disabled');
            console.warn('[product-form-safety] Re-enabled add to cart button for available variant');
          }
        }).catch(function() {});
      }
    }, TIMEOUT);
  });
})();
