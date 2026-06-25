/*
 * Carrossel simples de benefícios — setas, sem barra de scroll.
 * Track com scroll-snap; setas avançam ~uma "tela"; setas somem quando não há
 * mais pra rolar. Itens por linha vêm de CSS vars (desktop/tablet/mobile).
 */
class BenefitsCarousel extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;
    this.track = this.querySelector(".pb-track");
    this.prev = this.querySelector(".pb-arrow--prev");
    this.next = this.querySelector(".pb-arrow--next");
    if (!this.track) return;

    this.prev && this.prev.addEventListener("click", () => this.page(-1));
    this.next && this.next.addEventListener("click", () => this.page(1));
    this.track.addEventListener("scroll", () => this.update(), { passive: true });
    window.addEventListener("resize", () => this.update());
    // primeira atualização após layout/imagens
    requestAnimationFrame(() => this.update());
    setTimeout(() => this.update(), 300);
  }

  page(dir) {
    this.track.scrollBy({ left: dir * this.track.clientWidth * 0.9, behavior: "smooth" });
  }

  update() {
    const t = this.track;
    const max = t.scrollWidth - t.clientWidth - 2;
    const scrollable = t.scrollWidth > t.clientWidth + 2;
    if (this.prev) this.prev.hidden = !scrollable || t.scrollLeft <= 2;
    if (this.next) this.next.hidden = !scrollable || t.scrollLeft >= max;
  }
}
if (!customElements.get("benefits-carousel")) {
  customElements.define("benefits-carousel", BenefitsCarousel);
}
