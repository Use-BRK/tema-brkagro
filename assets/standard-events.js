/**
 * Shopify Standard Storefront Events
 * Emits standard events for analytics, apps, and agents.
 * https://shopify.dev/docs/storefronts/themes/best-practices/standard-events
 */
(async function () {
  const SE = await import('https://cdn.shopify.com/storefront/standard-events.js');

  /* ── Helper: build cart payload from /cart.js response ── */
  function cartFromAjax(cart) {
    return SE.CartViewEvent.createCartFromAjaxResponse
      ? SE.CartViewEvent.createCartFromAjaxResponse(cart)
      : {
          id: cart.token,
          totalQuantity: cart.item_count,
          cost: {
            totalAmount: {
              amount: (cart.total_price / 100).toFixed(2),
              currencyCode: window.Shopify?.currency?.active || 'BRL',
            },
          },
          lines: (cart.items || []).map(function (item) {
            return {
              id: item.key,
              quantity: item.quantity,
              cost: {
                totalAmount: {
                  amount: (item.final_line_price / 100).toFixed(2),
                  currencyCode: window.Shopify?.currency?.active || 'BRL',
                },
              },
            };
          }),
          discountCodes: (cart.cart_level_discount_applications || []).map(function (d) {
            return { code: d.title || '', applicable: true };
          }),
        };
  }

  /* ── 1. shopify:page:view ── */
  document.addEventListener('DOMContentLoaded', function () {
    try {
      document.dispatchEvent(
        new SE.PageViewEvent({
          page: {
            template: window.Shopify?.templateName || document.body.dataset.template || '',
            title: document.title,
            url: window.location.href,
          },
        })
      );
    } catch (e) {
      console.warn('[SE] page:view error', e);
    }
  });

  /* ── 2. shopify:product:view ── */
  document.addEventListener('DOMContentLoaded', function () {
    try {
      var productData = document.querySelector('[data-standard-event-product]');
      if (!productData) return;

      var data = JSON.parse(productData.textContent);
      if (!data || !data.id) return;

      var target = document.querySelector('.sec__product-main') || document.querySelector('.product-detail') || document;

      target.dispatchEvent(
        new SE.ProductViewEvent({
          context: 'page',
          product: {
            id: data.id,
            title: data.title,
            handle: data.handle,
            selectedVariant: data.selectedVariant || null,
          },
        })
      );
    } catch (e) {
      console.warn('[SE] product:view error', e);
    }
  });

  /* ── 3. shopify:cart:lines-update (intercept fetch to cart/add, cart/change, cart/update) ── */
  var originalFetch = window.fetch;
  window.fetch = function (url, options) {
    var urlStr = typeof url === 'string' ? url : url?.url || '';

    var isCartAdd = /\/cart\/add/i.test(urlStr);
    var isCartChange = /\/cart\/change/i.test(urlStr);
    var isCartUpdate = /\/cart\/update/i.test(urlStr);

    if (!isCartAdd && !isCartChange && !isCartUpdate) {
      return originalFetch.apply(this, arguments);
    }

    var action = isCartAdd ? 'add' : isCartChange ? 'update' : 'update';
    var context = isCartAdd ? 'product' : 'cart';

    return originalFetch.apply(this, arguments).then(function (response) {
      // Fetch fresh cart and emit event
      originalFetch('/cart.js')
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          try {
            var deferred = SE.CartLinesUpdateEvent.createPromise();
            var target = document.querySelector('cart-notification') || document.querySelector('#minicart_wrapper') || document;
            target.dispatchEvent(
              new SE.CartLinesUpdateEvent({
                action: action,
                context: context,
                lines: [],
                promise: deferred.promise,
              })
            );
            deferred.resolve({ cart: cartFromAjax(cart) });
          } catch (e) {
            console.warn('[SE] cart:lines-update error', e);
          }
        })
        .catch(function () {});

      return response;
    });
  };

  /* ── 4. shopify:cart:view (when minicart drawer opens) ── */
  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type !== 'attributes') return;
      var target = m.target;
      if (!target.classList) return;

      // Detect minicart open
      if (target.classList.contains('minicart__wrapper') && target.classList.contains('open')) {
        originalFetch('/cart.js')
          .then(function (r) { return r.json(); })
          .then(function (cart) {
            try {
              target.dispatchEvent(
                new SE.CartViewEvent({
                  context: 'dialog',
                  cart: cartFromAjax(cart),
                })
              );
            } catch (e) {
              console.warn('[SE] cart:view error', e);
            }
          })
          .catch(function () {});
      }
    });
  });

  var minicartWrapper = document.querySelector('.minicart__wrapper');
  if (minicartWrapper) {
    observer.observe(minicartWrapper, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── 5. shopify:collection:view ── */
  document.addEventListener('DOMContentLoaded', function () {
    try {
      var collectionData = document.querySelector('[data-standard-event-collection]');
      if (!collectionData) return;

      var data = JSON.parse(collectionData.textContent);
      if (!data || !data.id) return;

      var target = document.querySelector('.sec__collection-main') || document;

      target.dispatchEvent(
        new SE.CollectionViewEvent({
          collection: {
            id: data.id,
            handle: data.handle,
            productsCount: data.productsCount,
          },
        })
      );
    } catch (e) {
      console.warn('[SE] collection:view error', e);
    }
  });

  /* ── 6. shopify:search:update ── */
  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (window.Shopify?.templateName !== 'search') return;

      var params = new URLSearchParams(window.location.search);
      var query = params.get('q') || '';
      if (!query) return;

      var target = document.querySelector('.sec__search-main') || document;

      target.dispatchEvent(
        new SE.SearchUpdateEvent({
          search: {
            query: query,
            productFilters: [],
            sortKey: params.get('sort_by') || 'RELEVANCE',
          },
        })
      );
    } catch (e) {
      console.warn('[SE] search:update error', e);
    }
  });

  /* ── 7. Register standard actions ── */
  window.Shopify = window.Shopify || {};
  window.Shopify.actions = window.Shopify.actions || {};

  // openCart — open minicart drawer
  if (!window.Shopify.actions.openCart) {
    window.Shopify.actions.openCart = function () {
      var minicart = document.querySelector('cart-notification');
      if (minicart && typeof minicart.open === 'function') {
        minicart.open();
        return Promise.resolve();
      }
      // fallback: redirect to cart
      window.location.href = '/cart';
      return Promise.resolve();
    };
  }

  // getCart — return current cart data
  if (!window.Shopify.actions.getCart) {
    window.Shopify.actions.getCart = function () {
      return originalFetch('/cart.js')
        .then(function (r) { return r.json(); })
        .then(function (cart) { return { cart: cartFromAjax(cart) }; });
    };
  }
})();
