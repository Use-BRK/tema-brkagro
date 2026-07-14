/*
  media-mobile-dots
  Solid dots (paginação) para a galeria de produto quando o layout base é
  grid/stack e o Mobile layout está como "Carrossel". Como grid/stack não usam
  o Swiper, este componente gera os bullets e sincroniza o ativo pela posição
  de scroll do container (.grid_scroll). Reaproveita as classes
  .swiper-pagination-bullet / --active, então o CSS dos solid dots já se aplica.

  Observação: usa connectedCallback (não constructor) para funcionar mesmo
  quando a galeria é substituída via AJAX (troca de imagem por variante).
*/
if (!customElements.get('media-mobile-dots')) {
  class MediaMobileDots extends HTMLElement {
    connectedCallback() {
      this.pagination = this.querySelector('.swiper-pagination');
      this.scroller = document.getElementById(this.dataset.target);
      if (!this.pagination || !this.scroller) return;

      this._onScroll = this.onScroll.bind(this);
      this._ticking = false;

      this.build();
      this.scroller.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('resize', this._onScroll, { passive: true });
      requestAnimationFrame(() => this.onScroll());
    }

    disconnectedCallback() {
      this.scroller?.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onScroll);
    }

    items() {
      return Array.from(this.scroller.children);
    }

    build() {
      const items = this.items();
      this.pagination.innerHTML = '';
      if (items.length < 2) {
        this.pagination.classList.remove('swiper-pagination-bullets');
        return;
      }
      this.pagination.classList.add('swiper-pagination-bullets');
      items.forEach((_, i) => {
        const bullet = document.createElement('span');
        bullet.className =
          'swiper-pagination-bullet' + (i === 0 ? ' swiper-pagination-bullet-active' : '');
        bullet.addEventListener('click', () => this.goTo(i));
        this.pagination.appendChild(bullet);
      });
    }

    activeIndex() {
      const items = this.items();
      if (!items.length) return 0;
      const cont = this.scroller.getBoundingClientRect();
      const center = cont.left + cont.width / 2;
      let best = 0;
      let bestDist = Infinity;
      items.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - center);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      return best;
    }

    onScroll() {
      if (this._ticking) return;
      this._ticking = true;
      requestAnimationFrame(() => {
        const idx = this.activeIndex();
        const bullets = this.pagination.querySelectorAll('.swiper-pagination-bullet');
        bullets.forEach((b, i) =>
          b.classList.toggle('swiper-pagination-bullet-active', i === idx)
        );
        this._ticking = false;
      });
    }

    goTo(i) {
      const el = this.items()[i];
      if (!el) return;
      const cont = this.scroller.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const delta = r.left + r.width / 2 - (cont.left + cont.width / 2);
      this.scroller.scrollBy({ left: delta, behavior: 'smooth' });
    }
  }
  customElements.define('media-mobile-dots', MediaMobileDots);
}
