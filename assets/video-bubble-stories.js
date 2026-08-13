/* ============================================================
   Video Bubble Stories
   Floating "phone" bubble that expands into IG-style stories.
   - Lazy video loading (src injected on demand)
   - Session dismissal (sessionStorage)
   - Resilient tracking: Clarity + dataLayer + CustomEvent
   ============================================================ */
(function () {
  'use strict';

  const SESSION_KEY = 'vb-stories-closed';
  const idle =
    window.requestIdleCallback ||
    function (cb) {
      return setTimeout(function () {
        cb({ didTimeout: false, timeRemaining: () => 0 });
      }, 1);
    };

  class VideoBubble extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;

      // Config from data-attributes
      this.storyDuration = parseFloat(this.dataset.storyDuration) || 6;
      this.autoplayPreview = this.dataset.autoplayPreview === 'true';
      this.tracking = this.dataset.tracking === 'true';
      this.loopStories = this.dataset.loopStories === 'true';

      // Audio state (stories open with sound; user can control it)
      this.userVolume = 1;
      this.userMuted = false;

      // Respect a same-session dismissal (but always show inside the editor)
      const inEditor =
        window.Shopify && window.Shopify.designMode === true;
      if (!inEditor) {
        try {
          if (sessionStorage.getItem(SESSION_KEY) === '1') {
            this.remove();
            return;
          }
        } catch (e) {
          /* sessionStorage unavailable — carry on */
        }
      }

      // Children are parsed (deferred script), reveal the bubble.
      requestAnimationFrame(() => this.setup());
    }

    setup() {
      this.mini = this.querySelector('.vb__mini');
      this.template = this.querySelector('.vb__template');
      if (!this.mini || !this.template) return;

      this.removeAttribute('hidden');

      // Open interactions
      this.mini.addEventListener('click', (e) => {
        if (e.target.closest('[data-vb-dismiss]')) return;
        this.open();
      });
      this.mini.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.open();
        }
      });

      // Dismiss (X on the closed bubble)
      const dismiss = this.mini.querySelector('[data-vb-dismiss]');
      if (dismiss) {
        dismiss.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismiss();
        });
      }

      this.track('bubble_impression', {});

      // The closed bubble always shows the lightweight poster image first.
      // Preview VIDEO strategy:
      //  - a dedicated LIGHT clip (data-light) autoplays ~2.5s after load on any
      //    device (citerol-style) — it's tiny, so it doesn't hurt metrics.
      //  - otherwise (heavy first-story video) we never auto-download: desktop
      //    loads it only on hover, mobile stays poster-only.
      const miniVid = this.mini.querySelector('.vb__mini-video');
      const light = miniVid && miniVid.dataset.light === 'true';
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;

      if (this.autoplayPreview && (light || isDesktop)) {
        // Let the page settle (~2.5s), then load during an idle slot.
        setTimeout(() => idle(() => this.startPreview(), { timeout: 2000 }), 2500);
      } else if (isDesktop) {
        this.mini.addEventListener('mouseenter', () => this.startPreview(), {
          once: true,
        });
      }
    }

    startPreview() {
      const v = this.mini.querySelector('.vb__mini-video');
      if (!v || !v.dataset.src) return;
      // Never auto-download a heavy (non-dedicated) preview on small screens.
      if (v.dataset.light !== 'true' && window.matchMedia('(max-width: 767px)').matches) return;
      v.src = v.dataset.src;
      v.removeAttribute('data-src');
      const play = v.play();
      if (play && play.then) {
        play
          .then(() => v.classList.add('is-playing'))
          .catch(() => {
            /* autoplay blocked — poster stays visible */
          });
      } else {
        v.classList.add('is-playing');
      }
    }

    /* ---------------- Open / close ---------------- */
    open() {
      if (this.classList.contains('is-open')) return;

      const frag = this.template.content.cloneNode(true);
      this.appendChild(frag);
      this.viewer = this.querySelector('.vb__viewer');
      this.stage = this.querySelector('.vb__stage');
      this.slides = Array.prototype.slice.call(
        this.querySelectorAll('.vb__slide')
      );
      this.bars = Array.prototype.slice.call(
        this.querySelectorAll('.vb__progress-bar')
      );
      if (!this.slides.length) return;

      this.classList.add('is-open');
      document.documentElement.classList.add('vb-lock');
      document.body.style.overflow = 'hidden';

      // close handlers
      this.querySelectorAll('[data-vb-close]').forEach((el) =>
        el.addEventListener('click', () => this.close())
      );
      this._onKey = (e) => {
        if (e.key === 'Escape') this.close();
      };
      document.addEventListener('keydown', this._onKey);

      // CTA click tracking (fires before navigation)
      this.querySelectorAll('[data-vb-cta]').forEach((cta) => {
        cta.addEventListener('click', () => {
          this.track('cta_click', {
            vb_type: cta.dataset.linkType || '',
            vb_handle: cta.dataset.handle || '',
            vb_index: this.current,
          });
        });
      });

      this.bindStageNavigation();
      this.bindAudio();

      requestAnimationFrame(() => this.viewer.classList.add('is-visible'));

      this.current = -1;
      this.track('bubble_open', {});
      this.goTo(0);
    }

    close() {
      if (!this.classList.contains('is-open')) return;
      this.pauseCurrent();
      if (this._onKey) document.removeEventListener('keydown', this._onKey);
      document.documentElement.classList.remove('vb-lock');
      document.body.style.overflow = '';
      this.classList.remove('is-open');
      this.track('bubble_close', { vb_last_index: this.current });

      if (this.viewer) {
        this.viewer.classList.remove('is-visible');
        const v = this.viewer;
        setTimeout(() => {
          if (v && v.parentNode) v.parentNode.removeChild(v);
        }, 320);
        this.viewer = null;
      }
    }

    dismiss() {
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch (e) {
        /* ignore */
      }
      this.track('bubble_dismiss', {});
      this.remove();
    }

    /* ---------------- Story machine ---------------- */
    goTo(index) {
      if (index < 0) index = 0;
      if (index >= this.slides.length) {
        if (this.loopStories) {
          index = 0;
        } else {
          this.close();
          return;
        }
      }
      if (index === this.current) return;

      this.pauseCurrent();
      this.current = index;

      this.slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
      this.bars.forEach((b, i) => {
        b.classList.toggle('is-active', i === index);
        b.classList.toggle('is-done', i < index);
        if (i === index) b.style.setProperty('--progress', '0');
      });

      const slide = this.slides[index];
      const video = slide.querySelector('.vb__video');
      this.activeVideo = video;

      this.loadVideo(video);
      // Warm the next story so it starts instantly
      const next = this.slides[index + 1];
      if (next) this.loadVideo(next.querySelector('.vb__video'));

      if (video) {
        video.currentTime = 0;
        video.muted = this.userMuted;
        video.volume = this.userMuted ? 0 : this.userVolume;
        video.onended = () => this.next();
        video.ontimeupdate = () => this.syncProgress();
        video.onloadedmetadata = () => this.syncProgress();
        const p = video.play();
        if (p && p.catch) {
          p.catch(() => {
            // Sound blocked by the browser — fall back to muted, reflect in UI
            this.userMuted = true;
            video.muted = true;
            this.updateAudioUI();
            video.play().catch(() => this.fallbackTimer());
          });
        }
      } else {
        this.fallbackTimer();
      }

      this.track('story_view', {
        vb_index: index,
        vb_type: slide.dataset.linkType || '',
        vb_handle: slide.dataset.handle || '',
        vb_title: slide.dataset.title || '',
      });
    }

    next() {
      this.goTo(this.current + 1);
    }
    prev() {
      this.goTo(this.current - 1);
    }

    syncProgress() {
      const v = this.activeVideo;
      const bar = this.bars[this.current];
      if (!v || !bar) return;
      const d = v.duration && isFinite(v.duration) ? v.duration : this.storyDuration;
      const ratio = Math.min(1, v.currentTime / d);
      bar.style.setProperty('--progress', ratio.toFixed(4));
    }

    fallbackTimer() {
      // No usable video — advance on a plain timer with a rAF progress bar
      const bar = this.bars[this.current];
      const start = performance.now();
      const dur = this.storyDuration * 1000;
      const step = (now) => {
        if (this.current === -1 || !this.classList.contains('is-open')) return;
        const ratio = Math.min(1, (now - start) / dur);
        if (bar) bar.style.setProperty('--progress', ratio.toFixed(4));
        if (ratio >= 1) {
          this.next();
        } else {
          this._raf = requestAnimationFrame(step);
        }
      };
      this._raf = requestAnimationFrame(step);
    }

    pauseCurrent() {
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this.activeVideo) {
        this.activeVideo.pause();
        this.activeVideo.onended = null;
        this.activeVideo.ontimeupdate = null;
      }
    }

    loadVideo(video) {
      if (video && video.dataset.src) {
        video.src = video.dataset.src;
        video.removeAttribute('data-src');
      }
    }

    /* ---------------- Tap / hold navigation ---------------- */
    bindStageNavigation() {
      let downX = 0;
      let downT = 0;
      let holdTimer = null;
      let held = false;

      const onDown = (e) => {
        if (e.target.closest('[data-vb-cta], [data-vb-close], [data-vb-audio]')) return;
        downX = e.clientX;
        downT = performance.now();
        held = false;
        holdTimer = setTimeout(() => {
          held = true;
          this.pauseHold();
        }, 220);
      };
      const onUp = (e) => {
        if (e.target.closest('[data-vb-cta], [data-vb-close], [data-vb-audio]')) return;
        clearTimeout(holdTimer);
        if (held) {
          this.resumeHold();
          return;
        }
        // quick tap -> navigate by horizontal position
        const rect = this.stage.getBoundingClientRect();
        const x = (e.clientX || downX) - rect.left;
        if (x < rect.width * 0.33) this.prev();
        else this.next();
      };
      const onCancel = () => {
        clearTimeout(holdTimer);
        if (held) this.resumeHold();
      };

      this.stage.addEventListener('pointerdown', onDown);
      this.stage.addEventListener('pointerup', onUp);
      this.stage.addEventListener('pointercancel', onCancel);
      this.stage.addEventListener('pointerleave', onCancel);
    }

    pauseHold() {
      this.stage.classList.add('is-paused');
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this.activeVideo && this.activeVideo.src) this.activeVideo.pause();
    }
    resumeHold() {
      this.stage.classList.remove('is-paused');
      if (this.activeVideo && this.activeVideo.src) {
        this.activeVideo.play().catch(() => {});
      } else {
        // resume fallback timer roughly from current progress
        this.fallbackTimer();
      }
    }

    /* ---------------- Audio control ---------------- */
    bindAudio() {
      this.audioBox = this.querySelector('.vb__audio');
      this.audioToggle = this.querySelector('.vb__audio-toggle');
      this.volumeInput = this.querySelector('.vb__volume');
      if (this.audioToggle) {
        this.audioToggle.addEventListener('click', () => this.toggleMute());
      }
      if (this.volumeInput) {
        this.volumeInput.addEventListener('input', (e) =>
          this.setVolume(parseFloat(e.target.value))
        );
      }
      this.updateAudioUI();
    }

    toggleMute() {
      this.userMuted = !this.userMuted;
      if (!this.userMuted && this.userVolume === 0) this.userVolume = 1;
      this.applyAudio();
      this.updateAudioUI();
      this.track(this.userMuted ? 'audio_mute' : 'audio_unmute', {
        vb_index: this.current,
      });
    }

    setVolume(v) {
      this.userVolume = v;
      this.userMuted = v === 0;
      this.applyAudio();
      this.updateAudioUI();
    }

    applyAudio() {
      if (this.activeVideo) {
        this.activeVideo.muted = this.userMuted;
        this.activeVideo.volume = this.userMuted ? 0 : this.userVolume;
      }
    }

    updateAudioUI() {
      const off = this.userMuted || this.userVolume === 0;
      if (this.audioBox) this.audioBox.classList.toggle('is-muted', off);
      if (this.volumeInput) this.volumeInput.value = off ? 0 : this.userVolume;
    }

    /* ---------------- Tracking ---------------- */
    track(event, payload) {
      if (!this.tracking) return;
      payload = payload || {};
      try {
        // Microsoft Clarity — event + filterable session tags
        if (typeof window.clarity === 'function') {
          window.clarity('event', 'video_bubble_' + event);
          Object.keys(payload).forEach((k) => {
            if (payload[k] !== '' && payload[k] != null) {
              window.clarity('set', k, String(payload[k]));
            }
          });
        }
      } catch (e) {
        /* ignore */
      }
      try {
        // GTM / GA dataLayer
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(
          Object.assign({ event: 'video_bubble', vb_action: event }, payload)
        );
      } catch (e) {
        /* ignore */
      }
      // Local hook for any custom listener
      document.dispatchEvent(
        new CustomEvent('video-bubble:' + event, { detail: payload })
      );
    }
  }

  if (!customElements.get('video-bubble')) {
    customElements.define('video-bubble', VideoBubble);
  }
})();
