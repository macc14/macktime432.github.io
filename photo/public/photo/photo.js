/* ============================================
   macc.lol/photo page
   The roll (masonry grid), the viewer, joining with the invite code,
   posting and editing photos, and the song picker.
   ============================================ */

const API = '/photo/api';
const SNIPPET_S = 15;
const MAX_FILES = 20;
const FULL_EDGE = 2400;
const THUMB_EDGE = 900;

const $ = (selector, root = document) => root.querySelector(selector);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  me: null,
  photos: [], // newest first, everything loaded so far
  byId: new Map(),
  next: null,
  done: false,
  loading: null,
  stats: null,
};

/* ---------- helpers ---------- */

async function request(path, options = {}) {
  const response = await fetch(API + path, { credentials: 'same-origin', ...options });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!response.ok) {
    const error = new Error((body && body.error) || `request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function sendJson(path, method, data) {
  return request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

const longDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDate = (ms) => longDate.format(ms).toLowerCase();
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

function fmtTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

function canEdit(photo) {
  return !!state.me && (state.me.isAdmin || photo.owner === state.me.id);
}

function songLabel(song) {
  return song.artist ? `${song.title} — ${song.artist}` : song.title;
}

// previews stream through our own API so blockers and Firefox can't get in the way
function previewSrc(appleUrl) {
  return `${API}/preview?src=${encodeURIComponent(appleUrl)}`;
}

function bigArtwork(url, size) {
  return url ? url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : '';
}

/* ---------- theme toggle (same behavior and storage key as the main site) ---------- */

(() => {
  const root = document.documentElement;
  const toggle = $('#themeToggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
  const syncLabel = () => toggle.setAttribute('aria-label', `Switch to ${current() === 'dark' ? 'light' : 'dark'} mode`);

  syncLabel();
  systemDark.addEventListener('change', syncLabel);
  toggle.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* storage blocked; the choice lasts for this page view */
    }
    syncLabel();
  });
})();

/* ============================================
   THE ROLL
   ============================================ */

const grid = $('#grid');
const frames = new Map(); // photo id -> frame button
let columns = [];

function columnCount() {
  return window.innerWidth < 640 ? 2 : 3;
}

// Columns are filled shortest-first so the newest photos stay along the top.
function layout() {
  columns = Array.from({ length: columnCount() }, () => {
    const el = document.createElement('div');
    el.className = 'roll__col';
    return { el, height: 0 };
  });
  grid.replaceChildren(...columns.map((c) => c.el));
  state.photos.forEach(place);
}

function place(photo) {
  const shortest = columns.reduce((a, b) => (b.height < a.height - 0.01 ? b : a));
  shortest.el.append(frameFor(photo));
  shortest.height += photo.height / photo.width + 0.04;
}

function frameFor(photo) {
  let frame = frames.get(photo.id);
  if (frame) return frame;

  frame = document.createElement('button');
  frame.type = 'button';
  frame.className = 'frame';
  frame.style.aspectRatio = `${photo.width} / ${photo.height}`;
  frame.setAttribute('aria-label', `Photo by ${photo.by}${photo.caption ? `: ${photo.caption}` : ''}`);

  const img = new Image();
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.width = photo.width;
  img.height = photo.height;
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.src = photo.thumb;
  frame.append(img);

  if (photo.song) {
    const note = document.createElement('span');
    note.className = 'frame__song';
    note.textContent = '♪';
    note.title = songLabel(photo.song);
    frame.append(note);
  }

  frame.addEventListener('click', () => openViewer(photo.id, { push: true }));
  frames.set(photo.id, frame);
  return frame;
}

// rebuild one frame after an edit, in place
function refreshFrame(photo) {
  const old = frames.get(photo.id);
  frames.delete(photo.id);
  const fresh = frameFor(photo);
  if (old) old.replaceWith(fresh);
}

// totals from the API; the viewer uses frames for its "03 / 42" counter
function renderStats(stats) {
  if (stats) state.stats = stats;
}

function refreshStats() {
  request('/photos?limit=1').then((data) => renderStats(data.stats)).catch(() => {});
}

function setRollStatus(text) {
  $('#rollStatus').textContent = text;
}

function loadMore() {
  if (state.loading) return state.loading;
  if (state.done) return Promise.resolve();

  state.loading = (async () => {
    setRollStatus('loading…');
    try {
      const query = state.next ? `?before=${encodeURIComponent(state.next)}` : '';
      const data = await request(`/photos${query}`);
      if (data.stats) renderStats(data.stats);
      for (const photo of data.photos) {
        if (state.byId.has(photo.id)) continue;
        state.photos.push(photo);
        state.byId.set(photo.id, photo);
        place(photo);
      }
      state.next = data.next;
      state.done = !data.next;
      setRollStatus(state.done && state.photos.length > 12 ? "that's the whole roll." : '');
    } catch (error) {
      setRollStatus(`couldn't load photos: ${error.message}`);
      throw error;
    } finally {
      $('#empty').hidden = state.photos.length > 0;
      grid.setAttribute('aria-busy', 'false');
      state.loading = null;
    }
    // the sentinel can still be on screen after a short page
    requestAnimationFrame(() => {
      if (!state.done && sentinelNearViewport()) loadMore();
    });
  })();
  return state.loading;
}

const sentinel = $('#sentinel');
function sentinelNearViewport() {
  return sentinel.getBoundingClientRect().top < window.innerHeight + 900;
}
new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) loadMore().catch(() => {});
}, { rootMargin: '900px 0px' }).observe(sentinel);

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (columnCount() !== columns.length) layout();
  }, 150);
});

function addPhotoToRoll(photo) {
  if (state.stats) state.stats.frames += 1;
  state.photos.unshift(photo);
  state.byId.set(photo.id, photo);
  layout();
  $('#empty').hidden = true;
  const frame = frames.get(photo.id);
  if (frame && !reduceMotion) frame.classList.add('frame--new');
}

function removePhotoFromRoll(id) {
  state.photos = state.photos.filter((p) => p.id !== id);
  state.byId.delete(id);
  frames.delete(id);
  layout();
  $('#empty').hidden = state.photos.length > 0;
}

/* ============================================
   SNIPPET PLAYER
   One <audio> element for the whole page; it loops a 15 second window
   and fades at the edges.
   ============================================ */

const player = {
  audio: new Audio(),
  start: 0,
  end: SNIPPET_S,
  raf: 0,
  onTick: null,
  stopAt: 0, // when a fade-out started; 0 while playing normally
};
player.audio.preload = 'auto';

function playSnippet(preview, start, onTick = null) {
  const a = player.audio;
  player.start = start;
  player.end = start + SNIPPET_S;
  player.onTick = onTick;
  player.stopAt = 0;

  // same song: just seek. new song: the #t= fragment starts it at the right spot
  if (a.dataset.preview === preview && a.readyState >= 1) {
    a.currentTime = start;
  } else {
    a.dataset.preview = preview;
    a.src = `${previewSrc(preview)}#t=${start}`;
  }
  a.volume = 0;
  // play() has to run inside the click for iOS, so it's never awaited first
  a.play().catch(() => setPlaying(false));
  cancelAnimationFrame(player.raf);
  player.raf = requestAnimationFrame(tick);
}

function seekSnippet(start) {
  player.start = start;
  player.end = start + SNIPPET_S;
  if (!player.audio.paused) player.audio.currentTime = start;
}

function stopSnippet() {
  if (player.audio.paused) return;
  if (!player.stopAt) player.stopAt = performance.now();
}

function tick(now) {
  const a = player.audio;
  if (a.paused && !a.seeking && a.readyState >= 2) {
    player.onTick?.(null);
    return;
  }
  const t = a.currentTime;
  // loop inside the window; seek back in if a fragment start wasn't honored
  if (a.readyState >= 1 && (t >= player.end || t < player.start - 0.75)) a.currentTime = player.start;

  const fadeIn = clamp((t - player.start) / 0.6, 0, 1);
  const fadeOut = clamp((player.end - t) / 0.8, 0, 1);
  let level = Math.min(fadeIn, fadeOut);
  if (player.stopAt) {
    const left = 1 - (now - player.stopAt) / 250;
    if (left <= 0) {
      a.pause();
      player.stopAt = 0;
      player.onTick?.(null);
      return;
    }
    level *= left;
  }
  a.volume = clamp(level, 0, 1); // iOS ignores volume, which just means no fade there
  player.onTick?.(clamp((t - player.start) / SNIPPET_S, 0, 1));
  player.raf = requestAnimationFrame(tick);
}

player.audio.addEventListener('ended', () => {
  // previews shorter than start + 15 end early; go round again
  if (!player.stopAt) {
    player.audio.currentTime = player.start;
    player.audio.play().catch(() => {});
    cancelAnimationFrame(player.raf);
    player.raf = requestAnimationFrame(tick);
  }
});
player.audio.addEventListener('playing', () => setPlaying(true));
player.audio.addEventListener('pause', () => setPlaying(false));

function setPlaying(playing) {
  $('#viewer').classList.toggle('is-playing', playing && player.onTick === viewerTick);
  const trimPlay = $('#trimPlay');
  const pickerPlaying = playing && player.onTick === pickerTick;
  trimPlay.setAttribute('aria-pressed', String(pickerPlaying));
  trimPlay.innerHTML = pickerPlaying ? '&#10074;&#10074; pause' : '&#9654; play';
  $('#wave').classList.toggle('is-playing', pickerPlaying);
}

/* ============================================
   VIEWER
   ============================================ */

const viewer = {
  el: $('#viewer'),
  index: -1,
  pushed: false, // whether opening it added a history entry
  lastFocus: null,
};

let soundOn = true;
try {
  soundOn = localStorage.getItem('photo-sound') !== 'off';
} catch {
  /* storage blocked */
}

function viewerTick() {}

function openViewer(id, { push }) {
  const index = state.photos.findIndex((p) => p.id === id);
  if (index < 0) return;

  if (viewer.el.hidden) {
    viewer.lastFocus = document.activeElement;
    viewer.el.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#viewerClose').focus({ preventScroll: true });
  }
  const url = `/photo/p/${id}`;
  if (push && !viewer.pushed) {
    history.pushState({ photo: id }, '', url);
    viewer.pushed = true;
  } else {
    history.replaceState(viewer.pushed ? { photo: id } : null, '', url);
  }
  show(index);
}

function closeViewer({ fromHistory = false } = {}) {
  if (viewer.el.hidden) return;
  viewer.el.hidden = true;
  viewer.index = -1;
  document.body.style.overflow = '';
  stopSnippet();
  if (!fromHistory) {
    if (viewer.pushed) history.back();
    else history.replaceState(null, '', '/photo/');
  }
  viewer.pushed = false;
  if (viewer.lastFocus && document.contains(viewer.lastFocus)) viewer.lastFocus.focus({ preventScroll: true });
}

function show(index) {
  viewer.index = index;
  const photo = state.photos[index];
  const img = $('#viewerImg');

  // the thumb is usually cached already, so show it at once and swap in the full size
  img.width = photo.width;
  img.height = photo.height;
  img.alt = photo.caption || `Photo by ${photo.by}`;
  img.src = photo.thumb;
  const full = new Image();
  full.src = photo.full;
  full.decode().then(() => {
    if (state.photos[viewer.index] === photo) img.src = photo.full;
  }, () => {});
  [state.photos[index + 1], state.photos[index - 1]].forEach((p) => {
    if (p) new Image().src = p.full;
  });

  $('#viewerCaption').textContent = photo.caption;
  const meta = $('#viewerMeta');
  const who = document.createElement('b');
  who.textContent = photo.by;
  const total = state.done || !state.stats ? state.photos.length : Math.max(state.stats.frames, state.photos.length);
  meta.replaceChildren(who, ` · ${fmtDate(photo.at)} · ${pad2(index + 1)} / ${pad2(total)}`);

  renderViewerSong(photo);
  renderTools(photo);

  $('#viewerPrev').disabled = index === 0;
  $('#viewerNext').disabled = index === state.photos.length - 1 && state.done;
}

function renderTools(photo) {
  const editable = canEdit(photo);
  $('#editBtn').hidden = !editable;
  $('#deleteBtn').hidden = !editable;
  $('#deleteConfirm').hidden = true;
  $('#shareBtn').textContent = 'share';
}

function renderViewerSong(photo) {
  const song = photo.song;
  $('#viewerSong').hidden = !song;
  if (!song) {
    stopSnippet();
    return;
  }
  const art = $('#viewerArt');
  art.hidden = !song.artwork;
  if (song.artwork) art.src = bigArtwork(song.artwork, 120);
  $('#viewerSongTitle').textContent = songLabel(song);
  const link = $('#songLink');
  link.hidden = !song.link;
  if (song.link) link.href = song.link;
  syncSoundToggle();
  if (soundOn) playSnippet(song.preview, song.start || 0, viewerTick);
  else stopSnippet();
}

function syncSoundToggle() {
  const toggle = $('#soundToggle');
  toggle.setAttribute('aria-pressed', String(soundOn));
  toggle.textContent = soundOn ? 'sound on' : 'sound off';
}

async function step(delta) {
  let index = viewer.index + delta;
  if (index >= state.photos.length && !state.done) {
    await loadMore().catch(() => {});
  }
  index = clamp(index, 0, state.photos.length - 1);
  if (index === viewer.index) return;
  history.replaceState(viewer.pushed ? { photo: state.photos[index].id } : null, '', `/photo/p/${state.photos[index].id}`);
  show(index);
}

$('#viewerClose').addEventListener('click', () => closeViewer());
$('#viewerPrev').addEventListener('click', () => step(-1));
$('#viewerNext').addEventListener('click', () => step(1));
viewer.el.addEventListener('click', (e) => {
  if (e.target === viewer.el || e.target.classList.contains('viewer__stage')) closeViewer();
});

$('#soundToggle').addEventListener('click', () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem('photo-sound', soundOn ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
  syncSoundToggle();
  const photo = state.photos[viewer.index];
  if (soundOn && photo && photo.song) playSnippet(photo.song.preview, photo.song.start || 0, viewerTick);
  else stopSnippet();
});

document.addEventListener('keydown', (e) => {
  if (viewer.el.hidden || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'Tab') trapFocus(e);
});

function trapFocus(e) {
  const focusable = [...viewer.el.querySelectorAll('button, a[href]')].filter((el) => !el.disabled && el.offsetParent);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// swipe left and right on phones
(() => {
  const stage = $('.viewer__stage');
  let startX = 0;
  let startY = 0;
  let tracking = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  });
  stage.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => {
    tracking = false;
  });
})();

window.addEventListener('popstate', () => {
  const match = location.pathname.match(/^\/photo\/p\/([a-z0-9]+)/);
  if (match && state.byId.has(match[1])) {
    viewer.pushed = !!(history.state && history.state.photo);
    openViewer(match[1], { push: false });
  } else {
    closeViewer({ fromHistory: true });
  }
});

/* share, edit, delete */

$('#shareBtn').addEventListener('click', async () => {
  const photo = state.photos[viewer.index];
  if (!photo) return;
  const url = `${location.origin}/photo/p/${photo.id}`;
  const button = $('#shareBtn');
  if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ url, title: `photo by ${photo.by}` });
    } catch {
      /* closed the share sheet */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = 'link copied';
  } catch {
    button.textContent = url;
  }
  setTimeout(() => {
    if (state.photos[viewer.index] === photo) button.textContent = 'share';
  }, 1800);
});

$('#editBtn').addEventListener('click', () => {
  const photo = state.photos[viewer.index];
  if (photo) openEditor(photo);
});

$('#deleteBtn').addEventListener('click', () => {
  $('#deleteConfirm').hidden = false;
  $('#deleteBtn').hidden = true;
  $('#editBtn').hidden = true;
  $('#deleteNo').focus();
});

$('#deleteNo').addEventListener('click', () => {
  renderTools(state.photos[viewer.index]);
  $('#deleteBtn').focus();
});

$('#deleteYes').addEventListener('click', async () => {
  const photo = state.photos[viewer.index];
  if (!photo) return;
  const yes = $('#deleteYes');
  yes.disabled = true;
  yes.textContent = 'deleting…';
  try {
    await request(`/photos/${photo.id}`, { method: 'DELETE' });
    const index = viewer.index;
    removePhotoFromRoll(photo.id);
    if (state.stats) state.stats.frames = Math.max(0, state.stats.frames - 1);
    refreshStats();
    if (state.photos.length) {
      const nextIndex = Math.min(index, state.photos.length - 1);
      history.replaceState(viewer.pushed ? { photo: state.photos[nextIndex].id } : null, '', `/photo/p/${state.photos[nextIndex].id}`);
      show(nextIndex);
    } else {
      closeViewer();
    }
  } catch (error) {
    yes.textContent = error.message;
  } finally {
    yes.disabled = false;
    if (yes.textContent === 'deleting…') yes.textContent = 'yes, delete';
  }
});

/* ============================================
   DIALOG PLUMBING
   ============================================ */

document.querySelectorAll('dialog.sheet').forEach((dialog) => {
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) requestClose(dialog);
    else if (e.target === dialog) requestClose(dialog); // backdrop
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    requestClose(dialog);
  });
});

function requestClose(dialog) {
  if (dialog === $('#composer') && composer.busy) return;
  if (dialog === picker.el) closePicker();
  else dialog.close();
}

/* ============================================
   JOINING
   ============================================ */

const joinDialog = $('#joinDialog');
const joinForm = $('#joinForm');
const codeInput = joinForm.elements.namedItem('code');
const nameInput = joinForm.elements.namedItem('name'); // the form's own .name property shadows this one
let afterJoin = null;

function openJoin(then) {
  afterJoin = then;
  $('#joinError').textContent = '';
  joinDialog.showModal();
  codeInput.focus();
}

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = joinForm.querySelector('[type="submit"]');
  const code = codeInput.value.trim();
  const name = nameInput.value.trim();
  if (!code) return showJoinError('enter the invite code', codeInput);
  if (!name) return showJoinError('enter the name you want on your photos', nameInput);

  button.disabled = true;
  try {
    const { member } = await sendJson('/join', 'POST', { code, name });
    setMe(member);
    joinForm.reset();
    joinDialog.close();
    const then = afterJoin;
    afterJoin = null;
    then?.();
  } catch (error) {
    showJoinError(error.message, error.status === 401 ? codeInput : nameInput);
  } finally {
    button.disabled = false;
  }
});

function showJoinError(message, field) {
  $('#joinError').textContent = message;
  field.focus();
  field.select?.();
}

function setMe(member) {
  state.me = member;
  const whoami = $('#whoami');
  if (member) {
    const name = document.createElement('b');
    name.textContent = member.name;
    const out = document.createElement('button');
    out.type = 'button';
    out.textContent = 'sign out';
    out.addEventListener('click', signOut);
    whoami.replaceChildren('posting as ', name, member.isAdmin ? ' (admin) · ' : ' · ', out);
  } else {
    whoami.replaceChildren();
  }
  if (!viewer.el.hidden) renderTools(state.photos[viewer.index]);
}

async function signOut() {
  await request('/logout', { method: 'POST' }).catch(() => {});
  setMe(null);
  $('#composer').close();
}

function startPosting() {
  if (state.me) openComposer();
  else openJoin(openComposer);
}

$('#postBtn').addEventListener('click', startPosting);
document.querySelectorAll('[data-action="post"]').forEach((b) => b.addEventListener('click', startPosting));

/* ============================================
   COMPOSER: new posts and edits
   ============================================ */

const composer = {
  el: $('#composer'),
  mode: 'new',
  items: [],
  editing: null,
  busy: false,
};
const cardsEl = $('#cards');
const fileInput = $('#fileInput');
const drop = $('#drop');
let prepQueue = Promise.resolve();

function openComposer() {
  composer.mode = 'new';
  composer.editing = null;
  clearCards();
  $('#composerTitle').textContent = 'new post';
  drop.hidden = false;
  $('#composerError').textContent = '';
  syncSubmit();
  composer.el.showModal();
}

function openEditor(photo) {
  if (!state.me) {
    openJoin(() => openEditor(photo));
    return;
  }
  composer.mode = 'edit';
  composer.editing = photo;
  clearCards();
  $('#composerTitle').textContent = 'edit post';
  drop.hidden = true;
  $('#composerError').textContent = '';

  const item = makeItem(null);
  item.ready = Promise.resolve();
  item.prepared = true;
  item.img.src = photo.thumb;
  item.caption.value = photo.caption;
  item.song = photo.song;
  item.li.querySelector('.card__remove').hidden = true;
  renderSongChip(item);
  syncSubmit();
  composer.el.showModal();
  item.caption.focus();
}

function clearCards() {
  composer.items.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
  composer.items = [];
  cardsEl.replaceChildren();
}

function makeItem(file) {
  const li = $('#cardTemplate').content.firstElementChild.cloneNode(true);
  const item = {
    file,
    li,
    img: li.querySelector('.card__thumb img'),
    caption: li.querySelector('.card__caption'),
    status: li.querySelector('.card__status'),
    song: null,
    prepared: false,
    ready: null,
  };
  li.querySelector('.card__remove').addEventListener('click', () => removeItem(item));
  li.querySelector('[data-song-add]').addEventListener('click', () => pickSongFor(item));
  li.querySelector('[data-song-edit]').addEventListener('click', () => pickSongFor(item));
  li.querySelector('[data-song-remove]').addEventListener('click', () => {
    item.song = null;
    renderSongChip(item);
  });
  composer.items.push(item);
  cardsEl.append(li);
  return item;
}

function removeItem(item) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  composer.items = composer.items.filter((i) => i !== item);
  item.li.remove();
  syncSubmit();
}

function pickSongFor(item) {
  openPicker(item.song, (song) => {
    item.song = song;
    renderSongChip(item);
  });
}

function renderSongChip(item) {
  const add = item.li.querySelector('[data-song-add]');
  const chip = item.li.querySelector('[data-song-chip]');
  add.hidden = !!item.song;
  chip.hidden = !item.song;
  if (item.song) {
    const body = chip.querySelector('[data-song-edit]');
    body.textContent = `${songLabel(item.song)} · ${fmtTime(item.song.start)}`;
    body.title = 'Change the song or the part that plays';
  }
}

function syncSubmit() {
  const submit = $('#composerSubmit');
  if (composer.mode === 'edit') {
    submit.textContent = 'save';
    submit.disabled = composer.busy;
    return;
  }
  const count = composer.items.length;
  submit.textContent = count > 1 ? `post ${count} photos` : 'post';
  submit.disabled = composer.busy || count === 0;
}

function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  const room = MAX_FILES - composer.items.length;
  if (files.length > room) $('#composerError').textContent = `up to ${MAX_FILES} photos at a time`;
  else $('#composerError').textContent = '';

  for (const file of files.slice(0, Math.max(0, room))) {
    const item = makeItem(file);
    item.status.textContent = 'getting it ready…';
    // one at a time, so a big batch of camera photos doesn't run a phone out of memory
    item.ready = prepQueue = prepQueue.then(() => prepare(item));
  }
  syncSubmit();
}

async function prepare(item) {
  if (!composer.items.includes(item)) return;
  try {
    const result = await prepareImage(item.file);
    Object.assign(item, result, { prepared: true });
    item.previewUrl = URL.createObjectURL(result.thumb);
    item.img.src = item.previewUrl;
    item.status.textContent = '';
  } catch {
    item.li.classList.add('is-error');
    item.status.textContent = "couldn't read this file. try a jpg or png.";
  }
}

// Re-encode to JPEG at a sensible size. This also drops EXIF, so GPS location never leaves the phone.
async function prepareImage(file) {
  const { source, width, height, cleanup } = await decodeImage(file);
  try {
    const scale = Math.min(1, FULL_EDGE / Math.max(width, height));
    const fullCanvas = drawScaled(source, Math.round(width * scale), Math.round(height * scale));
    const thumbScale = Math.min(1, THUMB_EDGE / Math.max(fullCanvas.width, fullCanvas.height));
    const thumbCanvas = drawScaled(fullCanvas, Math.round(fullCanvas.width * thumbScale), Math.round(fullCanvas.height * thumbScale));
    const [full, thumb] = await Promise.all([toJpeg(fullCanvas, 0.86), toJpeg(thumbCanvas, 0.8)]);
    return { full, thumb, width: fullCanvas.width, height: fullCanvas.height };
  } finally {
    cleanup();
  }
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      /* fall back to <img>, which some browsers decode more formats with */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
}

function drawScaled(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // transparent PNGs land on white, not black
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  });
}

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) => {
  composer.el.addEventListener(type, (e) => {
    if (composer.mode !== 'new' || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    drop.classList.add('is-over');
  });
});
composer.el.addEventListener('dragleave', (e) => {
  if (!composer.el.contains(e.relatedTarget)) drop.classList.remove('is-over');
});
composer.el.addEventListener('drop', (e) => {
  if (composer.mode !== 'new') return;
  e.preventDefault();
  drop.classList.remove('is-over');
  addFiles(e.dataTransfer.files);
});
composer.el.addEventListener('paste', (e) => {
  if (composer.mode !== 'new' || !e.clipboardData?.files.length) return;
  e.preventDefault();
  addFiles(e.clipboardData.files);
});

$('#composerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (composer.busy) return;
  if (composer.mode === 'edit') await saveEdit();
  else await postAll();
});

function setBusy(busy) {
  composer.busy = busy;
  composer.el.querySelectorAll('[data-close]').forEach((b) => {
    b.disabled = busy;
  });
  drop.classList.toggle('is-busy', busy);
  fileInput.disabled = busy;
  syncSubmit();
}

async function postAll() {
  setBusy(true);
  $('#composerError').textContent = '';
  let posted = 0;

  for (const item of [...composer.items]) {
    await item.ready;
    if (!item.prepared) continue;
    item.li.classList.add('is-busy');
    item.li.classList.remove('is-error');
    item.status.textContent = 'uploading…';
    try {
      const photo = await upload(item, (fraction) => item.li.style.setProperty('--progress', fraction));
      addPhotoToRoll(photo);
      removeItem(item);
      posted += 1;
    } catch (error) {
      item.li.classList.remove('is-busy');
      item.li.classList.add('is-error');
      item.li.style.setProperty('--progress', 0);
      item.status.textContent = error.message;
      if (error.status === 401) {
        setMe(null);
        $('#composerError').textContent = 'the invite code changed. sign in again to keep posting.';
        break;
      }
    }
  }

  setBusy(false);
  if (posted) refreshStats();
  if (!composer.items.length) {
    composer.el.close();
    $('.roll').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  } else if (state.me && composer.items.some((i) => !i.prepared)) {
    $('#composerError').textContent = 'some files could not be read. remove them to finish.';
  }
}

function upload(item, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('photo', item.full, 'photo.jpg');
    form.append('thumb', item.thumb, 'thumb.jpg');
    form.append('width', item.width);
    form.append('height', item.height);
    form.append('caption', item.caption.value);
    if (item.song) form.append('song', JSON.stringify(item.song));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/photos`);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.photo) resolve(xhr.response.photo);
      else {
        const error = new Error(xhr.response?.error || `upload failed (${xhr.status})`);
        error.status = xhr.status;
        reject(error);
      }
    });
    xhr.addEventListener('error', () => reject(new Error('upload failed, check your connection')));
    xhr.send(form);
  });
}

async function saveEdit() {
  const photo = composer.editing;
  const item = composer.items[0];
  if (!photo || !item) return;
  setBusy(true);
  try {
    const { photo: updated } = await sendJson(`/photos/${photo.id}`, 'PATCH', {
      caption: item.caption.value,
      song: item.song,
    });
    Object.assign(photo, updated);
    refreshFrame(photo);
    composer.el.close();
    if (state.photos[viewer.index] === photo) show(viewer.index);
  } catch (error) {
    $('#composerError').textContent = error.message;
    if (error.status === 401) setMe(null);
  } finally {
    setBusy(false);
  }
}

composer.el.addEventListener('close', () => {
  if (composer.mode === 'new') clearCards();
  // the song picker may have taken over the speaker; give it back to the open photo
  const photo = state.photos[viewer.index];
  if (!viewer.el.hidden && photo && (player.onTick !== viewerTick || player.audio.paused)) renderViewerSong(photo);
});

/* ============================================
   SONG PICKER
   Search Apple Music previews (30 seconds each), then drag a 15 second window.
   ============================================ */

const picker = {
  el: $('#songPicker'),
  onPick: null,
  track: null,
  start: 0,
  duration: 30,
  peaks: null,
  searchTimer: 0,
  searchAbort: null,
  waveAbort: null,
};
const BAR_COUNT = 60;
const waveEl = $('#wave');
const queryInput = $('#songQuery');
const resultsEl = $('#songResults');

function openPicker(current, onPick) {
  picker.onPick = onPick;
  queryInput.value = '';
  resultsEl.replaceChildren(note('search for a song or an artist.'));
  if (current) selectTrack(current, current.start, { autoplay: false });
  else showSearch();
  picker.el.showModal();
  if (!current) queryInput.focus();
}

function closePicker() {
  stopSnippet();
  picker.waveAbort?.abort();
  picker.el.close();
}

function showSearch() {
  if (player.onTick === pickerTick) stopSnippet();
  picker.track = null;
  $('#pickerSearch').hidden = false;
  $('#pickerTrim').hidden = true;
  $('#pickerBack').textContent = 'cancel';
  $('#pickerUse').disabled = true;
}

function note(text) {
  const li = document.createElement('li');
  li.className = 'results__note';
  li.textContent = text;
  return li;
}

queryInput.addEventListener('input', () => {
  clearTimeout(picker.searchTimer);
  const query = queryInput.value.trim();
  if (query.length < 2) {
    resultsEl.replaceChildren(note('search for a song or an artist.'));
    return;
  }
  // wait for a pause in typing; the API caches each search for a day
  picker.searchTimer = setTimeout(() => searchSongs(query), 350);
});

async function searchSongs(query) {
  picker.searchAbort?.abort();
  picker.searchAbort = new AbortController();
  resultsEl.replaceChildren(note('searching…'));
  try {
    const { tracks } = await request(`/songs?q=${encodeURIComponent(query)}`, { signal: picker.searchAbort.signal });
    if (!tracks.length) {
      resultsEl.replaceChildren(note(`no songs found for “${query}”.`));
      return;
    }
    resultsEl.replaceChildren(...tracks.map(resultRow));
  } catch (error) {
    if (error.name === 'AbortError') return;
    resultsEl.replaceChildren(note("couldn't reach apple music. try again in a moment."));
  }
}

function resultRow(track) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'result';
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.src = bigArtwork(track.artwork, 100);
  const text = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'result__title';
  title.textContent = track.title;
  const artist = document.createElement('span');
  artist.className = 'result__artist';
  artist.textContent = track.artist;
  text.append(title, artist);
  button.append(img, text);
  button.addEventListener('click', () => selectTrack(track, null, { autoplay: true }));
  li.append(button);
  return li;
}

function selectTrack(track, start, { autoplay }) {
  picker.track = { id: track.id, title: track.title, artist: track.artist, artwork: track.artwork, preview: track.preview, link: track.link };
  picker.duration = 30;
  picker.peaks = null;
  $('#pickerSearch').hidden = true;
  $('#pickerTrim').hidden = false;
  $('#pickerBack').textContent = 'back';
  $('#pickerUse').disabled = false;
  $('#trimTitle').textContent = track.title;
  $('#trimArtist').textContent = track.artist;
  $('#trimArt').src = bigArtwork(track.artwork, 200);

  renderBars(placeholderPeaks(track.id || 1));
  setStart(start ?? 0);
  if (autoplay) playSnippet(track.preview, picker.start, pickerTick);
  else setPlaying(false);
  waveEl.focus({ preventScroll: true });
  loadWaveform(track, start == null);
}

// Pull the preview once to draw its real waveform. With no saved start, jump to the
// loudest 15 seconds, which is usually the hook.
async function loadWaveform(track, chooseStart) {
  picker.waveAbort?.abort();
  picker.waveAbort = new AbortController();
  try {
    const response = await fetch(previewSrc(track.preview), { signal: picker.waveAbort.signal });
    const bytes = await response.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buffer = await new Promise((resolve, reject) => ctx.decodeAudioData(bytes, resolve, reject));
    ctx.close?.();
    if (picker.track?.preview !== track.preview) return;

    picker.duration = Math.max(buffer.duration, SNIPPET_S);
    picker.peaks = computePeaks(buffer, BAR_COUNT);
    renderBars(picker.peaks);
    if (chooseStart) {
      const best = loudestWindow(buffer);
      setStart(best);
      if (player.onTick === pickerTick && !player.audio.paused) seekSnippet(best);
    } else {
      setStart(picker.start);
    }
  } catch {
    /* keep the placeholder bars; picking still works */
  }
}

function computePeaks(buffer, count) {
  const data = buffer.getChannelData(0);
  const size = Math.floor(data.length / count);
  const peaks = [];
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = i * size; j < (i + 1) * size; j += 16) sum += data[j] * data[j];
    peaks.push(Math.sqrt(sum / (size / 16)));
  }
  const max = Math.max(...peaks, 0.0001);
  return peaks.map((p) => p / max);
}

function loudestWindow(buffer) {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const stepS = 0.5;
  const energy = [];
  for (let t = 0; t < buffer.duration; t += stepS) {
    let sum = 0;
    const from = Math.floor(t * rate);
    const to = Math.min(data.length, Math.floor((t + stepS) * rate));
    for (let i = from; i < to; i += 32) sum += data[i] * data[i];
    energy.push(sum);
  }
  const span = Math.round(SNIPPET_S / stepS);
  let best = 0;
  let bestSum = -1;
  let running = energy.slice(0, span).reduce((a, b) => a + b, 0);
  for (let i = 0; i + span <= energy.length; i++) {
    if (i > 0) running += energy[i + span - 1] - energy[i - 1];
    if (running > bestSum) {
      bestSum = running;
      best = i;
    }
  }
  return best * stepS;
}

function placeholderPeaks(seed) {
  let x = seed % 2147483647 || 7;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    x = (x * 16807) % 2147483647;
    return 0.35 + 0.45 * Math.abs(Math.sin(i / 3)) * ((x % 100) / 100);
  });
}

function renderBars(peaks) {
  const bars = $('#waveBars');
  bars.replaceChildren(...peaks.map((p) => {
    const bar = document.createElement('i');
    bar.style.height = `${Math.max(4, p * 100)}%`;
    return bar;
  }));
}

function maxStart() {
  return Math.max(0, picker.duration - SNIPPET_S);
}

function setStart(seconds) {
  picker.start = Math.round(clamp(seconds, 0, maxStart()) * 10) / 10;
  const left = (picker.start / picker.duration) * 100;
  const width = (SNIPPET_S / picker.duration) * 100;
  const windowEl = $('#waveWindow');
  windowEl.style.left = `${left}%`;
  windowEl.style.width = `${width}%`;

  const bars = $('#waveBars').children;
  for (let i = 0; i < bars.length; i++) {
    const t = ((i + 0.5) / bars.length) * picker.duration;
    bars[i].classList.toggle('is-in', t >= picker.start && t <= picker.start + SNIPPET_S);
  }

  const label = `${fmtTime(picker.start)} – ${fmtTime(picker.start + SNIPPET_S)}`;
  $('#trimTime').textContent = label;
  waveEl.setAttribute('aria-valuemax', String(Math.round(maxStart())));
  waveEl.setAttribute('aria-valuenow', String(picker.start));
  waveEl.setAttribute('aria-valuetext', label.replace('–', 'to'));
}

function pickerTick(progress) {
  $('#waveHead').style.left = progress == null ? '0' : `calc(${progress * 100}% - 1px)`;
}

// dragging the window: grab it anywhere, or click outside it to jump there
(() => {
  let grabOffset = 0;
  let dragging = false;
  const timeAt = (e) => {
    const rect = waveEl.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * picker.duration;
  };
  waveEl.addEventListener('pointerdown', (e) => {
    if (!picker.track) return;
    dragging = true;
    waveEl.setPointerCapture(e.pointerId);
    const t = timeAt(e);
    const inside = t >= picker.start && t <= picker.start + SNIPPET_S;
    grabOffset = inside ? t - picker.start : SNIPPET_S / 2;
    setStart(t - grabOffset);
  });
  waveEl.addEventListener('pointermove', (e) => {
    if (dragging) setStart(timeAt(e) - grabOffset);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    playSnippet(picker.track.preview, picker.start, pickerTick);
  };
  waveEl.addEventListener('pointerup', end);
  waveEl.addEventListener('pointercancel', end);

  waveEl.addEventListener('keydown', (e) => {
    const stepS = e.shiftKey ? 2 : 0.5;
    const moves = { ArrowLeft: -stepS, ArrowDown: -stepS, ArrowRight: stepS, ArrowUp: stepS };
    if (e.key in moves) setStart(picker.start + moves[e.key]);
    else if (e.key === 'Home') setStart(0);
    else if (e.key === 'End') setStart(maxStart());
    else return;
    e.preventDefault();
    if (!player.audio.paused && player.onTick === pickerTick) seekSnippet(picker.start);
  });
})();

$('#trimPlay').addEventListener('click', () => {
  if (!picker.track) return;
  if (!player.audio.paused && player.onTick === pickerTick) stopSnippet();
  else playSnippet(picker.track.preview, picker.start, pickerTick);
});

$('#pickerBack').addEventListener('click', () => {
  if (!$('#pickerTrim').hidden) {
    showSearch();
    queryInput.focus();
  } else {
    closePicker();
  }
});

$('#pickerUse').addEventListener('click', () => {
  if (!picker.track) return;
  const song = { ...picker.track, start: picker.start };
  closePicker();
  picker.onPick?.(song);
});

/* ============================================
   START
   ============================================ */

async function start() {
  layout();
  const meLoad = request('/me').then((data) => setMe(data.member)).catch(() => {});
  await loadMore().catch(() => {});
  await meLoad;

  // a shared link: /photo/p/<id>. Older photos may be a few pages back.
  const match = location.pathname.match(/^\/photo\/p\/([a-z0-9]+)/);
  if (match) {
    let pages = 0;
    while (!state.byId.has(match[1]) && !state.done && pages < 20) {
      await loadMore().catch(() => {});
      pages += 1;
    }
    if (state.byId.has(match[1])) openViewer(match[1], { push: false });
    else history.replaceState(null, '', '/photo/');
  }
}

start();
