const portal = document.querySelector('.portal');
const stage = portal.querySelector('.portal-stage');
const aperture = stage.querySelector('.portal-aperture');
const copy = stage.querySelector('.portal-copy');
const header = stage.querySelector('.journey-header');
const explorer = document.getElementById('explorer');
const viewport = document.getElementById('viewport');
const mapContinue = document.getElementById('map-continue');
const loader = document.getElementById('loading');
const loadingMessage = document.getElementById('loading-message');
const loadingAnnouncement = document.getElementById('loading-announcement');
const story = document.querySelector('.journey-story');
const root = document.documentElement;
const mapOnly = root.classList.contains('map-only');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const interpolate = (from, to, amount) => from + (to - from) * amount;
const minimumLoadingMs = 1800;
const loadingFadeMs = 900;
const continueScrollWindowMs = 650;
const continueScrollThreshold = 660;

let loadingStartedAt = 0;
let loadingState = 'idle';
let loadingTimer = 0;
let phase = story.contains(document.getElementById(location.hash.slice(1))) ? 'story' : 'cover';
let previousScroll = window.scrollY;
let exitAmount = 0;
let lastExitInput = 0;
let inputReadyAt = 0;
let mapZoomedOut = false;
let continueScrollStartedAt = 0;
let continueScrollAmount = 0;

function showMapError(message) {
  resetMapContinue();
  clearTimeout(loadingTimer);
  loadingState = 'error';
  inputReadyAt = performance.now() + 180;
  loader.style.removeProperty('opacity');
  loader.classList.remove('is-loading');
  explorer.setAttribute('data-loading', '');
  loader.hidden = false;
  viewport.setAttribute('aria-busy', 'false');
  loadingMessage.textContent = message;
  loadingAnnouncement.textContent = message;
  loader.querySelector('.loading-recovery').hidden = false;
}

function prepareLoadingMessage() {
  const message = loadingMessage.textContent;
  loadingAnnouncement.textContent = message;
  const letters = Array.from(message, (character, index) => {
    const letter = document.createElement('span');
    letter.className = 'loading-letter';
    letter.textContent = character;
    letter.style.setProperty('--loading-letter-index', index + 1);
    return letter;
  });
  loadingMessage.replaceChildren(...letters);
}

async function startMap() {
  if (loadingState !== 'idle') return;
  loadingState = 'loading';
  prepareLoadingMessage();
  explorer.setAttribute('data-loading', '');
  loader.classList.add('is-loading');
  try {
    // Present the loading scene above the portal before starting WebGL and the terrain requests.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    loadingStartedAt = performance.now();
    const { initialize } = await import('./app.js?v=adaptive-oval-fog');
    await initialize();
  } catch (error) {
    console.error('Dolomiti initialization:', error);
    showMapError('Не удалось открыть 3D-карту');
  }
}

window.addEventListener('dolomites:error', event => showMapError(event.detail));
window.addEventListener('dolomites:ready', () => {
  viewport.setAttribute('aria-busy', 'false');
  const remaining = Math.max(0, minimumLoadingMs - (performance.now() - loadingStartedAt));
  loadingTimer = setTimeout(fadeLoadingScreen, remaining);
});
document.getElementById('retry').addEventListener('click', () => location.reload());

function fadeLoadingScreen() {
  const duration = reducedMotion.matches ? 260 : loadingFadeMs;
  let previous;
  let elapsed = 0;

  function fadeFrame(time) {
    if (loadingState !== 'loading') return;
    // Keep the opacity transition visible even when rendering the first map frames delays a frame.
    if (previous !== undefined) elapsed += Math.min(time - previous, 50);
    previous = time;
    loader.style.opacity = String(1 - ease(0, duration, elapsed));
    if (elapsed < duration) {
      requestAnimationFrame(fadeFrame);
      return;
    }
    loader.hidden = true;
    loader.style.removeProperty('opacity');
    loader.classList.remove('is-loading');
    explorer.removeAttribute('data-loading');
    loadingState = 'ready';
    inputReadyAt = performance.now() + 180;
  }
  requestAnimationFrame(fadeFrame);
}

function ease(start, end, progress) {
  const t = Math.max(0, Math.min(1, (progress - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function frameOpening(progress) {
  const scene = stage.getBoundingClientRect();
  const figure = aperture.getBoundingClientRect();
  const left = figure.left - scene.left;
  const top = figure.top - scene.top;
  // Keep the original crop from MAKE IT until the approach begins.
  const openingWidth = figure.width * .93314;
  const openingHeight = figure.height * .97216;
  const openingX = left + figure.width * .04897;
  const openingY = top - figure.height * .02234;
  const reach = Math.max(scene.width / (openingWidth * .35), scene.height / (openingHeight * .36));
  const approach = ease(0, .79, progress);
  const scale = interpolate(1, reach, approach);
  const focusX = interpolate(openingX + openingWidth * .53, scene.width / 2, approach);
  const focusY = interpolate(openingY + openingHeight * .43, scene.height / 2, approach);
  const maskTop = focusY - openingHeight * scale * .43;
  const headerCovered = progress > 0 && maskTop < header.offsetHeight;

  const view = ease(.08, .9, progress);
  const copyFade = ease(.08, .58, progress);
  const style = stage.style;
  style.setProperty('--opening-width', `${openingWidth * scale}px`);
  style.setProperty('--opening-height', `${openingHeight * scale}px`);
  style.setProperty('--opening-x', `${focusX - openingWidth * scale * .53}px`);
  style.setProperty('--opening-y', `${maskTop}px`);
  style.setProperty('--open', ease(.74, .9, progress));
  style.setProperty('--photo-x', `${interpolate(left - figure.width * .6109, 0, view)}px`);
  style.setProperty('--photo-y', `${interpolate(top - figure.height * .6274, 0, view)}px`);
  style.setProperty('--photo-width', `${interpolate(figure.width * 2.2218, scene.width, view)}px`);
  style.setProperty('--photo-height', `${interpolate(figure.height * 2.2548, scene.height, view)}px`);
  style.setProperty('--photo-bleed-progress', view);
  style.setProperty('--photo-blur-progress', 1 - (1 - progress) ** 2);
  style.setProperty('--photo-opacity', interpolate(.8, .71, view));
  style.setProperty('--copy-opacity', 1 - copyFade);
  style.setProperty('--copy-rise', `${-scene.height * .27 * ease(.02, .65, progress)}px`);
  copy.inert = copyFade >= 1;
  header.inert = headerCovered;
}

let lastProgress = -1;
function renderPortal() {
  renderFrame = 0;
  let mapTop = explorer.getBoundingClientRect().top;
  const approachingFromStory = phase === 'story' && window.scrollY < previousScroll &&
    mapTop >= -explorer.clientHeight * .20;
  if ((phase === 'cover' && mapTop <= 1) || approachingFromStory) {
    lockMap();
    mapTop = 0;
  } else if (phase === 'map' && !document.fullscreenElement && Math.abs(mapTop) > 1) {
    window.scrollTo(0, window.scrollY + mapTop);
    mapTop = 0;
  }
  previousScroll = window.scrollY;
  const length = portal.offsetHeight - stage.offsetHeight;
  const progress = length > 0 && !reducedMotion.matches
    ? Math.max(0, Math.min(1, 1 - (mapTop <= 1 ? 0 : mapTop) / length))
    : 0;
  if (progress !== lastProgress) {
    frameOpening(progress);
    lastProgress = progress;
  }
  const through = !reducedMotion.matches && progress >= 1;
  stage.classList.toggle('is-through', through);
  explorer.inert = phase !== 'map';
  story.inert = phase === 'map';
}

let renderFrame = 0;
function requestPortalFrame() {
  if (!renderFrame) renderFrame = requestAnimationFrame(renderPortal);
}

function reframePortal() {
  lastProgress = -1;
  requestPortalFrame();
}

function animateHeroTitle() {
  if (reducedMotion.matches || phase !== 'cover' || copy.inert) return;

  const title = document.getElementById('journey-title');
  let letterIndex = 0;
  for (const line of [...title.childNodes]) {
    if (line.nodeType !== Node.TEXT_NODE) continue;
    const words = line.textContent.split(/(\s+)/u).map(word => {
      if (!word.trim()) return word;
      const group = document.createElement('span');
      group.className = 'hero-title-word';
      for (const character of word) {
        const letter = document.createElement('span');
        letter.textContent = character;
        letter.style.setProperty('--hero-letter-index', letterIndex++);
        group.append(letter);
      }
      return group;
    });
    line.replaceWith(...words);
  }
}

function lockMap() {
  const mapPosition = window.scrollY + explorer.getBoundingClientRect().top;
  phase = 'map';
  exitAmount = 0;
  lastExitInput = 0;
  resetMapContinue();
  inputReadyAt = performance.now() + 260;
  root.classList.add('map-gated');
  window.scrollTo(0, mapPosition);
  explorer.inert = false;
  explorer.focus({preventScroll: true});
  startMap();
}

function leaveMap(direction) {
  const target = direction > 0 ? story : portal;
  const from = window.scrollY;
  const destination = from + target.getBoundingClientRect().top;
  const duration = reducedMotion.matches ? 0 : 860;
  const start = performance.now();
  phase = 'leaving';
  resetMapContinue();
  explorer.inert = true;

  function slide(time) {
    const progress = duration ? ease(start, start + duration, time) : 1;
    window.scrollTo(0, interpolate(from, destination, progress));
    if (progress < 1) {
      requestAnimationFrame(slide);
      return;
    }
    phase = direction > 0 ? 'story' : 'cover';
    previousScroll = window.scrollY;
    root.classList.remove('map-gated');
    story.inert = false;
    history.replaceState(null, '', `#${target.id}`);
    target.focus({preventScroll: true});
    requestPortalFrame();
  }
  requestAnimationFrame(slide);
}

function canLeaveMap() {
  return phase === 'map' && (loadingState === 'ready' || loadingState === 'error') &&
    performance.now() >= inputReadyAt && !document.fullscreenElement &&
    !document.querySelector('dialog[open]');
}

function exertScroll(delta, limit = .65) {
  const now = performance.now();
  if (!delta || !canLeaveMap()) return;
  if (now - lastExitInput > 1250 || Math.sign(delta) !== Math.sign(exitAmount)) exitAmount = 0;
  lastExitInput = now;
  const threshold = Math.max(280, Math.min(450, explorer.clientHeight * .52));
  exitAmount += Math.sign(delta) * Math.min(Math.abs(delta), threshold * limit);
  if (Math.abs(exitAmount) >= threshold) leaveMap(Math.sign(exitAmount));
}

function resetMapContinue() {
  continueScrollStartedAt = 0;
  continueScrollAmount = 0;
  if (!mapContinue.hidden && document.activeElement === mapContinue) explorer.focus({preventScroll: true});
  mapContinue.hidden = true;
}

function handleWheel(event) {
  cancelEntry();
  if (!root.classList.contains('map-gated') || event.ctrlKey || event.metaKey || document.fullscreenElement ||
    event.target.closest?.('.settings, .place-card')) return;
  event.preventDefault();
  if (!canLeaveMap() || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? explorer.clientHeight : 1;
  const delta = event.deltaY * unit;
  if (loadingState === 'error') {
    exertScroll(delta);
    return;
  }
  // The map forwards wheel events over markers to the viewport as well.
  if (!event.target.closest?.('#viewport')) return;
  if (delta < 0 || !mapZoomedOut) {
    resetMapContinue();
    return;
  }
  if (!delta || !mapContinue.hidden) return;

  const now = performance.now();
  if (now - continueScrollStartedAt > continueScrollWindowMs) {
    continueScrollStartedAt = now;
    continueScrollAmount = 0;
  }
  // A single large wheel event cannot reveal the continuation.
  continueScrollAmount += Math.min(delta, continueScrollThreshold / 3);
  if (continueScrollAmount >= continueScrollThreshold) mapContinue.hidden = false;
}

let swipe = null;
function startSwipe(event) {
  cancelEntry();
  const point = event.touches[0];
  swipe = event.touches.length === 1 && canLeaveMap() &&
    !event.target.closest?.('.settings')
    ? {id: point.identifier, x: point.clientX, y: point.clientY}
    : null;
}

function endSwipe(event) {
  if (!swipe) return;
  const point = Array.from(event.changedTouches).find(touch => touch.identifier === swipe.id);
  if (point) {
    const y = swipe.y - point.clientY;
    const x = swipe.x - point.clientX;
    if (Math.abs(y) > Math.max(35, Math.abs(x) * 1.3)) exertScroll(y * 1.4, .68);
  }
  swipe = null;
}

function handleKeys(event) {
  cancelEntry();
  if (!canLeaveMap() || event.target.closest?.('input, select, textarea, [contenteditable]')) return;
  if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault();
    leaveMap(event.key === 'PageDown' ? 1 : -1);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    exertScroll(event.key === 'ArrowDown' ? 100 : -100);
  }
}

let entryFrame = 0;
function cancelEntry() {
  if (entryFrame) cancelAnimationFrame(entryFrame);
  entryFrame = 0;
}

function enterThroughPortal(event) {
  if (reducedMotion.matches || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  cancelEntry();
  const from = window.scrollY;
  const to = from + explorer.getBoundingClientRect().top;
  const start = performance.now();

  function step(time) {
    const progress = ease(start, start + 1500, time);
    window.scrollTo(0, from + (to - from) * progress);
    if (progress < 1) {
      entryFrame = requestAnimationFrame(step);
    } else {
      entryFrame = 0;
      cancelAnimationFrame(renderFrame);
      renderPortal();
      history.replaceState(null, '', '#explorer');
      explorer.focus({preventScroll: true});
    }
  }
  entryFrame = requestAnimationFrame(step);
}

if (!mapOnly) {
  window.addEventListener('scroll', requestPortalFrame, {passive: true});
  window.addEventListener('resize', reframePortal);
  reducedMotion.addEventListener('change', reframePortal);
  window.addEventListener('wheel', handleWheel, {capture: true, passive: false});
  window.addEventListener('dolomites:zoom-limit', event => {
    mapZoomedOut = event.detail;
    if (!mapZoomedOut) resetMapContinue();
  });
  mapContinue.addEventListener('click', () => {
    if (canLeaveMap()) leaveMap(1);
  });
  window.addEventListener('touchstart', startSwipe, {capture: true, passive: true});
  window.addEventListener('touchend', endSwipe, {capture: true, passive: true});
  window.addEventListener('touchcancel', () => { swipe = null; }, {capture: true, passive: true});
  window.addEventListener('keydown', handleKeys);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const destination = document.getElementById(link.hash.slice(1));
    if (story.contains(destination)) phase = 'story';
    else if (destination === portal || (destination === explorer && phase === 'story')) phase = 'cover';
  });
  stage.querySelectorAll('a[href="#explorer"]').forEach(link => link.addEventListener('click', enterThroughPortal));
  renderPortal();
  animateHeroTitle();

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    }, {threshold: .14});
    const staggered = '.relief-factors, .erosion-copy, .route-gallery, .gallery-chapter h2, .pause-chapter h2';
    story.classList.add('is-animated');
    for (const element of story.querySelectorAll('[data-reveal]')) {
      if (element.parentElement.matches(staggered)) {
        const index = Array.from(element.parentElement.children).indexOf(element);
        element.style.setProperty('--reveal-delay', `${index * 80}ms`);
      }
      observer.observe(element);
    }
  }
} else startMap();
