/* ============================================
   Portfolio – Interactive Behaviors
   ============================================ */
(() => {
  'use strict';

  // ---- DOM refs ----
  const cursorGlow = document.getElementById('cursorGlow');
  const nav = document.getElementById('nav');
  const navLinks = document.getElementById('navLinks');
  const hamburger = document.getElementById('hamburger');
  const typingTarget = document.getElementById('typingTarget');
  const sideDots = document.querySelectorAll('.side-dot');
  const sections = document.querySelectorAll('.section, .hero');
  const reveals = document.querySelectorAll('.reveal, .reveal-delay');

  // ---- Cursor Glow ----
  let mouseX = 0, mouseY = 0, glowX = 0, glowY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function animateGlow() {
    glowX += (mouseX - glowX) * 0.08;
    glowY += (mouseY - glowY) * 0.08;
    if (cursorGlow) {
      cursorGlow.style.left = glowX + 'px';
      cursorGlow.style.top = glowY + 'px';
    }
    requestAnimationFrame(animateGlow);
  }
  animateGlow();

  // ---- Typing Effect ----
  const phrases = [
    'Aspiring Front-End Developer & UI/UX Designer',
    'DJ/Filmmaker/Photographer',
  ];

  let phraseIdx = 0, charIdx = 0, isDeleting = false;

  function typeEffect() {
    const current = phrases[phraseIdx];
    const displayed = current.substring(0, charIdx);

    if (typingTarget) {
      typingTarget.innerHTML = displayed + '<span class="typing-cursor"></span>';
    }

    let speed = isDeleting ? 35 : 65;

    if (!isDeleting && charIdx === current.length) {
      speed = 2200; // pause at end
      isDeleting = true;
    } else if (isDeleting && charIdx === 0) {
      isDeleting = false;
      phraseIdx = (phraseIdx + 1) % phrases.length;
      speed = 500; // pause before next phrase
    }

    charIdx += isDeleting ? -1 : 1;
    setTimeout(typeEffect, speed);
  }
  typeEffect();

  // ---- Scroll Reveal (Intersection Observer) ----
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');

          // Stagger children (skill tags, activity tags)
          const staggerChildren = entry.target.querySelectorAll('.skill-tag, .tag');
          staggerChildren.forEach((child, i) => {
            child.style.transitionDelay = `${i * 0.06}s`;
          });

          // Don't unobserve so we can re-trigger if needed
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -50px 0px' }
  );

  reveals.forEach((el) => revealObserver.observe(el));

  // ---- Nav scroll effect ----
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;

    // Add scrolled class
    if (nav) {
      nav.classList.toggle('scrolled', scrollY > 60);
    }

    // Update active nav link & side dots
    let currentSection = '';
    sections.forEach((sec) => {
      const top = sec.offsetTop - 200;
      if (scrollY >= top) {
        currentSection = sec.id;
      }
    });

    document.querySelectorAll('.nav__link').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === '#' + currentSection);
    });

    sideDots.forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.section === currentSection);
    });

    lastScroll = scrollY;
  });

  // ---- Hamburger Toggle ----
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });

    // Close on link click
    navLinks.querySelectorAll('.nav__link').forEach((link) => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  // ---- Smooth scroll for all anchor links ----
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ---- Magnetic Button Effect ----
  document.querySelectorAll('.magnetic').forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.25}px, ${y * 0.25}px)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0, 0)';
    });
  });

  // ---- Parallax Orbs on Scroll ----
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    const orbs = document.querySelectorAll('.hero__orb');
    orbs.forEach((orb, i) => {
      const speed = (i + 1) * 0.08;
      orb.style.transform = `translateY(${scrollY * speed}px)`;
    });
  });

  // ---- Initial trigger for hero reveals ----
  window.addEventListener('load', () => {
    document.querySelectorAll('.hero .reveal, .hero .reveal-delay').forEach((el) => {
      setTimeout(() => el.classList.add('visible'), 300);
    });
  });

  // ---- Photo Gallery Lightbox ----
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  const galleryItems = document.querySelectorAll('.photo-gallery__item');

  // Build flat galleryData array — carousel items expand into multiple entries
  const galleryData = [];
  const itemToLightboxStart = new Map(); // maps gallery item index → starting lightbox index

  galleryItems.forEach((item, idx) => {
    const carouselSlides = item.querySelectorAll('.carousel__slide img');
    itemToLightboxStart.set(idx, galleryData.length);

    if (carouselSlides.length > 0) {
      // Carousel item: add each slide as its own lightbox entry
      carouselSlides.forEach((img) => {
        const label = item.querySelector('.photo-gallery__label');
        galleryData.push({
          src: img.src,
          alt: img.alt,
          label: label ? label.textContent : ''
        });
      });
    } else {
      // Standard single-image item
      const img = item.querySelector('img');
      const label = item.querySelector('.photo-gallery__label');
      galleryData.push({
        src: img.src,
        alt: img.alt,
        label: label ? label.textContent : ''
      });
    }
  });

  let currentLightboxIndex = 0;

  function openLightbox(index) {
    currentLightboxIndex = index;
    updateLightbox();
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }

  function updateLightbox() {
    const data = galleryData[currentLightboxIndex];
    if (data && lightboxImg) {
      lightboxImg.src = data.src;
      lightboxImg.alt = data.alt;
      if (lightboxCaption) {
        lightboxCaption.textContent = data.label + ' — ' + data.alt;
      }
    }
  }

  function nextPhoto() {
    currentLightboxIndex = (currentLightboxIndex + 1) % galleryData.length;
    updateLightbox();
  }

  function prevPhoto() {
    currentLightboxIndex = (currentLightboxIndex - 1 + galleryData.length) % galleryData.length;
    updateLightbox();
  }

  // Click handlers for non-carousel gallery items
  galleryItems.forEach((item, i) => {
    if (item.classList.contains('photo-gallery__item--carousel')) return; // handled separately
    item.addEventListener('click', () => openLightbox(itemToLightboxStart.get(i)));
  });

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxNext) lightboxNext.addEventListener('click', nextPhoto);
  if (lightboxPrev) lightboxPrev.addEventListener('click', prevPhoto);

  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (!lightbox || !lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') nextPhoto();
    if (e.key === 'ArrowLeft') prevPhoto();
  });

  // ---- Project 2 Carousel Controller ----
  const p2Carousel = document.getElementById('p2Carousel');
  if (p2Carousel) {
    const track = p2Carousel.querySelector('.carousel__track');
    const slides = p2Carousel.querySelectorAll('.carousel__slide');
    const dots = p2Carousel.querySelectorAll('.carousel__dot');
    const prevBtn = p2Carousel.querySelector('.carousel__btn--prev');
    const nextBtn = p2Carousel.querySelector('.carousel__btn--next');
    const carouselItem = p2Carousel.closest('.photo-gallery__item--carousel');
    let currentSlide = 0;

    function goToSlide(index) {
      currentSlide = ((index % slides.length) + slides.length) % slides.length;
      track.style.transform = `translateX(-${currentSlide * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('carousel__dot--active', i === currentSlide));
      slides.forEach((s, i) => s.classList.toggle('carousel__slide--active', i === currentSlide));
    }

    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToSlide(currentSlide - 1);
    });

    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      goToSlide(currentSlide + 1);
    });

    dots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        goToSlide(parseInt(dot.dataset.slide, 10));
      });
    });

    // Click on the carousel image area opens lightbox at the correct slide
    if (carouselItem) {
      const itemIdx = parseInt(carouselItem.dataset.index, 10);
      carouselItem.addEventListener('click', (e) => {
        // Don't open lightbox when clicking carousel controls
        if (e.target.closest('.carousel__btn') || e.target.closest('.carousel__dot')) return;
        const lightboxStart = itemToLightboxStart.get(itemIdx);
        openLightbox(lightboxStart + currentSlide);
      });
    }

    // Auto-advance every 4 seconds, pause on hover
    let autoPlay = setInterval(() => goToSlide(currentSlide + 1), 4000);
    p2Carousel.addEventListener('mouseenter', () => clearInterval(autoPlay));
    p2Carousel.addEventListener('mouseleave', () => {
      autoPlay = setInterval(() => goToSlide(currentSlide + 1), 4000);
    });
  }

})();
