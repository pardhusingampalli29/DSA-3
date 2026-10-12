const STORAGE_KEY = 'team23-route-optimizer-v1';
const starter = {
  locations: [
    { id: 'warehouse', name: 'Warehouse', type: 'Warehouse' },
    { id: 'north-park', name: 'North Park', type: 'Delivery point' },
    { id: 'old-town', name: 'Old Town', type: 'Delivery point' },
    { id: 'east-market', name: 'East Market', type: 'Delivery point' },
    { id: 'city-center', name: 'City Center', type: 'Delivery point' },
    { id: 'south-gate', name: 'South Gate', type: 'Delivery point' },
    { id: 'airport', name: 'Airport', type: 'Delivery point' }
  ],
  roads: [
    { from: 'warehouse', to: 'north-park', km: 4 }, { from: 'warehouse', to: 'old-town', km: 3 },
    { from: 'warehouse', to: 'south-gate', km: 7 }, { from: 'north-park', to: 'old-town', km: 2 },
    { from: 'north-park', to: 'east-market', km: 5 }, { from: 'old-town', to: 'east-market', km: 4 },
    { from: 'old-town', to: 'city-center', km: 6 }, { from: 'old-town', to: 'south-gate', km: 3 },
    { from: 'east-market', to: 'city-center', km: 2 }, { from: 'east-market', to: 'airport', km: 6 },
    { from: 'city-center', to: 'airport', km: 3 }, { from: 'city-center', to: 'south-gate', km: 5 }
  ]
};

function loadNetwork() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.locations) && Array.isArray(saved.roads)) return saved;
  } catch (error) {
    console.warn('Saved data could not be read. Loading the sample network.', error);
  }
  return structuredClone(starter);
}
let network = loadNetwork();
let currentPage = 'planner';
let lastRoute = null;
let locationSearch = '';
let editingLocation = null;
const app = document.querySelector('#app');
const byId = id => document.getElementById(id);
const locationName = id => network.locations.find(item => item.id === id)?.name || id;

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
function saveNetwork() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(network));
    byId('saveStatus').textContent = 'Saved in this browser';
  } catch (error) {
    byId('saveStatus').textContent = 'Could not save';
    showToast('Browser storage is unavailable. Export a copy of your network data.');
  }
  byId('navLocationCount').textContent = network.locations.length;
  byId('navRoadCount').textContent = network.roads.length;
}
function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

class MinHeap {
  constructor() { this.values = []; }
  push(entry) {
    this.values.push(entry);
    let i = this.values.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.values[parent][0] <= this.values[i][0]) break;
      [this.values[i], this.values[parent]] = [this.values[parent], this.values[i]];
      i = parent;
    }
  }
  pop() {
    if (!this.values.length) return null;
    const first = this.values[0], last = this.values.pop();
    if (this.values.length) {
      this.values[0] = last;
      let i = 0;
      while (true) {
        const left = 2 * i + 1, right = left + 1;
        let smallest = i;
        if (left < this.values.length && this.values[left][0] < this.values[smallest][0]) smallest = left;
        if (right < this.values.length && this.values[right][0] < this.values[smallest][0]) smallest = right;
        if (smallest === i) break;
        [this.values[i], this.values[smallest]] = [this.values[smallest], this.values[i]];
        i = smallest;
      }
    }
    return first;
  }
}
function buildAdjacencyList() {
  const graph = new Map(network.locations.map(item => [item.id, []]));
  network.roads.forEach(road => {
    if (!graph.has(road.from) || !graph.has(road.to)) return;
    graph.get(road.from).push({ location: road.to, km: Number(road.km) });
    graph.get(road.to).push({ location: road.from, km: Number(road.km) });
  });
  return graph;
}
function findShortestRoute(start, destination) {
  const graph = buildAdjacencyList();
  const distances = new Map(network.locations.map(item => [item.id, Infinity]));
  const previous = new Map(), visited = new Set(), queue = new MinHeap();
  distances.set(start, 0);
  queue.push([0, start]);
  while (queue.values.length) {
    const [distance, current] = queue.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === destination) break;
    for (const road of graph.get(current) || []) {
      const candidate = distance + road.km;
      if (candidate < distances.get(road.location)) {
        distances.set(road.location, candidate);
        previous.set(road.location, current);
        queue.push([candidate, road.location]);
      }
    }
  }
  if (distances.get(destination) === Infinity) return null;
  const stops = [];
  for (let stop = destination; stop !== undefined; stop = previous.get(stop)) stops.unshift(stop);
  return { stops, distance: distances.get(destination) };
}
function pageHeading(eyebrow, title, description, action = '') {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function routeResultMarkup() {
  if (!lastRoute) return '<div class="empty-result"><span class="empty-symbol">↗</span><b>No route calculated yet</b><p>Select a start and destination, then run the planner.</p></div>';
  const stops = lastRoute.stops.map((id, index) => `${index ? '<span class="stop-arrow">→</span>' : ''}<span class="stop">${escapeText(locationName(id))}</span>`).join('');
  return `<div class="result-top"><div><b>Shortest route found</b><div class="form-help">${lastRoute.stops.length} locations · Dijkstra with min heap</div></div><span>${lastRoute.distance}<small> km</small></span></div><div class="route-stops">${stops}</div><div class="result-foot"><span>Estimated travel time</span><b>${lastRoute.minutes} min at ${lastRoute.speed} km/h</b></div>`;
}
function segmentListMarkup() {
  if (!lastRoute || !lastRoute.roads.length) return '<div class="table-empty">Calculate a route to see each road and its distance.</div>';
  return lastRoute.roads.map((road, index) => `<div class="segment-row"><span class="segment-num">${index + 1}</span><span class="segment-name">${escapeText(locationName(road.from))} → ${escapeText(locationName(road.to))}</span><span class="segment-km">${road.km} km</span></div>`).join('');
}
function renderPlanner() {
  const options = network.locations.map(item => `<option value="${escapeText(item.id)}">${escapeText(item.name)}${item.type === 'Warehouse' ? ' · Warehouse' : ''}</option>`).join('');
  const defaultEnd = network.locations.find(item => item.id !== 'warehouse')?.id || '';
  app.innerHTML = `${pageHeading('DELIVERY NETWORK', 'Route planner', 'Find the shortest connected route between two locations.')}
    <section class="stats"><div class="stat"><div class="stat-label">LOCATIONS</div><div class="stat-value">${network.locations.length}</div><div class="stat-note">Warehouse and delivery points</div></div><div class="stat"><div class="stat-label">ROAD CONNECTIONS</div><div class="stat-value">${network.roads.length}</div><div class="stat-note">Distances stored in kilometers</div></div><div class="stat result-stat"><div class="stat-label">SHORTEST DISTANCE</div><div class="stat-value" id="routeDistance">${lastRoute ? `${lastRoute.distance} km` : '—'}</div><div class="stat-note" id="routeDistanceNote">${lastRoute ? `${lastRoute.roads.length} road segments` : 'Choose locations to calculate'}</div></div></section>
    <div class="planner-layout"><section class="card"><div class="card-head"><div><h2>Choose a delivery route</h2><p>Distances are calculated from the road connections below.</p></div></div><form class="route-form" id="routeForm"><div class="field"><label for="routeStart">STARTING LOCATION</label><select id="routeStart" required>${options}</select></div><div class="route-line"></div><div class="field"><label for="routeEnd">DESTINATION</label><select id="routeEnd" required>${options}</select></div><div class="field-grid"><div class="field"><label for="averageSpeed">AVERAGE SPEED</label><input id="averageSpeed" type="number" min="1" max="200" step="1" value="30" required></div><div class="field"><label>UNIT</label><input value="km per hour" disabled></div></div><button class="button primary" type="submit">Find shortest route <span>→</span></button><p class="form-help">Travel time is an estimate based on the speed entered.</p></form></section>
    <section class="card"><div class="card-head"><div><h2>Route result</h2><p id="resultCaption">Shortest path between selected locations</p></div></div><div class="result-card" id="routeResult">${routeResultMarkup()}</div></section></div>
    <section class="card segments"><div class="segments-head"><h2>Road by road</h2><span id="segmentSummary">${lastRoute ? `${lastRoute.roads.length} road segments` : 'Route details will appear here'}</span></div><div id="segmentList">${segmentListMarkup()}</div></section>`;
  if (network.locations.length) {
    const start = lastRoute?.start || (network.locations.some(item => item.id === 'warehouse') ? 'warehouse' : network.locations[0].id);
    byId('routeStart').value = network.locations.some(item => item.id === start) ? start : network.locations[0].id;
    const wantedEnd = lastRoute?.end || defaultEnd;
    byId('routeEnd').value = network.locations.some(item => item.id === wantedEnd && item.id !== byId('routeStart').value) ? wantedEnd : (network.locations.find(item => item.id !== byId('routeStart').value)?.id || '');
  }
  byId('routeForm').addEventListener('submit', calculateRouteFromForm);
  if (network.locations.length > 1) calculateRouteFromForm({ preventDefault() {} });
}
function calculateRouteFromForm(event) {
  event.preventDefault();
  const start = byId('routeStart').value, end = byId('routeEnd').value, speed = Number(byId('averageSpeed').value);
  if (!start || !end) return showToast('Add at least two locations first.');
  if (start === end) return showToast('Choose two different locations.');
  if (!Number.isFinite(speed) || speed <= 0) return showToast('Enter a speed greater than zero.');
  const result = findShortestRoute(start, end);
  if (!result) {
    lastRoute = null;
    byId('routeDistance').textContent = '—';
    byId('routeDistanceNote').textContent = 'No connected route';
    byId('resultCaption').textContent = 'These locations are not connected';
    byId('routeResult').innerHTML = '<div class="empty-result"><span class="empty-symbol">!</span><b>No connected route</b><p>Add roads between these locations, then try again.</p></div>';
    byId('segmentSummary').textContent = 'No road segments';
    byId('segmentList').innerHTML = '<div class="table-empty">There is no connected path in the current network.</div>';
    return;
  }
  const roads = result.stops.slice(1).map((to, index) => {
    const from = result.stops[index];
    const road = network.roads.find(item => (item.from === from && item.to === to) || (item.from === to && item.to === from));
    return { from, to, km: Number(road.km) };
  });
  lastRoute = { start, end, speed, stops: result.stops, distance: result.distance, minutes: Math.round(result.distance / speed * 60), roads };
  byId('routeDistance').textContent = `${result.distance} km`;
  byId('routeDistanceNote').textContent = `${roads.length} road ${roads.length === 1 ? 'segment' : 'segments'}`;
  byId('resultCaption').textContent = `${locationName(start)} to ${locationName(end)}`;
  byId('routeResult').innerHTML = routeResultMarkup();
  byId('segmentSummary').textContent = `${roads.length} road ${roads.length === 1 ? 'segment' : 'segments'}`;
  byId('segmentList').innerHTML = segmentListMarkup();
}

function renderLocations() {
  const add = '<button class="button primary" data-action="add-location">＋ Add location</button>';
  const filtered = network.locations.filter(item => item.name.toLowerCase().includes(locationSearch.toLowerCase()));
  const rows = filtered.map(item => `<tr><td class="td-strong">${escapeText(item.name)}</td><td><span class="kind-tag">${escapeText(item.type)}</span></td><td>${network.roads.filter(road => road.from === item.id || road.to === item.id).length}</td><td><div class="row-actions"><button class="row-action" data-action="edit-location" data-id="${escapeText(item.id)}">Edit</button>${item.id === 'warehouse' ? '' : `<button class="row-action delete" data-action="delete-location" data-id="${escapeText(item.id)}">Remove</button>`}</div></td></tr>`).join('');
  app.innerHTML = `${pageHeading('NETWORK DATA', 'Locations', 'Manage the warehouse and delivery points used by the planner.', add)}<section class="card content-card"><div class="toolbar"><span class="form-help">${network.locations.length} locations in this network</span><input class="search" id="locationSearch" type="search" placeholder="Find a location…" value="${escapeText(locationSearch)}" aria-label="Find a location"></div><div class="table-wrap"><table><thead><tr><th>LOCATION</th><th>TYPE</th><th>CONNECTED ROADS</th><th>ACTIONS</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="table-empty">No matching locations.</td></tr>'}</tbody></table></div></section>`;
  byId('locationSearch').addEventListener('input', event => {
    locationSearch = event.target.value;
    const cursor = event.target.selectionStart;
    renderLocations();
    byId('locationSearch').focus();
    byId('locationSearch').setSelectionRange(cursor, cursor);
  });
}
function locationOptions(selected = '') {
  return network.locations.map(item => `<option value="${escapeText(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeText(item.name)}</option>`).join('');
}
function renderRoads(editFrom = '', editTo = '', editKm = '') {
  const rows = network.roads.map((road, index) => `<tr><td class="td-strong">${escapeText(locationName(road.from))}</td><td>${escapeText(locationName(road.to))}</td><td>${Number(road.km)} km</td><td><div class="row-actions"><button class="row-action" data-action="edit-road" data-index="${index}">Edit</button><button class="row-action delete" data-action="delete-road" data-index="${index}">Remove</button></div></td></tr>`).join('');
  app.innerHTML = `${pageHeading('NETWORK DATA', 'Road connections', 'Add or update a distance between two locations. Roads work in both directions.')}<section class="card content-card"><form id="roadForm" class="road-editor"><div class="field"><label for="roadFrom">LOCATION A</label><select id="roadFrom" required>${locationOptions(editFrom || network.locations[0]?.id)}</select></div><div class="field"><label for="roadTo">LOCATION B</label><select id="roadTo" required>${locationOptions(editTo || network.locations[1]?.id)}</select></div><div class="field"><label for="roadKm">DISTANCE (KM)</label><input id="roadKm" type="number" min="0.1" step="0.1" value="${editKm}" placeholder="e.g. 4.5" required></div><button class="button primary" type="submit">Save road</button></form><div class="toolbar"><span class="form-help">${network.roads.length} road connections · saving an existing pair updates it</span></div><div class="table-wrap"><table><thead><tr><th>LOCATION A</th><th>LOCATION B</th><th>DISTANCE</th><th>ACTIONS</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="table-empty">No road connections yet. Add one above.</td></tr>'}</tbody></table></div></section>`;
  byId('roadForm').addEventListener('submit', saveRoadFromForm);
}
function saveRoadFromForm(event) {
  event.preventDefault();
  const from = byId('roadFrom').value, to = byId('roadTo').value, km = Number(byId('roadKm').value);
  if (!from || !to || from === to) return showToast('Choose two different locations.');
  if (!Number.isFinite(km) || km <= 0) return showToast('Enter a distance greater than zero.');
  const existing = network.roads.find(road => (road.from === from && road.to === to) || (road.from === to && road.to === from));
  if (existing) existing.km = km;
  else network.roads.push({ from, to, km });
  lastRoute = null;
  saveNetwork();
  renderRoads();
  showToast(existing ? 'Road distance updated.' : 'Road connection added.');
}
function navigate(page) {
  currentPage = page;
  const titles = { planner: 'Route planner', locations: 'Locations', roads: 'Road connections' };
  byId('crumbPage').textContent = titles[page] || titles.planner;
  document.querySelectorAll('.nav-link,.mobile-nav button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  if (page === 'locations') renderLocations();
  else if (page === 'roads') renderRoads();
  else renderPlanner();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function openLocationDialog(id = '') {
  editingLocation = id || null;
  const item = network.locations.find(location => location.id === id);
  byId('locationDialogTitle').textContent = item ? 'Edit location' : 'Add a location';
  byId('locationName').value = item?.name || '';
  byId('locationDialogHelp').textContent = item ? 'Update the name shown throughout the planner.' : 'Add a delivery point to this network.';
  byId('locationDialog').showModal();
  byId('locationName').focus();
}
function saveLocation(event) {
  event.preventDefault();
  const name = byId('locationName').value.trim();
  if (!name) return showToast('Enter a location name.');
  if (network.locations.some(item => item.name.toLowerCase() === name.toLowerCase() && item.id !== editingLocation)) return showToast('A location with that name already exists.');
  if (editingLocation) network.locations.find(item => item.id === editingLocation).name = name;
  else network.locations.push({ id: `location-${Date.now()}`, name, type: 'Delivery point' });
  byId('locationDialog').close();
  lastRoute = null;
  saveNetwork();
  renderLocations();
  showToast(editingLocation ? 'Location updated.' : 'Location added.');
}
function deleteLocation(id) {
  const item = network.locations.find(location => location.id === id);
  if (!item || id === 'warehouse' || !confirm(`Remove ${item.name} and its connected roads?`)) return;
  network.locations = network.locations.filter(location => location.id !== id);
  network.roads = network.roads.filter(road => road.from !== id && road.to !== id);
  lastRoute = null;
  saveNetwork();
  renderLocations();
  showToast('Location and connected roads removed.');
}
function downloadNetwork() {
  const file = new Blob([JSON.stringify(network, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = 'delivery-network.json';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Network data downloaded.');
}

document.addEventListener('click', event => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) return navigate(pageButton.dataset.page);
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, index } = button.dataset;
  if (action === 'add-location') openLocationDialog();
  if (action === 'edit-location') openLocationDialog(id);
  if (action === 'delete-location') deleteLocation(id);
  if (action === 'delete-road') {
    const road = network.roads[Number(index)];
    if (!road || !confirm(`Remove the road between ${locationName(road.from)} and ${locationName(road.to)}?`)) return;
    network.roads.splice(Number(index), 1);
    lastRoute = null;
    saveNetwork();
    renderRoads();
    showToast('Road connection removed.');
  }
  if (action === 'edit-road') {
    const road = network.roads[Number(index)];
    if (road) renderRoads(road.from, road.to, road.km);
    byId('roadForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
byId('locationDialog').addEventListener('click', event => {
  if (event.target === byId('locationDialog')) byId('locationDialog').close();
});
byId('locationForm').addEventListener('submit', saveLocation);
byId('cancelLocation').addEventListener('click', () => byId('locationDialog').close());
byId('cancelLocationBottom').addEventListener('click', () => byId('locationDialog').close());
byId('exportBtn').addEventListener('click', downloadNetwork);
byId('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset locations and roads to the original sample network?')) return;
  network = structuredClone(starter);
  lastRoute = null;
  saveNetwork();
  navigate(currentPage);
  showToast('Sample network restored.');
});

const mobileNav = document.createElement('nav');
mobileNav.className = 'mobile-nav';
mobileNav.setAttribute('aria-label', 'Mobile navigation');
mobileNav.innerHTML = '<button data-page="planner"><span>↗</span>Planner</button><button data-page="locations"><span>⌖</span>Locations</button><button data-page="roads"><span>⌁</span>Roads</button>';
document.body.append(mobileNav);
updateNavigationCounts();
renderPlanner();








function showAuth(mode = 'login') {
  byId('authGate').hidden = false;
  document.querySelector('.layout').hidden = true;
  setAuthMode(mode);
}
function showWorkspace(user) {
  byId('authGate').hidden = true;
  document.querySelector('.layout').hidden = false;
  byId('accountName').textContent = user.name;
}
function setAuthMode(mode) {
  const register = mode === 'register';
  byId('loginForm').hidden = register;
  byId('registerForm').hidden = !register;
  document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authMode === mode));
  byId('loginMessage').textContent = '';
  byId('registerMessage').textContent = '';
}
async function sendAuthRequest(endpoint, payload, messageElement) {
  messageElement.textContent = '';
  messageElement.classList.remove('success');
  const submitButton = messageElement.closest('form').querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      messageElement.textContent = result.error || 'Unable to sign in. Try again.';
      return;
    }
    messageElement.classList.add('success');
    messageElement.textContent = 'Signed in. Opening your workspace…';
    showWorkspace(result.user);
  } catch (error) {
    messageElement.textContent = 'Could not reach the server. Make sure node server.js is running.';
  } finally {
    submitButton.disabled = false;
  }
}
byId('loginForm').addEventListener('submit', event => {
  event.preventDefault();
  sendAuthRequest('login', {
    email: byId('loginEmail').value.trim(),
    password: byId('loginPassword').value
  }, byId('loginMessage'));
});
byId('registerForm').addEventListener('submit', event => {
  event.preventDefault();
  sendAuthRequest('register', {
    name: byId('registerName').value.trim(),
    email: byId('registerEmail').value.trim(),
    password: byId('registerPassword').value
  }, byId('registerMessage'));
});
document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
byId('logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch (error) { /* The next visit will still check the server session. */ }
  lastRoute = null;
  showAuth('login');
});
(async function checkLogin() {
  try {
    const response = await fetch('/api/me', { cache: 'no-store' });
    const result = await response.json();
    if (response.ok && result.user) showWorkspace(result.user);
    else showAuth('login');
  } catch (error) {
    showAuth('login');
    byId('loginMessage').textContent = 'Start the local server with node server.js, then reload this page.';
  }
})();
