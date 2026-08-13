/* ============================================================
   Banner Carousel
   Swiper com slidesPerView:'auto' — a largura de cada card vem do CSS
   (px no desktop, itens-por-linha no mobile).
   ============================================================ */
(function () {
  'use strict';

  class BannerCarousel extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.whenSwiperReady(() => this.build());
    }

    disconnectedCallback() {
      if (this.swiper) {
        try {
          this.swiper.destroy(true, true);
        } catch (e) {
          /* ignore */
        }
        this.swiper = null;
      }
    }

    whenSwiperReady(cb) {
      if (typeof window.Swiper !== 'undefined') {
        cb();
        return;
      }
      let tries = 0;
      const timer = setInterval(() => {
        if (typeof window.Swiper !== 'undefined') {
          clearInterval(timer);
          cb();
        } else if (++tries > 60) {
          clearInterval(timer);
        }
      }, 100);
    }

    build() {
      const el = this.querySelector('.banner-carousel__swiper');
      if (!el || this.swiper) return;

      const gap = parseInt(this.dataset.gap, 10) || 12;
      const autoplayOn = this.dataset.autoplay === 'true';
      const speed = (parseInt(this.dataset.autoplaySpeed, 10) || 4) * 1000;
      const loop = this.dataset.loop === 'true';

      this.swiper = new window.Swiper(el, {
        slidesPerView: 'auto',
        spaceBetween: gap,
        loop: loop,
        speed: 500,
        grabCursor: true,
        watchOverflow: true,
        autoplay: autoplayOn
          ? { delay: speed, disableOnInteraction: false, pauseOnMouseEnter: true }
          : false,
        navigation: {
          nextEl: this.querySelector('.swiper-button-next'),
          prevEl: this.querySelector('.swiper-button-prev'),
        },
        pagination: {
          el: this.querySelector('.swiper-pagination'),
          clickable: true,
        },
      });
    }
  }

  if (!customElements.get('banner-carousel')) {
    customElements.define('banner-carousel', BannerCarousel);
  }
})();
