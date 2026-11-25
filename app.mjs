import {distance, makeTrack, readProgress, stopProgress, rankRoutes} from './tracking.mjs?v=3';
import {createRouteMap} from './route-map.mjs?v=3';

const $ = id => document.getElementById(id);
const icons = {
  bus:'<rect x="4" y="3" width="16" height="16" rx="4"/><path d="M4 11h16M8 19v2m8-2v2M8 15h.01M16 15h.01"/>',
  bookmark:'<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4z"/>',
  locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 9h16c0-2-2-3-2-9m-8 12a2 2 0 0 0 4 0"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  phone:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  play:'<path d="m8 5 12 7-12 7z"/>',
  pin:'<path d="M20 10c0 5-8 11-8 11s-8-6-8-11a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  external:'<path d="M13 5h6v6m0-6-9 9m6-1v6H5V8h6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  expand:'<path d="M8 4H4v4m12-4h4v4m0 8v4h-4m-8 0H4v-4"/>',
  search:'<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>'
};
function icon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
}
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);

function element(tag, className, copy) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (copy != null) node.textContent = copy;
  return node;
}

function normalize(text) {
  return text.toLowerCase().normalize('NFKD').replace(/siruch[ae]ry|siruser[yi]|sirucheri|siruseri/g, 'siruseri')
    .replace(/shozhinganallur|shozhanganallur|solinganallur/g, 'sholinganallur').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

let network, routes, demoRoute, route, stops, path, destination = null, next = 0;
let mode = 'preview', progress = null, lastFix = null, lastAccepted = 0, pendingMatch = null, gpsIssue = '';
let watch = null, wake = null, demoTimer = null, showAll = false, sound = null, toastTime, alertStage = 0;
let geometryRequest = 0;
let demoOriginalDestination = null, demoMoving = false;
let lastPositionTimestamp = 0;
const geometry = new Map();
let favorites = read('saved-rides', []);
if (!Array.isArray(favorites)) favorites = [];

const stopName = (r, index) => network.stops[r.ids[index]][0];
const labelDistance = value => value < 1000 ? Math.round(value / 10) * 10 + ' m' : (value / 1000).toFixed(1) + ' km';
const routeEnd = r => stopName(r, r.ids.length - 1);
const routeStart = r => stopName(r, 0);
const routeFingerprint = r => r.key;
const dialog = $('panel');
const routeMap = createRouteMap($('route-map'), {
  inButton: $('zoom-in'), outButton: $('zoom-out'), fitButton: $('fit-route')
});
const compactView = matchMedia('(max-width: 740px)');
let preferredView = null;

function renderView() {
  const view = preferredView ?? (compactView.matches ? 'stops' : 'map');
  document.querySelector('.overview').dataset.view = view;
  for (const name of ['map', 'stops']) {
    $(name + '-view').setAttribute('aria-pressed', String(name === view));
    $(name + '-panel').hidden = name !== view;
  }
}
for (const view of ['map', 'stops']) {
  $(view + '-view').addEventListener('click', () => {
    preferredView = view;
    renderView();
  });
}
compactView.addEventListener('change', renderView);
renderView();

function drawMap() {
  let position = mode === 'gps' && !gpsIssue ? lastFix?.point : null;
  if (mode === 'demo' && progress != null) {
    const segment = path.segments.find(part => part.length && progress <= part.start + part.length) ?? path.segments.at(-1);
    const t = segment.length ? Math.min(1, Math.max(0, (progress - segment.start) / segment.length)) : 1;
    position = segment.a.map((coordinate, i) => coordinate + (segment.b[i] - coordinate) * t);
  }
  routeMap.update({key:route.key, path, stops, position, destination});
}

function notify(copy) {
  clearTimeout(toastTime);
  $('toast').textContent = copy;
  $('toast').hidden = false;
  toastTime = setTimeout(() => { $('toast').hidden = true; }, 2800);
}

function initAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) {
      sound ||= new Audio();
      sound.resume().catch(() => {});
    }
  } catch {}
}

function chime(strong) {
  if (sound?.state === 'running') {
    const start = sound.currentTime;
    for (const [i, frequency] of (strong ? [660, 880, 990] : [540, 760]).entries()) {
      const oscillator = sound.createOscillator();
      const gain = sound.createGain();
      const at = start + i * .19;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.001, at);
      gain.gain.exponentialRampToValueAtTime(.23, at + .025);
      gain.gain.exponentialRampToValueAtTime(.001, at + .32);
      oscillator.connect(gain).connect(sound.destination);
      oscillator.start(at);
      oscillator.stop(at + .33);
    }
  }
  if (navigator.vibrate) navigator.vibrate(strong ? [180, 100, 180] : [110]);
}

function showAlert(title, message, strong) {
  $('toast').hidden = true;
  $('arrival-title').textContent = title;
  $('arrival-text').textContent = message;
  $('arrival').hidden = false;
  if (dialog.open) dialog.close();
  chime(strong);
}

function checkAlert() {
  if (destination == null || progress == null || mode === 'preview' || alertStage === 2) return;
  const metres = path.anchors[destination] - progress;
  const nearby = mode === 'demo' || (lastFix && distance(lastFix.point, stops[destination].slice(1)) <= Math.max(95, lastFix.accuracy));
  const name = stops[destination][0];
  if (nearby && metres <= 80 && metres > -110) {
    alertStage = 2;
    showAlert('Your stop is here', name + (mode === 'demo' ? ' · Demo ride' : ' · Get ready to get down.'), true);
  } else if (next > destination) {
    alertStage = 2;
    showAlert('Your stop may have passed', name + ' · Check your location.', true);
  } else if (alertStage === 0 && (metres <= 400 || (next === destination && metres <= 900))) {
    alertStage = 1;
    showAlert('Get ready for your stop', name + ' · ' + (mode === 'demo' ? 'Demo ride' : 'Coming up soon.'), false);
  }
}

function resetProgress() {
  progress = null;
  next = 0;
  lastFix = null;
  lastAccepted = 0;
  lastPositionTimestamp = 0;
  pendingMatch = null;
  alertStage = 0;
  $('arrival').hidden = true;
}

function destinationSet(index, confirm = true) {
  if (index != null && (index < 0 || index >= stops.length || (progress != null && index < next))) return;
  if (confirm) initAudio();
  destination = index;
  if (mode !== 'demo') save('last-ride', {key: routeFingerprint(route), destination});
  alertStage = 0;
  $('arrival').hidden = true;
  if (dialog.open) dialog.close();
  checkAlert();
  render();
  if (!alertStage && confirm && index != null) notify(mode === 'preview' ? 'Stop selected. Start tracking to get alerted.' : 'Get-down alert set.');
}

async function loadGeometry(selected) {
  const request = ++geometryRequest;
  if (!selected.shape) return;
  const bucket = [...selected.shape].reduce((sum, letter, i) => sum + letter.charCodeAt(0) * (i + 1), 0) % 32;
  try {
    if (!geometry.has(bucket)) {
      const response = await fetch('./geometry-' + bucket + '.json');
      if (!response.ok) return;
      geometry.set(bucket, await response.json());
    }
    if (geometryRequest !== request || mode === 'demo') return;
    const refined = makeTrack(stops, geometry.get(bucket)[selected.shape]);
    if (progress == null) {
      path = refined;
      drawMap();
    }
  } catch {}
}

function chooseRoute(newRoute, target = null) {
  if (dialog.open) dialog.close();
  stopDemo(false);
  route = newRoute;
  stops = route.ids.map(i => network.stops[i]);
  $('timeline').replaceChildren();
  destination = Number.isInteger(target) && target >= 0 && target < stops.length ? target : null;
  path = makeTrack(stops);
  showAll = false;
  resetProgress();
  if (mode === 'gps') gpsIssue = 'Waiting for a GPS fix on this route…';
  loadGeometry(route);
  save('last-ride', {key: routeFingerprint(route), destination});
  render();
}

function renderTimeline() {
  const timeline = $('timeline');
  const hasProgress = progress != null;
  const start = showAll ? 0 : Math.max(0, Math.min(next, stops.length - 1) - 2);
  const end = showAll ? stops.length : Math.min(stops.length, start + 6);
  const children = new Map([...timeline.children].map(node => [Number(node.dataset.index), node]));
  const keep = new Set();
  for (let i = start; i < end; i++) {
    let item = children.get(i);
    let button;
    if (item) {
      button = item.lastChild;
    } else {
      item = element('li', 'stop');
      item.dataset.index = i;
      const node = element('span', 'stop-node');
      node.setAttribute('aria-hidden', 'true');
      button = element('button');
      button.type = 'button';
      button.append(element('span', '', stops[i][0]), element('small'));
      button.addEventListener('click', () => openStops(i));
      item.append(node, button);
    }
    const passed = hasProgress && i < next;
    const upcoming = hasProgress && i === next;
    item.className = 'stop' + (passed ? ' passed' : '') + (upcoming ? ' next' : '') + (i === destination ? ' target' : '');
    if (upcoming) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.lastChild.textContent = i === destination ? (passed ? 'Alert stop · Passed' : 'Alert stop') : passed ? 'Passed' : upcoming ? 'Next' : i === 0 ? 'Start' : i === stops.length - 1 ? 'Terminus' : '';
    keep.add(i);
    const at = timeline.children[i - start];
    if (at !== item) timeline.insertBefore(item, at || null);
  }
  for (const [i, item] of children) if (!keep.has(i)) item.remove();
  $('show-stops').hidden = stops.length <= 6;
  $('show-label').textContent = showAll ? 'Show fewer stops' : 'Show all ' + stops.length + ' stops';
  $('show-stops').setAttribute('aria-expanded', String(showAll));
}

function render() {
  if (!route) return;
  $('route-number').textContent = route.code;
  $('route-title').textContent = 'To ' + routeEnd(route);
  $('route-origin').textContent = 'From ' + routeStart(route);
  document.body.dataset.rideMode = mode;
  const moving = mode === 'demo' ? demoMoving : mode === 'gps' && !gpsIssue && lastFix?.moving;
  document.body.dataset.busMoving = String(Boolean(moving));
  $('demo').disabled = mode === 'gps';
  $('demo').hidden = mode === 'gps';
  $('mode').textContent = mode === 'demo' ? 'Demo ride' : mode === 'gps' ? (gpsIssue ? 'Waiting for GPS' : 'Tracking live') : 'Preview';
  $('mode').classList.toggle('live', mode === 'gps' && !gpsIssue);
  $('track-label').textContent = mode === 'gps' ? 'Stop tracking' : 'Start tracking';
  $('gps-copy').textContent = gpsIssue || (mode === 'gps' ? 'GPS accuracy ±' + Math.round(lastFix?.accuracy ?? 0) + ' m. Keep this screen open and awake for alerts.' : 'Keep this screen open and awake for stop alerts.');
  $('demo-label').textContent = mode === 'demo' ? 'End demo ride' : 'Try a demo ride';
  const starred = favorites.some(item => item.key === routeFingerprint(route) && item.destination === destination);
  $('favorite').classList.toggle('saved', starred);
  $('favorite').setAttribute('aria-pressed', String(starred));
  $('favorite').setAttribute('aria-label', starred ? 'Remove saved ride' : 'Save ride');
  $('favorite').title = $('favorite').getAttribute('aria-label');
  $('destination-label').textContent = destination == null ? 'Choose a stop' : stops[destination][0];
  $('destination-open').classList.toggle('armed', destination != null);
  $('alert-detail').hidden = destination == null;
  $('alert-detail').textContent = alertStage === 2 ? 'Alert delivered' : mode === 'preview' ? 'Alert ready. Start tracking to activate it.' : 'Alert on';
  $('stops-subtitle').textContent = progress == null ? 'Stops in travel order' : next + ' passed · ' + (stops.length - next) + ' ahead';
  $('stop-count').textContent = stops.length + ' stops';
  renderTicket();
  renderTimeline();
  drawMap();
}

function renderTicket() {
  const hasPosition = progress != null;
  const atEnd = next >= stops.length;
  const label = atEnd ? 'Route complete' : hasPosition ? 'Next stop' : 'Bound for';
  const name = hasPosition ? stops[Math.min(next, stops.length - 1)][0] : routeEnd(route);
  $('next-label').textContent = label;
  if ($('next-name').textContent !== name) $('next-name').textContent = name;
  $('ticket-code').textContent = route.code;
  $('scene-route-number').textContent = route.code;
  $('ticket-origin').textContent = hasPosition && next > 0 ? 'Passed ' + stops[next - 1][0] : 'From ' + routeStart(route);
  const metres = path.anchors[next] - progress;
  const hasDistance = hasPosition && !atEnd && !(mode === 'gps' && gpsIssue);
  $('next-distance').textContent = hasDistance ? (metres < 45 ? 'At stop' : '≈ ' + labelDistance(metres)) : '';
  $('ticket-progress').hidden = !hasPosition;
  $('ticket-progress').textContent = next + ' / ' + stops.length + ' passed';
  $('next-panel').style.setProperty('--progress', (hasPosition ? Math.min(100, 100 * progress / Math.max(1, path.anchors.at(-1))) : 0) + '%');
}

async function keepAwake() {
  if (!navigator.wakeLock || document.hidden || mode !== 'gps' || (wake && !wake.released)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (mode === 'gps') wake = lock;
    else await lock.release();
  } catch {}
}

function updateFix(position) {
  if (mode !== 'gps') return;
  const {latitude, longitude, accuracy, speed, heading} = position.coords;
  if (position.timestamp <= lastPositionTimestamp) return;
  lastPositionTimestamp = position.timestamp;
  const point = [latitude, longitude];
  if (accuracy > 125 || Date.now() - position.timestamp > 30000) {
    gpsIssue = 'Weak GPS signal. Waiting for a more accurate fix.';
    render();
    return;
  }
  const now = Date.now();
  const moving = speed >= 2 && Number.isFinite(heading) ? heading : null;
  const age = (now - lastAccepted) / 1000;
  const newProgress = readProgress(path, point, progress, accuracy, moving, age);
  if (newProgress == null) {
    gpsIssue = 'Can’t match this location to your route. Check the bus and direction.';
    pendingMatch = null;
    render();
    return;
  }
  const guess = stopProgress(path.anchors, newProgress, accuracy);
  if (progress != null && guess > next + 2 &&
      (!pendingMatch || Math.abs(newProgress - pendingMatch.progress) > Math.max(150, (now - pendingMatch.time) / 40))) {
    pendingMatch = {progress: newProgress, time: now};
    gpsIssue = 'Confirming your position on the route…';
    render();
    return;
  }
  pendingMatch = null;
  gpsIssue = '';
  progress = newProgress;
  next = Math.max(next, guess);
  const travelled = lastFix ? distance(point, lastFix.point) : 0;
  const isMoving = speed != null && speed >= 0
    ? speed >= 1
    : lastFix && age > 0 && travelled > Math.max(accuracy, lastFix.accuracy, age);
  lastAccepted = now;
  lastFix = {point, accuracy, moving: Boolean(isMoving)};
  checkAlert();
  render();
}

function gpsError(error) {
  if (mode !== 'gps') return;
  if (error.code === 1) {
    stopGPS(false);
    gpsIssue = 'Location access is off. Allow it for this site in Safari to track your ride.';
  } else {
    gpsIssue = 'Waiting for GPS. Try moving closer to a window.';
  }
  render();
}

function startGPS() {
  if (!navigator.geolocation || !window.isSecureContext) {
    gpsIssue = 'Location requires a supported browser and a secure HTTPS page.';
    render();
    return;
  }
  stopDemo(false);
  initAudio();
  resetProgress();
  mode = 'gps';
  gpsIssue = 'Waiting for your location…';
  watch = navigator.geolocation.watchPosition(updateFix, gpsError, {enableHighAccuracy: true, timeout: 18000, maximumAge: 3000});
  keepAwake();
  render();
}

function stopGPS(update = true) {
  if (mode !== 'gps') return;
  if (watch != null) navigator.geolocation.clearWatch(watch);
  watch = null;
  if (wake && !wake.released) wake.release().catch(() => {});
  wake = null;
  mode = 'preview';
  gpsIssue = '';
  resetProgress();
  if (update) render();
}

function stopDemo(update = true) {
  if (mode !== 'demo') return;
  clearInterval(demoTimer);
  demoTimer = null;
  mode = 'preview';
  destination = demoOriginalDestination;
  demoOriginalDestination = null;
  demoMoving = false;
  resetProgress();
  loadGeometry(route);
  if (update) render();
}

function startDemo() {
  if (mode === 'gps' || mode === 'demo') return;
  initAudio();
  demoOriginalDestination = destination;
  destination ??= stops.length - 1;
  resetProgress();
  mode = 'demo';
  gpsIssue = '';

  // Start a few stops before the alert so a commuter can try their actual trip.
  let leg = Math.max(0, destination - 3);
  let tick = 0;
  progress = path.anchors[leg];
  function advance() {
    const lastLeg = path.anchors.length - 1;
    demoMoving = leg < lastLeg && tick < 10;
    if (leg < lastLeg) {
      const span = path.anchors[leg + 1] - path.anchors[leg];
      progress = path.anchors[leg] + span * Math.min(tick / 10, 1);
      // Pause briefly at each stop before starting the next leg.
      if (++tick === 13) { leg++; tick = 0; }
    } else {
      clearInterval(demoTimer);
      demoTimer = null;
    }
    next = stopProgress(path.anchors, progress, 10);
    checkAlert();
    render();
  }
  demoTimer = setInterval(advance, 500);
  advance();
}

function openDialog(title, copy) {
  $('dialog-title').textContent = title;
  $('dialog-copy').textContent = copy;
  const content = $('panel-content');
  content.replaceChildren();
  if (!dialog.open) dialog.showModal();
  return content;
}

function listMessage(list, copy) {
  list.replaceChildren(element('li', 'empty', copy));
}

function action(copy, handler) {
  const button = element('button', 'button', copy);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function searchInput(placeholder) {
  const input = element('input', 'search');
  input.type = 'search';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

function resultRow(title, details, handler, code = '', disabled = false) {
  const li = element('li');
  const button = element('button', 'result');
  button.type = 'button';
  button.disabled = disabled;
  if (code) button.append(element('span', 'route-badge', code));
  const body = element('span', 'result-text');
  body.append(element('strong', '', title), element('small', '', details));
  button.append(body);
  button.addEventListener('click', handler);
  li.append(button);
  return li;
}

function openRoutes() {
  const content = openDialog('Find your bus', 'Check the bus number and direction against the sign on your bus.');
  const input = searchInput('Bus number or stop, e.g. 570');
  const actions = element('div', 'dialog-actions');
  const list = element('ul', 'results');
  let suggestions = null;
  let locating = false;
  const nearbyButton = action('Find buses near me', () => {
    if (locating) return;
    if (!navigator.geolocation || !window.isSecureContext) {
      listMessage(list, 'Location requires a supported browser and a secure HTTPS page.');
      return;
    }
    nearbyButton.disabled = true;
    locating = true;
    nearbyButton.textContent = 'Finding your location…';
    const complete = () => {
      locating = false;
      nearbyButton.disabled = false;
      nearbyButton.textContent = 'Refresh nearby routes';
    };
    navigator.geolocation.getCurrentPosition(({coords}) => {
      complete();
      if (coords.accuracy > 250) {
        listMessage(list, 'GPS is too imprecise to suggest nearby buses. Try searching by number.');
        return;
      }
      suggestions = rankRoutes(routes, network.stops, [coords.latitude, coords.longitude],
        coords.speed >= 2 && Number.isFinite(coords.heading) ? coords.heading : null, Math.max(350, coords.accuracy * 2));
      input.value = '';
      refresh();
    }, error => {
      complete();
      listMessage(list, error.code === 1 ? 'Location permission is off. You can still search by bus number.' : 'Couldn’t get a GPS fix. Try again or search by bus number.');
    }, {enableHighAccuracy:true, maximumAge:5000, timeout:15000});
  });
  actions.append(nearbyButton);
  content.append(input, actions, list);
  function refresh() {
    const query = normalize(input.value);
    let entries;
    if (query) {
      const compact = query.replace(/ /g, '');
      const words = query.split(' ');
      entries = routes.filter(r => r.normalCode.includes(compact) || words.every(word => r.search.includes(word)))
        .sort((a, b) => Number(b.normalCode === compact) - Number(a.normalCode === compact)
          || Number(b.normalCode.startsWith(compact)) - Number(a.normalCode.startsWith(compact))
          || b.frequency - a.frequency)
        .map(r => ({route:r}));
    } else if (suggestions) {
      entries = suggestions;
    } else {
      const featured = routes.filter(r => /siruseri/.test(normalize(routeStart(r) + ' ' + routeEnd(r))));
      entries = [{route:demoRoute}, ...featured.filter(r => r !== demoRoute).sort((a,b) => b.frequency - a.frequency).map(r => ({route:r}))];
    }
    if (!entries.length) {
      listMessage(list, query ? 'No matching trips. Try a route number or a different stop name.' : 'No route matches nearby. Search by bus number.');
      return;
    }
    const seen = new Set();
    const rows = [];
    for (const {route:r, metres} of entries) {
      const key = r.code + '|' + routeStart(r) + '|' + routeEnd(r);
      if (!query && seen.has(key)) continue;
      seen.add(key);
      const detail = 'From ' + routeStart(r) + ' · ' + r.ids.length + ' stops' + (metres != null ? ' · ≈ ' + labelDistance(metres) + ' away' : '');
      rows.push(resultRow('To ' + routeEnd(r), detail, () => chooseRoute(r), r.code));
      if (rows.length === (query ? 70 : 18)) break;
    }
    list.replaceChildren(...rows);
  }
  input.addEventListener('input', refresh);
  refresh();
}

function openStops(candidate = null) {
  const content = openDialog('Get off at…', 'Pick a stop in your bus’s direction of travel.');
  const search = searchInput('Search stops on ' + route.code);
  const list = element('ul', 'results');
  const actions = element('div', 'dialog-actions');
  if (candidate != null && (progress == null || candidate >= next)) {
    actions.append(action('Alert at ' + stops[candidate][0], () => destinationSet(candidate)));
  }
  if (destination != null) actions.append(action('Clear alert', () => destinationSet(null)));
  content.append(search, actions, list);
  function refresh() {
    const query = normalize(search.value);
    const found = [];
    for (const [index, [name]] of stops.entries()) {
      if (!normalize(name).includes(query)) continue;
      const passed = progress != null && index < next;
      const details = 'Stop ' + (index + 1) + ' of ' + stops.length + (passed ? ' · Passed' : index === destination ? ' · Alert stop' : '');
      found.push(resultRow(name, details, () => destinationSet(index), '', passed));
    }
    if (found.length) list.replaceChildren(...found);
    else listMessage(list, 'No stop matches that name on this trip.');
  }
  search.addEventListener('input', refresh);
  refresh();
}

function openSaved() {
  const content = openDialog('Saved rides', 'Routes and get-down stops you’ve bookmarked on this device.');
  const list = element('ul', 'results');
  const available = routes ? favorites.map(item => ({item, ride:routes.find(r => routeFingerprint(r) === item.key)})).filter(x => x.ride) : [];
  if (!available.length) listMessage(list, 'Use the bookmark beside the tracking button to save a ride.');
  for (const {item, ride} of available) {
    const detail = item.destination != null && ride.ids[item.destination] != null
      ? 'Get off at ' + stopName(ride, item.destination)
      : 'From ' + routeStart(ride);
    list.append(resultRow('To ' + routeEnd(ride), detail, () => chooseRoute(ride, item.destination), ride.code));
  }
  content.append(list);
}

function openInstall() {
  const content = openDialog('Add to Home Screen', 'Open the tracker like an app on your iPhone.');
  const instructions = element('ol', 'instructions');
  for (const step of ['Open this site in Safari.', 'Tap Share, then Add to Home Screen. You may need to scroll.', 'Tap Add. Open Next Stop from your Home Screen.']) {
    instructions.append(element('li', '', step));
  }
  content.append(instructions);
}

$('change-route').addEventListener('click', openRoutes);
$('destination-open').addEventListener('click', () => openStops());
$('track').addEventListener('click', () => mode === 'gps' ? stopGPS() : startGPS());
$('demo').addEventListener('click', () => mode === 'demo' ? stopDemo() : startDemo());
$('show-stops').addEventListener('click', () => { showAll = !showAll; renderTimeline(); });
$('close-panel').addEventListener('click', () => dialog.close());
$('dismiss-arrival').addEventListener('click', () => { $('arrival').hidden = true; });
$('saved-open').addEventListener('click', openSaved);
$('install-open').addEventListener('click', openInstall);
$('favorite').addEventListener('click', () => {
  const key = routeFingerprint(route);
  const existing = favorites.findIndex(item => item.key === key && item.destination === destination);
  if (existing >= 0) favorites.splice(existing, 1);
  else favorites.unshift({key, destination});
  save('saved-rides', favorites);
  render();
  notify(existing >= 0 ? 'Removed from saved rides.' : 'Saved. Find it under Saved rides.');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && mode === 'gps') keepAwake();
});
setInterval(() => {
  if (mode === 'gps' && !gpsIssue && Date.now() - lastAccepted > 22000) {
    gpsIssue = 'GPS updates paused. Waiting for a new fix…';
    render();
  }
}, 5000);

async function initialize() {
  try {
    const response = await fetch('./network.json');
    if (!response.ok) throw new Error('Network dataset is unavailable');
    network = await response.json();
    routeMap.setPlaces(network.stops);
    routes = network.routes.map(([code, ids, frequency, shape]) => ({
      code, ids, frequency, shape, key:code + ':' + ids.map(i => network.stops[i].join('|')).join('/'),
      normalCode:normalize(code).replace(/ /g, ''),
      search:normalize([code, ...ids.map(i => network.stops[i][0])].join(' '))
    }));
    demoRoute = routes.filter(r => r.code === '570' && /siruseri/.test(normalize(routeEnd(r)))).sort((a,b) => b.frequency - a.frequency)[0] || routes[0];
    const previous = read('last-ride', {});
    const previousRoute = routes.find(r => routeFingerprint(r) === previous.key);
    chooseRoute(previousRoute || demoRoute, previousRoute ? previous.destination : null);
    for (const id of ['change-route', 'track', 'favorite', 'destination-open', 'demo']) $(id).disabled = false;
  } catch {
    $('route-title').textContent = 'Couldn’t load routes';
    $('gps-copy').textContent = 'Check your connection and reload to try again.';
  }
}
initialize();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(async registration => {
  await registration.update();
}).catch(() => {});
