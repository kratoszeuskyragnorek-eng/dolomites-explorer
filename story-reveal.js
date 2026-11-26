const copySelector = 'h2, h3, p:not(.footer-wordmark), small, a, button, .gallery-tag';
const controlSelector = 'a, button, small, .gallery-tag, .route-fields label';
const mediaSelector = '.chapter-image, .footer-photo';
const blockSelector = 'li[data-reveal], figure[data-reveal], form[data-reveal], .route-fields label, .footer-columns nav, .footer-wordmark';
const staggerSelector = '.relief-steps > li, .route-gallery > figure, .footer-columns > nav';

const clampProgress = value => Math.min(1, Math.max(0, value));

function splitWords(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement.closest(copySelector) === element && /\S/u.test(node.data)) nodes.push(node);
  }

  const words = [];
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    for (const part of node.data.split(/(\s+)/u)) {
      if (!/\S/u.test(part)) {
        fragment.append(part);
        continue;
      }
      const word = document.createElement('span');
      word.className = 'story-word';
      word.textContent = part;
      words.push(word);
      fragment.append(word);
    }
    node.replaceWith(fragment);
  }

  const lastIndex = Math.max(1, words.length - 1);
  words.forEach((word, index) => word.style.setProperty('--story-word-start', .55 * index / lastIndex));
  return words.length > 0;
}

function layoutTop(element) {
  let top = 0;
  for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
  return top;
}

export function prepareStoryReveals(story) {
  const entries = [];
  for (const element of story.querySelectorAll([copySelector, mediaSelector, blockSelector].join(', '))) {
    const isControl = element.matches(controlSelector);
    const isBlock = element.matches(blockSelector);
    const isMedia = element.matches(mediaSelector);
    const isHeading = element.matches('h2');
    if (!isBlock && !isMedia && !splitWords(element)) continue;

    const role = isMedia ? 'media' : isBlock ? 'block' : isHeading ? 'heading' : isControl ? 'control' : 'copy';
    const reversible = isHeading || (role === 'copy' && element.matches('p'));
    element.dataset.storyReveal = role;
    const order = element.matches(staggerSelector) ? Array.from(element.parentElement.children).indexOf(element) : 0;
    entries.push({element, isHeading, isControl, reversible, stagger: 8 * order, progress: -1});
  }

  return () => {
    const viewportHeight = window.innerHeight;
    const position = window.scrollY;
    const endOfPage = document.documentElement.scrollHeight - viewportHeight;
    const changes = [];

    // Read layout positions before updating presentation. Moving elements keep the same scroll range.
    for (const entry of entries) {
      const {element, isHeading, isControl, reversible, stagger} = entry;
      if (!reversible && entry.progress === 1) continue;
      const top = layoutTop(element) + stagger;
      const naturalStart = top - viewportHeight * (isHeading ? .85 : .98);
      const naturalEnd = isHeading
        ? top + element.offsetHeight - viewportHeight * .65
        : top - viewportHeight * (isControl ? .78 : .64);
      const end = Math.min(naturalEnd, endOfPage);
      const start = Math.min(naturalStart, end - 48);
      const spatial = clampProgress((position - start) / (end - start));
      const progress = reversible ? spatial : Math.max(entry.progress, spatial);
      if (progress !== entry.progress) changes.push([entry, progress]);
    }

    for (const [entry, progress] of changes) {
      const {element} = entry;
      entry.progress = progress;
      element.toggleAttribute('data-story-pending', progress < 1);
      if (progress < 1) element.style.setProperty('--story-reveal-progress', progress);
      else element.style.removeProperty('--story-reveal-progress');
    }
  };
}
