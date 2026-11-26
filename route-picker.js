const form = document.getElementById('route-picker');
const answer = document.getElementById('route-answer');
const routeCatalog = 'https://www.altabadia.org/en/dolomites/hiking-alta-badia';
const guideCatalog = 'https://www.altabadia.org/en/dolomites/mountain-guides-alta-badia-dolomites';

const routes = [
  {
    title: 'Корвара — Кольфоско',
    season: 'summer', start: 'corvara', difficulty: 'easy',
    distance: '4,8 км', minutes: 80, ascent: 128,
    url: `${routeCatalog}/detail/oa/hike-corvara-colfosco`
  },
  {
    title: 'Корвара — плато Пралонджа',
    season: 'summer', start: 'corvara', difficulty: 'easy',
    distance: '13,7 км', minutes: 240, ascent: 631,
    url: 'https://www.altabadia.org/en/tour/oadetail/oa/hike-from-corvara-to-the-col-alt-pralongia-plateau'
  },
  {
    title: 'Вальпарола — Пралонджа — Сан-Кассиано',
    season: 'summer', start: 'valparola', difficulty: 'medium',
    distance: '14,2 км', minutes: 265, ascent: 295,
    url: `${routeCatalog}/detail/oa/from-passo-valparola-to-pralongia-and-down-to-san-cassiano`
  },
  {
    title: 'Кольфоско — Сассонгер — Ла-Вилла',
    season: 'summer', start: 'colfosco', difficulty: 'hard',
    distance: '12,2 км', minutes: 390, ascent: 1087,
    url: 'https://www.altabadia.org/en/bike/cycling-tours-dolomites/detail/oa/from-colfosco-to-the-sassongher-and-gherdenacia-ending-in-la-villa-1'
  },
  {
    title: 'Корвара — Кольфоско · зимняя тропа',
    season: 'winter', start: 'corvara', difficulty: 'easy',
    distance: '6,1 км', minutes: 101, ascent: 144,
    url: 'https://www.altabadia.org/en/tour/oadetail/oa/winter-hike-corvara-colfosco'
  },
  {
    title: 'Корвара — водопады Пишадю',
    season: 'winter', start: 'corvara', difficulty: 'easy',
    distance: '8,8 км', minutes: 145, ascent: 212,
    url: 'https://www.altabadia.org/en/tour/oadetail/oa/winter-hike-corvara-pisciadu-waterfalls'
  }
];

function chooseRoute(filters) {
  const {season, duration, difficulty, ascent, start} = filters;
  return routes.find(route =>
    (!season || route.season === season) &&
    (!start || route.start === start) &&
    (!difficulty || route.difficulty === difficulty) &&
    (!duration || duration === (route.minutes <= 120 ? 'short' : route.minutes <= 240 ? 'half' : 'long')) &&
    (!ascent || ascent === (route.ascent < 250 ? 'low' : route.ascent <= 600 ? 'mid' : 'high'))
  );
}

function appendAnswer(tag, text, href) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (href) element.href = href;
  answer.append(element);
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const filters = Object.fromEntries(new FormData(form));
  const route = chooseRoute(filters);
  answer.replaceChildren();
  if (route) {
    const hours = Math.floor(route.minutes / 60);
    const remaining = route.minutes % 60;
    const duration = remaining ? `${hours} ч ${remaining} мин` : `${hours} ч`;
    appendAnswer('strong', route.title);
    appendAnswer('p', `${route.distance} · ${duration} · ↑ ${route.ascent} м`);
    appendAnswer('a', 'Описание и статус тропы', route.url);
  } else {
    appendAnswer('p', 'В подборке нет маршрута с такими параметрами.');
    appendAnswer('a', 'Открыть каталог маршрутов', routeCatalog);
  }
  if (filters.format === 'guide') appendAnswer('a', 'Гиды Альта-Бадии', guideCatalog);
});

form.addEventListener('change', () => answer.replaceChildren());
for (const link of document.querySelectorAll('[data-guide-format]')) {
  link.addEventListener('click', () => {
    form.elements.format.value = 'guide';
    answer.replaceChildren();
  });
}

const panels = Array.from(document.querySelectorAll('.route-gallery .gallery-panel'), panel => {
  const button = panel.querySelector('h3 button');
  const details = document.getElementById(button.getAttribute('aria-controls'));
  return {panel, button, details};
});
let activePanel = panels.find(({panel}) => panel.hasAttribute('data-expanded'));

function setPanelExpanded({panel, button, details}, expanded) {
  panel.toggleAttribute('data-expanded', expanded);
  button.setAttribute('aria-expanded', String(expanded));
  details.inert = !expanded;
}

function expandPanel(item) {
  if (item === activePanel) return;
  if (activePanel) {
    if (activePanel.details.contains(document.activeElement)) {
      activePanel.button.focus({preventScroll: true});
    }
    setPanelExpanded(activePanel, false);
  }
  setPanelExpanded(item, true);
  activePanel = item;
}

for (const item of panels) {
  const image = item.panel.querySelector('img');
  if (!image.complete) {
    image.toggleAttribute('data-image-pending', true);
    const showImage = () => image.removeAttribute('data-image-pending');
    image.addEventListener('load', () => image.decode().then(showImage, showImage), {once: true});
    image.addEventListener('error', showImage, {once: true});
  }

  item.panel.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') expandPanel(item);
  });
  item.button.addEventListener('click', () => expandPanel(item));
}
