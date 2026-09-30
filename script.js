/* ============================================
   macc.lol interactive behaviors
   ============================================ */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Theme toggle ----
  // No saved choice means "follow the system"; clicking picks the opposite of
  // whatever is showing now and remembers it.
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  function currentTheme() {
    return root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
  }

  function syncToggleLabel() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${next} mode`);
  }

  if (themeToggle) {
    syncToggleLabel();
    systemDark.addEventListener('change', syncToggleLabel);
    themeToggle.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch (e) { /* storage blocked; the choice lasts for this page view */ }
      syncToggleLabel();
    });
  }

  // ---- Mobile menu ----
  const navLinks = document.getElementById('navLinks');
  const hamburger = document.getElementById('hamburger');

  function setMenu(open) {
    hamburger.classList.toggle('open', open);
    navLinks.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  }

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => setMenu(!navLinks.classList.contains('open')));
    navLinks.querySelectorAll('.nav__link').forEach((link) => {
      link.addEventListener('click', () => setMenu(false));
    });
  }

  // ---- Active nav link for the section in view ----
  const navById = new Map();
  document.querySelectorAll('.nav__link').forEach((link) => {
    navById.set(link.getAttribute('href').slice(1), link);
  });

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navById.forEach((link, id) => link.classList.toggle('active', id === entry.target.id));
      });
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );

  document.querySelectorAll('main section[id]').forEach((sec) => sectionObserver.observe(sec));

  // ---- Lightbox ----
  // Every [data-gallery] container is its own set of photos. Each direct <figure>
  // is one item; a figure holding a carousel contributes one entry per slide.
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  let activeSet = [];
  let activeIndex = 0;
  let lastFocus = null;

  function buildSet(gallery) {
    const set = [];
    const starts = new Map();
    gallery.querySelectorAll(':scope > figure').forEach((figure) => {
      starts.set(figure, set.length);
      const label = figure.querySelector('figcaption');
      figure.querySelectorAll('img').forEach((img) => {
        set.push({ src: img.currentSrc || img.src, alt: img.alt, label: label ? label.textContent : '' });
      });
    });
    return { set, starts };
  }

  function showCurrent() {
    const item = activeSet[activeIndex];
    if (!item) return;
    lightboxImg.src = item.src;
    lightboxImg.alt = item.alt;
    lightboxCaption.textContent = item.alt;
  }

  function openLightbox(set, index) {
    activeSet = set;
    activeIndex = index;
    showCurrent();
    lastFocus = document.activeElement;
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
    lightboxClose.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  function step(delta) {
    activeIndex = (activeIndex + delta + activeSet.length) % activeSet.length;
    showCurrent();
  }

  document.querySelectorAll('[data-gallery]').forEach((gallery) => {
    const { set, starts } = buildSet(gallery);
    starts.forEach((start, figure) => {
      figure.addEventListener('click', (e) => {
        if (e.target.closest('.carousel__btn, .carousel__dot')) return;
        const carousel = figure.querySelector('.carousel');
        const offset = carousel ? Number(carousel.dataset.current || 0) : 0;
        openLightbox(set, start + offset);
      });
    });
  });

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxNext.addEventListener('click', () => step(1));
  lightboxPrev.addEventListener('click', () => step(-1));
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });

  // ---- DES160 "Angle & Level" carousel ----
  const carousel = document.getElementById('p2Carousel');
  if (carousel) {
    const track = carousel.querySelector('.carousel__track');
    const slides = carousel.querySelectorAll('.carousel__slide');
    const dots = carousel.querySelectorAll('.carousel__dot');
    let current = 0;

    function goTo(index) {
      current = (index + slides.length) % slides.length;
      carousel.dataset.current = String(current);
      track.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('carousel__dot--active', i === current));
      slides.forEach((s, i) => s.classList.toggle('carousel__slide--active', i === current));
    }

    carousel.querySelector('.carousel__btn--prev').addEventListener('click', () => goTo(current - 1));
    carousel.querySelector('.carousel__btn--next').addEventListener('click', () => goTo(current + 1));
    dots.forEach((dot) => {
      dot.addEventListener('click', () => goTo(Number(dot.dataset.slide)));
    });

    // Auto-advance every 4 seconds, paused on hover or keyboard focus
    if (!reduceMotion) {
      let timer = null;
      const start = () => {
        if (!timer) timer = setInterval(() => goTo(current + 1), 4000);
      };
      const stop = () => {
        clearInterval(timer);
        timer = null;
      };
      start();
      carousel.addEventListener('mouseenter', stop);
      carousel.addEventListener('mouseleave', start);
      carousel.addEventListener('focusin', stop);
      carousel.addEventListener('focusout', start);
    }
  }
})();
