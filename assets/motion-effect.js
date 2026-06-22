/*
 * Scroll-reveal animations removed for performance (user decision: "remover de vez").
 *
 * `motion-element` and `motion-items-effect` are kept defined as INERT custom
 * elements so that all existing call sites (theme.js, global.js,
 * slideshow-section.js) keep working — every method that other code calls is a
 * no-op here. Content is never hidden, so there is no opacity:0 -> reveal flash
 * (FOUC) on desktop and no IntersectionObserver/animation work on the main
 * thread. The Motion library (motion.min.js) is untouched and still used by
 * other interactions (minicart, slideshow drag, etc.).
 */
class MotionElement extends HTMLElement {
  connectedCallback() {}
  get isHold() {
    return this.hasAttribute("hold");
  }
  preInitialize() {}
  initialize() {}
  refreshAnimation() {}
  highlightedText() {}
}
customElements.define("motion-element", MotionElement);

class MotionItemsEffect extends HTMLElement {
  connectedCallback() {}
  init() {}
  prepareAnimationEffect() {}
  setupInitialAnimation() {}
  setupInViewEffect() {}
  animateItems() {}
  reloadAnimationEffect() {}
  refreshAnimationEffect() {}
}
customElements.define("motion-items-effect", MotionItemsEffect);
