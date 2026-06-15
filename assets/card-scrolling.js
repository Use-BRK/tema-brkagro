(function () {
  "use strict";

  if (customElements.get("card-scrolling-element")) return;

  customElements.define(
    "card-scrolling-element",
    class extends HTMLElement {
      constructor() {
        super();
        this.container = this.parentNode;
        this.viewportHeight = Math.max(
          document.documentElement.clientHeight,
          window.innerHeight || 0
        );
        this.containerHeight = this.container.offsetHeight;
        this.mainContent = document.getElementById("MainContent");
        this.headerHeight = 0;
        this.after = false;
        this.ticking = false;

        this._onScroll = () => {
          if (!this.ticking) {
            requestAnimationFrame(() => {
              this.update();
              this.ticking = false;
            });
            this.ticking = true;
          }
        };

        this._onResize = () => {
          this.recalculate();
        };
      }

      connectedCallback() {
        this.setup();
        requestAnimationFrame(() => {
          this.update();
          window.addEventListener("scroll", this._onScroll, { passive: true });
          window.addEventListener("resize", this._onResize, { passive: true });
        });
      }

      disconnectedCallback() {
        window.removeEventListener("scroll", this._onScroll);
        window.removeEventListener("resize", this._onResize);
      }

      setup() {
        this.shopifySection = this.closest(".shopify-section");
        this.nextSection = this.shopifySection
          ? this.shopifySection.nextElementSibling
          : null;

        this.readHeaderHeight();

        this.cardScrollingStickyTop = this.headerHeight || 0;
        this.cardScrollingMarginTop = this.nextSection
          ? parseInt(
              window.getComputedStyle(this.nextSection).getPropertyValue("margin-top")
            ) || 0
          : 0;

        // Handle first-section edge case: if the previous section is very
        // small (e.g. a thin top-bar), use sticky-top: 0
        this.prevSection = this.shopifySection
          ? this.shopifySection.previousElementSibling
          : null;
        if (this.prevSection && this.mainContent) {
          const firstSection = this.mainContent.children[0];
          if (firstSection) {
            const isFirst =
              this.prevSection.id && this.prevSection.id === firstSection.id;
            const prevHeight = this.prevSection.offsetHeight;
            this.shopifySection.classList.toggle(
              "sticky-top-zero",
              isFirst && prevHeight <= 2 * this.headerHeight
            );
          }
        }

        this.opacityValue = (t) => {
          if (!t) return 0;
          if (t <= 0) return 0;
          if (t > 0 && t <= 100) return Number(t / 100).toFixed(4);
          if (t > 100) return 1;
          return 0;
        };
      }

      readHeaderHeight() {
        const stickyHeader = document.getElementById("header-sticky");
        const sectionHeader = document.querySelector(
          ".section-header.shopify-section-header-sticky"
        );
        if (sectionHeader) {
          this.headerHeight = sectionHeader.offsetHeight || 0;
        } else if (stickyHeader) {
          this.headerHeight = stickyHeader.offsetHeight || 0;
        } else {
          this.headerHeight = 0;
        }
      }

      recalculate() {
        this.viewportHeight = Math.max(
          document.documentElement.clientHeight,
          window.innerHeight || 0
        );
        this.containerHeight = this.container.offsetHeight;
        this.readHeaderHeight();
        this.cardScrollingStickyTop = this.headerHeight || 0;
        this.cardScrollingMarginTop = this.nextSection
          ? parseInt(
              window.getComputedStyle(this.nextSection).getPropertyValue("margin-top")
            ) || 0
          : 0;
      }

      update() {
        if (this.container.classList.contains("is-disabled")) return;

        // Recalculate in design mode for live editor updates
        if (window.Shopify && window.Shopify.designMode) {
          this.setup();
          this.containerHeight = this.container.offsetHeight;
        }

        const scrollTop = Math.round(window.scrollY);
        const scrollBottom = scrollTop + this.viewportHeight;
        const elementOffsetTop = Math.round(
          this.container.getBoundingClientRect().top + scrollTop
        );
        const elementOffsetBottom = elementOffsetTop + this.containerHeight;
        const isBottomPassed = elementOffsetBottom < scrollTop;
        const isTopReached = elementOffsetTop < scrollBottom;

        // Card scrolling calculations
        let currentSectionTop, nextSectionTop, sectionOffsetTop;

        if (this.shopifySection) {
          currentSectionTop = this.shopifySection.getBoundingClientRect().top;
        } else {
          currentSectionTop = this.container.getBoundingClientRect().top;
        }

        if (this.nextSection) {
          nextSectionTop = this.nextSection.getBoundingClientRect().top;
          sectionOffsetTop =
            nextSectionTop - this.containerHeight - this.cardScrollingMarginTop;
        } else {
          nextSectionTop = currentSectionTop + this.containerHeight;
          sectionOffsetTop = currentSectionTop;
        }

        this.after = Boolean(
          Math.round(
            nextSectionTop -
              this.headerHeight -
              this.cardScrollingMarginTop +
              0.1 * this.viewportHeight
          ) < 0
        );

        const isInView = isTopReached && !this.after;

        // Toggle visibility — hide section when fully scrolled past
        if (this.shopifySection) {
          this.shopifySection.classList.toggle("card-scrolling-hidden", this.after);
        }

        // Update overlay opacity
        if (isInView) {
          const t = (sectionOffsetTop / this.containerHeight) * -100;
          this.container.style.setProperty(
            "--card-scrolling-overlay",
            this.opacityValue(t)
          );
        }
      }
    }
  );
})();
