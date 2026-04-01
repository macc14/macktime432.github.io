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
    'UIC Honors CS + Design 28',
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

})();
