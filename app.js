/* =============================================
   GeoTag Foto - app.js
   =============================================
   Fitur:
   - Upload foto (drag & drop / file picker)
   - Baca koordinat GPS dari metadata EXIF otomatis
   - Deteksi GPS dari browser (Geolocation API)
   - Edit koordinat manual & klik peta
   - Reverse geocoding (koordinat → alamat)
   - Pencarian lokasi via Nominatim
   - Simpan data geotag di memori (state lokal)
   - Export JSON
   - Print / Laporan
   - Toast notification
   ============================================= */

'use strict';

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
const state = {
  photos: [],        // array of PhotoEntry
  activeIdx: null,   // index foto aktif
};

/**
 * @typedef {Object} PhotoEntry
 * @property {string}  id
 * @property {string}  name
 * @property {string}  dataUrl   - base64 data URL untuk preview
 * @property {File}    file
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {string}  datetime  - ISO string
 * @property {string}  address
 * @property {string}  note
 * @property {boolean} tagged
 */

// ──────────────────────────────────────────────
// LEAFLET MAP
// ──────────────────────────────────────────────
let map = null;
let marker = null;

// Mini-map di dalam preview foto
let miniMap = null;
let miniMarker = null;

function initMap(lat, lng) {
  const center = (lat != null && lng != null) ? [lat, lng] : [-2.5, 118];
  const zoom   = (lat != null && lng != null) ? 14 : 5;

  if (map) {
    map.setView(center, zoom);
    updateMarker(lat, lng);
    return;
  }

  map = L.map('map').setView(center, zoom);

  // Tile layer CartoDB Voyager (tampilan mirip Google Maps, gratis, tanpa API key)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
  }).addTo(map);

  // Geocoder search control bawaan Leaflet
  L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: 'Cari lokasi...',
    geocoder: L.Control.Geocoder.nominatim(),
  })
    .on('markgeocode', (e) => {
      const { center } = e.geocode;
      applyCoords(center.lat, center.lng, true);
    })
    .addTo(map);

  // Klik peta → set koordinat
  map.on('click', (e) => {
    applyCoords(e.latlng.lat, e.latlng.lng, true);
  });

  // Pastikan tile muncul di HP (container mungkin belum sepenuhnya di-render)
  setTimeout(() => map.invalidateSize(), 200);
}

function updateMarker(lat, lng) {
  if (!map) return;
  if (lat == null || lng == null) {
    if (marker) { map.removeLayer(marker); marker = null; }
    return;
  }
  const pos = [lat, lng];
  if (marker) {
    marker.setLatLng(pos);
  } else {
    marker = L.marker(pos, { draggable: true }).addTo(map);
    marker.on('dragend', (e) => {
      const p = e.target.getLatLng();
      applyCoords(p.lat, p.lng, false);
    });
  }
  map.setView(pos, map.getZoom() < 10 ? 14 : map.getZoom());
}

// ──────────────────────────────────────────────
// MINI-MAP (di preview foto)
// ──────────────────────────────────────────────
function updateMiniMap(lat, lng) {
  const el = document.getElementById('photo-minimap');
  if (!el) return;

  if (lat == null || lng == null) {
    el.classList.remove('visible');
    return;
  }

  el.classList.add('visible');

  if (!miniMap) {
    miniMap = L.map('photo-minimap', {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    }).setView([lat, lng], 15);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
    }).addTo(miniMap);
  }

  miniMap.setView([lat, lng], 15);

  if (miniMarker) {
    miniMarker.setLatLng([lat, lng]);
  } else {
    miniMarker = L.marker([lat, lng]).addTo(miniMap);
  }

  setTimeout(() => miniMap.invalidateSize(), 80);
}

// ──────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────
function createToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

function toast(msg, type = 'info', duration = 3000) {
  const container = createToastContainer();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .4s';
    setTimeout(() => el.remove(), 400);
  }, duration);
}

// ──────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDatetimeLocal(date) {
  // Format ke "YYYY-MM-DDTHH:mm" untuk input datetime-local
  const d = new Date(date);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplayDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Format tanggal untuk overlay foto: "30 Mar 2026 11:16:34"
function formatOverlayDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d)) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day  = String(d.getDate()).padStart(2, '0');
  const mon  = months[d.getMonth()];
  const year = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, '0');
  const mm   = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year} ${hh}:${mm}`;
}

// Konversi desimal ke DMS, misal: -7.071213 → "7°4'16.36452\"S"
function decimalToDMS(decimal, isLat) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = (minFull - min) * 60;
  const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  return `${deg}\u00b0${min}'${parseFloat(sec.toFixed(5))}"${dir}`;
}

function decimalToDMSString(lat, lng) {
  if (lat == null || lng == null) return '';
  return `${decimalToDMS(lat, true)} ${decimalToDMS(lng, false)}`;
}

// Pecah alamat menjadi bagian: village, kecamatan, kabupaten, province
function parseAddressParts(address) {
  if (!address) return { village: '', kecamatan: '', kabupaten: '', province: '' };
  const parts = address.split(', ').map((s) => s.trim()).filter(Boolean);
  let village = '', kecamatan = '', kabupaten = '', province = '';

  // Pass 1: deteksi via prefix
  for (const part of parts) {
    if (!village    && /^(desa|kel\.|kelurahan)\s+/i.test(part))
      village = part.replace(/^(desa|kel\.|kelurahan)\s+/i, '').trim();
    else if (!kecamatan && /^(kec\.|kecamatan)\s+/i.test(part))
      kecamatan = 'Kecamatan ' + part.replace(/^(kec\.|kecamatan)\s+/i, '').trim();
    else if (!kabupaten && /^(kabupaten|kota)\s+/i.test(part))
      kabupaten = part;
  }

  // Pass 2: fallback posisional — ambil dari belakang
  // Format: [..., kecamatan?, kabupaten?, provinsi]
  const remaining = parts.filter((p) =>
    !/^(desa|kel\.|kelurahan|kec\.|kecamatan|kabupaten|kota|dusun|jl\.)\s/i.test(p)
  );

  if (!province && remaining.length >= 1)
    province = remaining[remaining.length - 1];
  if (!kabupaten && remaining.length >= 2) {
    const raw = remaining[remaining.length - 2];
    kabupaten = /^(kabupaten|kota)\s/i.test(raw) ? raw : 'Kabupaten ' + raw;
  }
  if (!kecamatan && remaining.length >= 3) {
    const raw = remaining[remaining.length - 3];
    kecamatan = /^(kecamatan|kec\.)\s/i.test(raw) ? raw : 'Kecamatan ' + raw;
  }
  if (!village && remaining.length >= 4)
    village = remaining[remaining.length - 4];

  return { village, kecamatan, kabupaten, province };
}

// Konversi DMS (Degrees, Minutes, Seconds) dari EXIF ke desimal
function dmsToDecimal(dms, ref) {
  if (!dms || dms.length < 3) return null;
  const [deg, min, sec] = dms;
  let val = deg + min / 60 + sec / 3600;
  if (ref === 'S' || ref === 'W') val = -val;
  return val;
}

// ──────────────────────────────────────────────
// EXIF READING
// ──────────────────────────────────────────────
function readExif(file) {
  return new Promise((resolve) => {
    EXIF.getData(file, function () {
      const data = EXIF.getAllTags(this);
      let lat = null, lng = null, datetime = '';

      // Koordinat GPS
      if (data.GPSLatitude && data.GPSLongitude) {
        lat = dmsToDecimal(
          [data.GPSLatitude[0], data.GPSLatitude[1], data.GPSLatitude[2]],
          data.GPSLatitudeRef
        );
        lng = dmsToDecimal(
          [data.GPSLongitude[0], data.GPSLongitude[1], data.GPSLongitude[2]],
          data.GPSLongitudeRef
        );
      }

      // Waktu dari EXIF
      // Format EXIF: "YYYY:MM:DD HH:MM:SS"
      const rawDate = data.DateTimeOriginal || data.DateTime || '';
      if (rawDate) {
        // Ubah ke format ISO
        const parts = rawDate.replace(' ', 'T').replace(/:/g, '-');
        // Perbaiki: hanya bagian tanggal yang pakai -, bagian waktu tetap :
        const fixedDate = rawDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
        datetime = new Date(fixedDate).toISOString();
      }

      resolve({ lat, lng, datetime });
    });
  });
}

// ──────────────────────────────────────────────
// REVERSE GEOCODING
// 1. Overpass API — batas admin + place terdekat (multi-mirror)
// 2. Nominatim multi-zoom — fallback
// ──────────────────────────────────────────────

// Mirror Overpass — semua dicoba PARALEL, ambil yang paling cepat berhasil
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpassPost(query) {
  const body = 'data=' + encodeURIComponent(query);

  const attempt = (ep) => new Promise((resolve, reject) => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000); // 2 detik max
    fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    })
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) return res.json().then(resolve).catch(reject);
        reject(new Error(`HTTP ${res.status}`));
      })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });

  // Semua mirror dijalankan paralel — ambil hasil tercepat yang berhasil
  return Promise.any(OVERPASS_MIRRORS.map(attempt))
    .catch(() => { throw new Error('Semua mirror Overpass gagal / timeout'); });
}

async function reverseGeocode(lat, lng) {
  const latR = parseFloat(lat.toFixed(6));
  const lngR = parseFloat(lng.toFixed(6));

  // Jalankan Overpass dan Nominatim PARALEL
  const [overpassData, nominatimData] = await Promise.all([
    (async () => {
      try {
        const query =
          `[out:json][timeout:8];` +
          `is_in(${latR},${lngR})->.a;` +
          `(` +
          `  area.a["admin_level"~"^[4-9]$"]["name"];` +
          `  node(around:5000,${latR},${lngR})["place"~"^(village|hamlet|neighbourhood|suburb|quarter)$"]["name"];` +
          `);` +
          `out body;`;
        const data = await overpassPost(query);
        return data.elements || [];
      } catch (e) {
        return [];
      }
    })(),
    reverseGeocodeWithNominatim(lat, lng).catch(() => ({ formatted: '', raw: {} })),
  ]);

  const nominatimResult = nominatimData.formatted;
  const nominatimRaw    = nominatimData.raw || {};

  // Proses hasil Overpass
  let overpassResult = '';
  let overpassHasKec = false;
  if (overpassData.length) {
    state._lastRawAddress = overpassData;
    state._lastRawAddressType = 'overpass';
    overpassResult = buildAddressFromOverpass(overpassData, latR, lngR);
    // Cek apakah kecamatan (admin_level=6) ada di hasil Overpass
    overpassHasKec = overpassData.some(e => e.type === 'area' && parseInt(e.tags?.admin_level) === 6);
  }

  // Gabungkan: Overpass prioritas, TAPI jika Overpass tidak punya kecamatan,
  // coba ambil kecamatan dari Nominatim dan sisipkan
  if (overpassResult && overpassHasKec) return overpassResult;

  if (overpassResult && !overpassHasKec && nominatimResult) {
    // Sisipkan kecamatan dari Nominatim ke hasil Overpass
    const parts = overpassResult.split(', ');
    const nomParts = nominatimResult.split(', ');
    let kecNom = nomParts.find(p => /^kec\./i.test(p) || /^kecamatan\s/i.test(p));

    // Jika tidak ditemukan di formatted string, cari langsung di raw field Nominatim
    if (!kecNom) {
      const { a10 = {}, a12 = {}, a13 = {}, a14 = {}, a18 = {} } = nominatimRaw;
      const kecRaw =
        a13.city_district || a14.city_district || a12.city_district || a18.city_district ||
        a13.district      || a14.district      || a12.district      || a18.district      || a10.district ||
        a13.subdistrict   || a14.subdistrict   || a12.subdistrict   ||
        a13.municipality  || a14.municipality  || a12.municipality  ||
        a13.state_district|| a14.state_district;
      if (kecRaw) kecNom = 'Kec. ' + kecRaw.replace(/^(kecamatan|kec\.?)\s*/i, '').trim();
    }

    if (kecNom && parts.length >= 2) {
      parts.splice(1, 0, kecNom);
      return parts.join(', ');
    }
    return overpassResult;
  }

  // Gabungkan: Overpass prioritas, isi yang kosong dari Nominatim
  if (overpassResult) return overpassResult;
  if (nominatimResult) return nominatimResult;
  return '';
}

function buildByLevel(elements) {
  const byLevel = {};
  (elements || []).filter(e => e.type === 'area').forEach((el) => {
    const level = parseInt(el.tags?.admin_level);
    if (!isNaN(level) && el.tags?.name && !byLevel[level]) byLevel[level] = el.tags.name;
  });
  return byLevel;
}

function cleanAdminName(name) {
  if (!name) return '';
  return name
    .replace(/^(Desa|Kelurahan|Kel\.|Kecamatan|Kec\.|Kabupaten|Kota|Dusun)\s+/i, '')
    .trim();
}

// Hitung jarak dua titik (km) – Haversine sederhana
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildAddressFromOverpass(elements, refLat, refLng) {
  if (!elements || !elements.length) return '';

  // Pisahkan berdasarkan tipe elemen
  const areaEls  = elements.filter((el) => el.type === 'area' || el.type === 'relation');
  const nodeEls  = elements.filter((el) => el.type === 'node' && el.lat != null);

  // Buat map admin level dari area/relation
  const byLevel = {};
  areaEls.forEach((el) => {
    const level = parseInt(el.tags?.admin_level);
    const name  = el.tags?.name;
    if (!isNaN(level) && name && !byLevel[level]) byLevel[level] = name;
  });

  console.log('[GeoTag] Overpass byLevel:', byLevel);

  const parts = [];

  // === Dusun ===
  // Coba dari admin level 8-9 dulu
  const dusunAdmin = byLevel[9] || byLevel[8];
  if (dusunAdmin) {
    parts.push('Dusun ' + cleanAdminName(dusunAdmin));
  } else {
    // Cari node terdekat bertag place=hamlet
    const hamletNode = nodeEls
      .filter((n) => n.tags?.place === 'hamlet')
      .sort((a, b) => haversineKm(refLat, refLng, a.lat, a.lon) - haversineKm(refLat, refLng, b.lat, b.lon))[0];
    if (hamletNode) parts.push('Dusun ' + cleanAdminName(hamletNode.tags.name));
  }

  // === Desa / Kelurahan ===
  if (byLevel[7]) {
    const name = cleanAdminName(byLevel[7]);
    const isKel = /^(kelurahan|kel\.?)/i.test(byLevel[7]);
    parts.push((isKel ? 'Kel. ' : 'Desa ') + name);
  } else {
    // Cari node terdekat bertag place=village/suburb/neighbourhood
    const villageNode = nodeEls
      .filter((n) => ['village', 'suburb', 'neighbourhood'].includes(n.tags?.place))
      .sort((a, b) => haversineKm(refLat, refLng, a.lat, a.lon) - haversineKm(refLat, refLng, b.lat, b.lon))[0];
    if (villageNode) {
      const nm = cleanAdminName(villageNode.tags.name);
      const isKel = villageNode.tags.place === 'suburb';
      parts.push((isKel ? 'Kel. ' : 'Desa ') + nm);
    }
  }

  // === Kecamatan ===
  // Hanya dari admin_level=6 — jika tidak ada di OSM, dikosongkan
  if (byLevel[6]) {
    parts.push('Kec. ' + cleanAdminName(byLevel[6]));
  }

  // === Kabupaten / Kota ===
  if (byLevel[5]) parts.push(byLevel[5]);

  // === Provinsi ===
  if (byLevel[4]) parts.push(byLevel[4]);

  return parts.filter(Boolean).join(', ');
}

// ── Nominatim multi-zoom (fallback) ──────────
async function reverseGeocodeWithNominatim(lat, lng) {
  const latR = parseFloat(lat.toFixed(6));
  const lngR = parseFloat(lng.toFixed(6));
  const base = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&namedetails=1&extratags=1&lat=${latR}&lon=${lngR}&accept-language=id`;

  const [r10, r12, r13, r14, r18] = await Promise.all([
    fetch(`${base}&zoom=10`).then((r) => r.json()).catch(() => ({})),
    fetch(`${base}&zoom=12`).then((r) => r.json()).catch(() => ({})),
    fetch(`${base}&zoom=13`).then((r) => r.json()).catch(() => ({})),
    fetch(`${base}&zoom=14`).then((r) => r.json()).catch(() => ({})),
    fetch(`${base}&zoom=18`).then((r) => r.json()).catch(() => ({})),
  ]);

  const a10 = r10.address || {};
  const a12 = r12.address || {};
  const a13 = r13.address || {};
  const a14 = r14.address || {};
  const a18 = r18.address || {};

  // Simpan semua untuk debug (merged)
  state._lastRawAddress = Object.assign({}, a10, a12, a13, a14, a18);
  state._lastRawAddressType = 'nominatim';
  console.log('[GeoTag] Nominatim z10:', a10, '| z12:', a12, '| z13:', a13, '| z14:', a14, '| z18:', a18);

  const formatted = buildAddressNominatim(a10, a12, a13, a14, a18) || r18.display_name || r14.display_name || '';
  return { formatted, raw: { a10, a12, a13, a14, a18 } };
}

function buildAddressNominatim(a10, a12, a13, a14, a18) {
  if (!a10 && !a14 && !a18) return '';
  const parts = [];

  // Desa — dari zoom=18 atau 14
  const desa = a18.village || a18.suburb || a14.village || a14.suburb ||
               a13.village || a12.village;
  if (desa) {
    const isKel = !(a18.village || a14.village || a13.village || a12.village);
    parts.push((isKel ? 'Kel. ' : 'Desa ') + desa);
  }

  // Kecamatan — cek banyak field karena OSM Indonesia tidak konsisten
  const kec =
    a13.municipality || a13.subdistrict || a13.district || a13.city_district || a13.state_district ||
    (a13.city && (a13.county || a13.regency) ? a13.city : null) ||
    a14.municipality || a14.subdistrict || a14.district || a14.city_district || a14.state_district ||
    (a14.city && (a14.county || a14.regency) ? a14.city : null) ||
    a12.municipality || a12.subdistrict || a12.district || a12.city_district || a12.state_district ||
    (a12.city && (a12.county || a12.regency) ? a12.city : null) ||
    a18.municipality || a18.subdistrict || a18.district || a18.city_district ||
    a10.municipality || a10.subdistrict || a10.district || a10.city_district;
  if (kec) parts.push('Kec. ' + kec.replace(/^(kecamatan|kec\.?)\s*/i, '').trim());

  // Kabupaten — dari zoom=10 paling andal
  const kabkota = a10.county || a10.regency || a12.county || a12.regency ||
                  a13.county || a13.regency || a14.county || a14.regency ||
                  (a10.city && !a10.village ? a10.city : null);
  if (kabkota) {
    const hasPrefix = /^(kabupaten|kota)\s/i.test(kabkota);
    parts.push(hasPrefix ? kabkota : 'Kabupaten ' + kabkota);
  }

  // Provinsi
  const prov = a10.state || a12.state || a14.state || a18.state;
  if (prov) parts.push(prov);

  return parts.filter(Boolean).join(', ');
}

// ── Debug Panel ──────────────────────────────
function showAddressDebug() {
  const raw = state._lastRawAddress;
  const isEmpty = !raw || (Array.isArray(raw) ? !raw.length : !Object.keys(raw).length);
  if (isEmpty) {
    toast('Belum ada data alamat. Klik dulu di peta atau deteksi GPS.', 'error');
    return;
  }

  let html = '';

  if (state._lastRawAddressType === 'overpass') {
    const areaEls = raw.filter((el) => el.type === 'area');
    const nodeEls = raw.filter((el) => el.type === 'node');
    html += `<p style="margin-bottom:8px;color:#16a34a;font-weight:600">&#10004; Sumber: Overpass API</p>`;

    if (areaEls.length) {
      html += '<p style="font-weight:600;margin-bottom:5px;">Batas Administrasi (area):</p>';
      html += '<table><tr style="background:#f1f5f9"><th style="padding:4px 10px 4px 0;text-align:left">Level</th><th style="text-align:left">Nama</th></tr>';
      [...areaEls]
        .sort((a, b) => parseInt(a.tags?.admin_level) - parseInt(b.tags?.admin_level))
        .forEach((el) => {
          html += `<tr><td style="font-weight:600;padding:3px 12px 3px 0;color:#2563eb">Level ${el.tags?.admin_level || '?'}</td><td>${el.tags?.name || '-'}</td></tr>`;
        });
      html += '</table>';
    } else {
      html += '<p style="color:#dc2626;margin-bottom:8px">&#9888; Tidak ada batas admin di OSM untuk area ini.</p>';
    }

    if (nodeEls.length) {
      html += '<p style="font-weight:600;margin:10px 0 5px;">Place Terdekat (node):</p>';
      html += '<table><tr style="background:#f1f5f9"><th style="padding:4px 10px 4px 0;text-align:left">Tipe</th><th style="text-align:left">Nama</th></tr>';
      nodeEls.forEach((el) => {
        html += `<tr><td style="font-weight:600;padding:3px 12px 3px 0;color:#16a34a">${el.tags?.place || '?'}</td><td>${el.tags?.name || '-'}</td></tr>`;
      });
      html += '</table>';
    }
  } else {
    html += `<p style="margin-bottom:8px;color:#f59e0b;font-weight:600">&#9888; Sumber: Nominatim (data terbatas untuk area ini)</p>`;
    const rows = Object.entries(raw)
      .map(([k, v]) => `<tr><td style="font-weight:600;padding:3px 14px 3px 0;color:#2563eb">${k}</td><td>${v}</td></tr>`)
      .join('');
    html += `<table>${rows}</table>`;
  }

  document.getElementById('debug-table').innerHTML = html;
  document.getElementById('modal-debug').style.display = 'flex';
}

// ──────────────────────────────────────────────
// APPLY KOORDINAT ke foto aktif + UI
// ──────────────────────────────────────────────
async function applyCoords(lat, lng, doReverseGeocode) {
  const photo = getActive();
  if (!photo) return;

  photo.lat = lat;
  photo.lng = lng;

  document.getElementById('field-lat').value = lat.toFixed(7);
  document.getElementById('field-lng').value = lng.toFixed(7);

  updateMarker(lat, lng);
  updateMiniMap(lat, lng);
  updateOverlay(photo);
  refreshPhotoCard(state.activeIdx);

  if (doReverseGeocode) {
    document.getElementById('field-address').value = '⏳ Mengambil alamat...';
    const addr = await reverseGeocode(lat, lng);
    photo.address = addr;
    document.getElementById('field-address').value = addr;
    updateOverlay(photo);
    updateGoogleMapsLink(lat, lng);
    _coordsManuallyChanged = false;
  }
}

// ──────────────────────────────────────────────
// PHOTO OVERLAY (GPS Camera style)
// ──────────────────────────────────────────────
function updateOverlay(photo) {
  const panel = document.getElementById('photo-overlay');

  const hasData = (photo.lat != null && photo.lng != null) || photo.datetime || photo.address;
  if (!hasData) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // Tanggal & waktu
  document.getElementById('overlay-datetime').textContent = formatOverlayDate(photo.datetime);

  // Koordinat DMS
  document.getElementById('overlay-coords').textContent = decimalToDMSString(photo.lat, photo.lng);

  // Alamat per baris
  const addr = parseAddressParts(photo.address);
  document.getElementById('overlay-village').textContent   = addr.village;
  document.getElementById('overlay-kecamatan').textContent = addr.kecamatan;
  document.getElementById('overlay-kabupaten').textContent = addr.kabupaten;
  document.getElementById('overlay-province').textContent  = addr.province;

  // Ketinggian & kecepatan
  const spd = photo.speed != null ? photo.speed : 0;
  document.getElementById('overlay-speed').textContent = `Speed:${parseFloat(spd.toFixed(1))}km/h`;

  // Nama instansi
  const orgField = document.getElementById('field-org');
  const orgName  = (orgField ? orgField.value.trim() : '') || photo.org || localStorage.getItem('geotag_org') || '';
  document.getElementById('overlay-org').textContent = orgName.toUpperCase();

  // Update mini-map
  updateMiniMap(photo.lat, photo.lng);
}

// ──────────────────────────────────────────────
// GET ACTIVE PHOTO
// ──────────────────────────────────────────────
function getActive() {
  if (state.activeIdx == null) return null;
  return state.photos[state.activeIdx] || null;
}

// ──────────────────────────────────────────────
// ADD PHOTOS
// ──────────────────────────────────────────────
async function addPhotos(files) {
  const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
  if (!arr.length) { toast('Tidak ada file gambar yang valid.', 'error'); return; }

  toast(`Memproses ${arr.length} foto...`, 'info', 4000);

  for (const file of arr) {
    const dataUrl = await fileToDataUrl(file);
    const exif    = await readExif(file);

    /** @type {PhotoEntry} */
    const entry = {
      id:       uid(),
      name:     file.name,
      dataUrl,
      file,
      lat:      exif.lat,
      lng:      exif.lng,
      datetime: exif.datetime || new Date().toISOString(),
      address:  '',
      note:     '',
      altitude: null,
      speed:    null,
      org:      localStorage.getItem('geotag_org') || '',
      tagged:   exif.lat != null && exif.lng != null,
    };

    // Jika ada GPS dari EXIF, ambil alamat otomatis
    if (entry.lat != null && entry.lng != null) {
      entry.address = await reverseGeocode(entry.lat, entry.lng);
    }

    state.photos.push(entry);
  }

  document.getElementById('editor-section').style.display = '';
  renderPhotoList();

  // Aktifkan foto terakhir ditambahkan
  selectPhoto(state.photos.length - arr.length);

  toast(`${arr.length} foto berhasil dimuat.`, 'success');
}

// ──────────────────────────────────────────────
// RENDER PHOTO LIST
// ──────────────────────────────────────────────
function renderPhotoList() {
  const list = document.getElementById('photo-list');
  list.innerHTML = '';
  state.photos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = `photo-card${i === state.activeIdx ? ' active' : ''}${p.tagged ? ' tagged' : ''}`;
    div.innerHTML = `
      <img class="photo-thumb" src="${p.dataUrl}" alt="${escHtml(p.name)}" />
      <div class="photo-info">
        <div class="name" title="${escHtml(p.name)}">${escHtml(p.name)}</div>
        <div class="meta">${formatDisplayDate(p.datetime)}</div>
        <div class="meta">${p.lat != null ? p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) : 'Belum ada koordinat'}</div>
      </div>
      <span class="tag-badge ${p.tagged ? 'ok' : 'no'}">${p.tagged ? '✔ Tagged' : '✗ Belum'}</span>
    `;
    div.addEventListener('click', () => selectPhoto(i));
    list.appendChild(div);
  });
}

function refreshPhotoCard(idx) {
  const list = document.getElementById('photo-list');
  const cards = list.querySelectorAll('.photo-card');
  if (!cards[idx]) return;
  const p = state.photos[idx];
  if (!p) return;
  const card = cards[idx];
  card.className = `photo-card${idx === state.activeIdx ? ' active' : ''}${p.tagged ? ' tagged' : ''}`;
  card.querySelector('.meta:last-of-type').textContent =
    p.lat != null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'Belum ada koordinat';
  card.querySelector('.tag-badge').className  = `tag-badge ${p.tagged ? 'ok' : 'no'}`;
  card.querySelector('.tag-badge').textContent = p.tagged ? '✔ Tagged' : '✗ Belum';
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ──────────────────────────────────────────────
// SELECT PHOTO
// ──────────────────────────────────────────────
function selectPhoto(idx) {
  state.activeIdx = idx;
  const photo = state.photos[idx];

  // Toggle active class di list
  document.querySelectorAll('.photo-card').forEach((c, i) => {
    c.classList.toggle('active', i === idx);
  });

  // Isi form
  document.getElementById('empty-hint').style.display  = 'none';
  document.getElementById('editor-form').style.display = '';

  document.getElementById('preview-img').src      = photo.dataUrl;
  document.getElementById('field-name').value     = photo.name;
  document.getElementById('field-datetime').value = formatDatetimeLocal(photo.datetime);
  document.getElementById('field-lat').value      = photo.lat != null ? photo.lat.toFixed(7) : '';
  document.getElementById('field-lng').value      = photo.lng != null ? photo.lng.toFixed(7) : '';
  document.getElementById('field-address').value  = photo.address;
  document.getElementById('field-note').value     = photo.note;
  document.getElementById('field-speed').value = photo.speed != null ? photo.speed.toFixed(1) : '';
  document.getElementById('field-org').value      = photo.org != null ? photo.org : (localStorage.getItem('geotag_org') || '');

  updateOverlay(photo);

  // Init / update peta
  setTimeout(() => {
    initMap(photo.lat, photo.lng);
    updateMarker(photo.lat, photo.lng);
    updateMiniMap(photo.lat, photo.lng);
    updateGoogleMapsLink(photo.lat, photo.lng);
    if (map) map.invalidateSize();
  }, 80);
  // Panggil lagi setelah delay lebih panjang untuk HP (render lebih lambat)
  setTimeout(() => { if (map) map.invalidateSize(); }, 350);
  setTimeout(() => { if (map) map.invalidateSize(); }, 700);
}

// ──────────────────────────────────────────────
// SAVE GEOTAG
// ──────────────────────────────────────────────
async function saveGeotag() {
  const photo = getActive();
  if (!photo) return;

  const lat = parseFloat(document.getElementById('field-lat').value);
  const lng = parseFloat(document.getElementById('field-lng').value);
  const dt  = document.getElementById('field-datetime').value;
  const note = document.getElementById('field-note').value.trim();

  const coordsChanged = !isNaN(lat) && !isNaN(lng) &&
    (_coordsManuallyChanged ||
      photo.lat == null || Math.abs(photo.lat - lat) > 0.00001 || Math.abs(photo.lng - lng) > 0.00001);

  if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    photo.lat = lat;
    photo.lng = lng;
    photo.tagged = true;
    updateMarker(lat, lng);
    updateMiniMap(lat, lng);
  } else if (document.getElementById('field-lat').value !== '') {
    toast('Koordinat tidak valid!', 'error');
    return;
  }

  photo.datetime = dt ? new Date(dt).toISOString() : photo.datetime;
  photo.note     = note;
  photo.speed    = parseFloat(document.getElementById('field-speed').value) || null;
  photo.org      = document.getElementById('field-org').value.trim();
  if (photo.org) {
    localStorage.setItem('geotag_org', photo.org);
  } else {
    localStorage.removeItem('geotag_org');
  }

  // Jika koordinat berubah atau diketik ulang manual, ambil ulang alamat otomatis
  if (coordsChanged) {
    _coordsManuallyChanged = false;
    document.getElementById('field-address').value = '⏳ Mengambil alamat...';
    toast('Koordinat berubah, mengambil alamat baru...', 'info', 3000);
    const newAddr = await reverseGeocode(lat, lng);
    photo.address = newAddr;
    document.getElementById('field-address').value = newAddr;
    updateGoogleMapsLink(lat, lng);
  } else {
    photo.address = document.getElementById('field-address').value.trim();
  }

  updateOverlay(photo);
  refreshPhotoCard(state.activeIdx);
  toast('Geotag disimpan! ✔', 'success');
}

// ──────────────────────────────────────────────
// TOMBOL BUKA GOOGLE MAPS
// ──────────────────────────────────────────────
function updateGoogleMapsLink(lat, lng) {
  const btn = document.getElementById('btn-open-gmaps');
  if (!btn) return;
  if (lat != null && lng != null) {
    btn.href = `https://www.google.com/maps?q=${lat},${lng}`;
    btn.style.display = 'inline-flex';
  } else {
    btn.style.display = 'none';
  }
}

// ──────────────────────────────────────────────
// GPS BROWSER
// ──────────────────────────────────────────────
function detectGPS(forAll = false) {
  if (!navigator.geolocation) {
    toast('Browser tidak mendukung Geolocation.', 'error');
    return;
  }
  toast('Mendeteksi lokasi GPS...', 'info', 3000);
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng, speed } = pos.coords;
      const spdKmh = speed != null ? speed * 3.6 : null;
      if (forAll) {
        for (let i = 0; i < state.photos.length; i++) {
          const p = state.photos[i];
          if (!p.tagged) {
            p.lat    = lat;
            p.lng    = lng;
            p.tagged = true;
          }
          if (p.speed == null) p.speed = spdKmh;
        }
        // Ambil alamat sekali untuk semua
        const addr = await reverseGeocode(lat, lng);
        state.photos.forEach((p) => { if (!p.address) p.address = addr; });
        renderPhotoList();
        if (state.activeIdx != null) selectPhoto(state.activeIdx);
        toast(`GPS diterapkan ke semua foto yang belum tergeotag.`, 'success');
      } else {
        await applyCoords(lat, lng, true);
        // Update datetime ke sekarang jika kosong
        const photo = getActive();
        if (photo) {
          if (!photo.datetime) {
            photo.datetime = new Date().toISOString();
            document.getElementById('field-datetime').value = formatDatetimeLocal(new Date());
          }
          photo.speed = spdKmh;
          document.getElementById('field-speed').value = spdKmh != null ? spdKmh.toFixed(1) : '';
          updateOverlay(photo);
        }
        toast(`GPS terdeteksi: ${lat.toFixed(6)}, ${lng.toFixed(6)}`, 'success');
      }
    },
    (err) => {
      const msgs = {
        1: 'Akses lokasi ditolak. Izinkan lokasi di browser.',
        2: 'Posisi tidak tersedia.',
        3: 'Timeout mendeteksi lokasi.',
      };
      toast(msgs[err.code] || 'Gagal mendapatkan lokasi.', 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ──────────────────────────────────────────────
// GEOCODE INPUT KOORDINAT → ALAMAT
// ──────────────────────────────────────────────
async function geocodeFromFields() {
  const lat = parseFloat(document.getElementById('field-lat').value);
  const lng = parseFloat(document.getElementById('field-lng').value);
  if (isNaN(lat) || isNaN(lng)) {
    toast('Masukkan koordinat latitude dan longitude terlebih dahulu.', 'error');
    return;
  }
  document.getElementById('field-address').value = '⏳ Mengambil alamat...';
  const addr = await reverseGeocode(lat, lng);
  document.getElementById('field-address').value = addr || 'Alamat tidak ditemukan';
  const photo = getActive();
  if (photo) { photo.address = addr; updateOverlay(photo); }
  updateMarker(lat, lng);
  if (map) map.setView([lat, lng], 16);
  updateGoogleMapsLink(lat, lng);
}

// ──────────────────────────────────────────────
// DOWNLOAD FOTO DENGAN OVERLAY (Canvas)
// ──────────────────────────────────────────────
async function downloadPhoto() {
  const photo = getActive();
  if (!photo) return;

  toast('Menyiapkan foto...', 'info', 4000);

  const img = new Image();
  img.src = photo.dataUrl;
  await new Promise((r) => { img.onload = r; });

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // Skala acuan sisi terpendek foto
  const BASE  = Math.min(W, H);
  const scale = BASE / 700;

  const pad    = Math.round(20 * scale);
  const fSize  = Math.round(24 * scale);
  const lineH  = Math.round(fSize * 1.45);
  const mapSz  = Math.round(250 * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  // Kumpulkan baris teks
  const dtStr   = formatOverlayDate(photo.datetime);
  const coordStr = decimalToDMSString(photo.lat, photo.lng);
  const addrPts  = parseAddressParts(photo.address);
  const spd      = photo.speed != null ? photo.speed : 0;
  const orgEl    = document.getElementById('field-org');
  const orgRaw   = (orgEl ? orgEl.value.trim() : '') || photo.org || localStorage.getItem('geotag_org') || '';
  const orgName  = orgRaw.toUpperCase();

  const lines = [
    dtStr,
    coordStr,
    addrPts.village,
    addrPts.kecamatan,
    addrPts.kabupaten,
    addrPts.province,
    `Speed:${parseFloat(spd.toFixed(1))}km/h`,
    orgName,
  ].filter(Boolean);

  if (!lines.length && photo.lat == null) {
    doDownload(canvas, photo.name);
    return;
  }

  // Dimensi panel
  const textBlockH = lines.length * lineH;
  const panelH     = Math.max(textBlockH + pad * 2, mapSz + pad * 2);
  const panelY     = H - panelH;

  // Tidak ada latar belakang — teks tampil langsung di atas foto

  // Thumbnail peta mepet pojok bawah-kiri
  const mapX = 0;
  const mapY = H - mapSz;

  const mapCanvas = (photo.lat != null && photo.lng != null)
    ? await buildMapTileImage(photo.lat, photo.lng, mapSz, mapSz)
    : null;

  if (mapCanvas) {
    ctx.drawImage(mapCanvas, mapX, mapY, mapSz, mapSz);
    // Label "Google"
    const gfSize = Math.round(fSize * 0.78);
    ctx.font        = `bold ${gfSize}px "Segoe UI", sans-serif`;
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = Math.round(gfSize * 0.5);
    ctx.fillText('Google', mapX + Math.round(pad * 0.5), mapY + mapSz - Math.round(pad * 0.35));
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
  }

  // Baris teks (kanan)
  const textBlockW = lines.reduce((max, l) => {
    ctx.font = `bold ${fSize}px "Segoe UI", sans-serif`;
    return Math.max(max, ctx.measureText(l).width);
  }, 0);
  const tx = W - Math.round(pad * 1.5);
  let   ty = panelY + Math.round((panelH - textBlockH) / 2) + fSize;

  ctx.textAlign = 'right';
  for (let i = 0; i < lines.length; i++) {
    ctx.font        = `bold ${fSize}px "Segoe UI", sans-serif`;
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur  = Math.round(fSize * 0.55);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(fSize * 0.08);
    ctx.fillText(lines[i], tx, ty);
    ty += lineH;
  }
  ctx.textAlign     = 'left';
  ctx.shadowColor   = 'transparent';
  ctx.shadowBlur    = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  doDownload(canvas, photo.name);
  toast('Foto berhasil diunduh! \u2714', 'success');
}

// ── Fetch tile OSM 3×3 → crop ke ukuran mini-map ──────────────────────
async function buildMapTileImage(lat, lng, pixelW, pixelH) {
  const zoom = 15;
  const n    = Math.pow(2, zoom);
  const lngF = (lng + 180) / 360;
  const latR = lat * Math.PI / 180;
  const latF = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2;
  const tX   = Math.floor(lngF * n);
  const tY   = Math.floor(latF * n);

  const TILE = 256;
  const tmp  = document.createElement('canvas');
  tmp.width  = TILE * 3;
  tmp.height = TILE * 3;
  const tCtx = tmp.getContext('2d');

  await Promise.allSettled(
    [-1, 0, 1].flatMap((dy) =>
      [-1, 0, 1].map(async (dx) => {
        const img = await fetchOSMTile(tX + dx, tY + dy, zoom).catch(() => null);
        if (img) tCtx.drawImage(img, (dx + 1) * TILE, (dy + 1) * TILE, TILE, TILE);
      })
    )
  );

  // Pixel posisi lat/lng di canvas 3×3
  const cx = (lngF * n - tX + 1) * TILE;
  const cy = (latF * n - tY + 1) * TILE;

  // Crop sebesar yang muat di dalam tmp (768×768), lalu scale ke pixelW×pixelH
  const srcW  = TILE * 3;
  const srcH  = TILE * 3;
  const cropW = Math.min(pixelW, srcW);
  const cropH = Math.min(pixelH, srcH);
  let sx = Math.round(cx - cropW / 2);
  let sy = Math.round(cy - cropH / 2);
  // Pastikan tidak keluar batas sumber
  sx = Math.max(0, Math.min(sx, srcW - cropW));
  sy = Math.max(0, Math.min(sy, srcH - cropH));

  const out  = document.createElement('canvas');
  out.width  = pixelW;
  out.height = pixelH;
  const oCtx = out.getContext('2d');
  // Scale crop ke ukuran output penuh → selalu mepet tanpa area kosong
  oCtx.drawImage(tmp, sx, sy, cropW, cropH, 0, 0, pixelW, pixelH);

  // Marker merah di tengah
  const mx = Math.round(pixelW / 2);
  const my = Math.round(pixelH / 2);
  const pr = Math.round(pixelW * 0.06); // marker size relatif mini-map
  oCtx.fillStyle = '#e53e3e';
  oCtx.beginPath();
  oCtx.arc(mx, my - pr, pr, 0, Math.PI * 2);
  oCtx.fill();
  oCtx.beginPath();
  oCtx.moveTo(mx - pr * 0.8, my - pr * 0.5);
  oCtx.lineTo(mx + pr * 0.8, my - pr * 0.5);
  oCtx.lineTo(mx, my + pr * 1.2);
  oCtx.closePath();
  oCtx.fill();

  return out;
}

async function fetchOSMTile(x, y, zoom) {
  const n = Math.pow(2, zoom);
  x = ((x % n) + n) % n;
  // ArcGIS World Imagery (satellite tiles)
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('tile failed');
  const blob   = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img   = new Image();
    img.onload  = () => { URL.revokeObjectURL(objUrl); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(); };
    img.src     = objUrl;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);     ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);     ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);         ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// Rounded hanya sudut kiri (untuk clip area peta)
function roundRectLeft(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + r, y + h);     ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);         ctx.arcTo(x, y,     x + r, y,     r);
  ctx.closePath();
}

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function doDownload(canvas, originalName) {
  const ext  = originalName.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const name = originalName.replace(/\.[^.]+$/, '') + '_geotagged.' + (ext === 'png' ? 'png' : 'jpg');
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, mime, 0.93);
}

// ──────────────────────────────────────────────
// EXPORT JSON
// ──────────────────────────────────────────────
function exportJSON() {
  if (!state.photos.length) { toast('Belum ada foto.', 'error'); return; }
  const data = state.photos.map((p) => ({
    name:     p.name,
    latitude: p.lat,
    longitude: p.lng,
    datetime: p.datetime,
    address:  p.address,
    note:     p.note,
    tagged:   p.tagged,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `geotag_export_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('JSON berhasil diexport.', 'success');
}

// ──────────────────────────────────────────────
// PRINT / LAPORAN
// ──────────────────────────────────────────────
function generateReport() {
  if (!state.photos.length) { toast('Belum ada foto.', 'error'); return; }
  const section = document.getElementById('report-section');
  const content = document.getElementById('report-content');
  content.innerHTML = '';

  state.photos.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'report-card';
    div.innerHTML = `
      <img src="${p.dataUrl}" alt="${escHtml(p.name)}" />
      <div class="report-info">
        <h4>${escHtml(p.name)}</h4>
        <p>🕐 ${formatDisplayDate(p.datetime)}</p>
        <p>🏠 ${escHtml(p.address || '-')}</p>
        ${p.note ? `<p>📝 ${escHtml(p.note)}</p>` : ''}
        <code class="coords">📍 ${p.lat != null ? `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}` : 'Belum ada koordinat'}</code>
        ${p.lat != null
          ? `<a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener noreferrer" style="font-size:.75rem;color:#2563eb;">Buka di Google Maps ↗</a>`
          : ''}
      </div>
    `;
    content.appendChild(div);
  });

  section.style.display = '';
  section.scrollIntoView({ behavior: 'smooth' });
  toast('Laporan dibuat. Gunakan Ctrl+P untuk mencetak.', 'info', 5000);
}

// ──────────────────────────────────────────────
// REMOVE PHOTO
// ──────────────────────────────────────────────
function removePhoto() {
  if (state.activeIdx == null) return;
  const name = state.photos[state.activeIdx].name;
  state.photos.splice(state.activeIdx, 1);

  if (!state.photos.length) {
    state.activeIdx = null;
    document.getElementById('editor-section').style.display       = 'none';
    document.getElementById('report-section').style.display       = 'none';
    document.getElementById('editor-form').style.display          = 'none';
    document.getElementById('empty-hint').style.display           = '';
    document.getElementById('preview-img').src                    = '';
  } else {
    state.activeIdx = Math.min(state.activeIdx, state.photos.length - 1);
    renderPhotoList();
    selectPhoto(state.activeIdx);
  }

  renderPhotoList();
  toast(`Foto "${name}" dihapus.`, 'info');
}

// ──────────────────────────────────────────────
// KOORDINAT MANUAL UPDATE (live update marker)
// ──────────────────────────────────────────────
let _coordsManuallyChanged = false;

function onCoordsInput() {
  _coordsManuallyChanged = true;
  const lat = parseFloat(document.getElementById('field-lat').value);
  const lng = parseFloat(document.getElementById('field-lng').value);
  if (!isNaN(lat) && !isNaN(lng) && map) {
    updateMarker(lat, lng);
    map.setView([lat, lng], map.getZoom() < 10 ? 14 : map.getZoom());
  }
}

// ──────────────────────────────────────────────
// DRAG & DROP
// ──────────────────────────────────────────────
function initDragDrop() {
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', ()  => { zone.classList.remove('dragover'); });
  zone.addEventListener('drop',      (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files.length) addPhotos(e.dataTransfer.files);
  });
  zone.addEventListener('click', (e) => {
    if (e.target.closest('label')) return; // label sudah handle native file picker
    document.getElementById('file-input').click();
  });
}

// ──────────────────────────────────────────────
// EVENT LISTENERS BINDING
// ──────────────────────────────────────────────
function bindEvents() {
  // File input
  document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files.length) addPhotos(e.target.files);
    e.target.value = ''; // reset agar bisa upload file sama lagi
  });

  // GPS tombol
  document.getElementById('btn-gps').addEventListener('click', () => detectGPS(false));
  document.getElementById('btn-gps-all').addEventListener('click', () => detectGPS(true));

  // Geocode from field
  document.getElementById('btn-geocode').addEventListener('click', geocodeFromFields);

  // Simpan
  document.getElementById('btn-save').addEventListener('click', saveGeotag);

  // Hapus
  document.getElementById('btn-remove').addEventListener('click', removePhoto);

  // Unduh foto
  document.getElementById('btn-download').addEventListener('click', downloadPhoto);

  // Export JSON
  document.getElementById('btn-export-all').addEventListener('click', exportJSON);

  // Print / laporan
  document.getElementById('btn-print').addEventListener('click', generateReport);

  // Live update marker saat koordinat diketik
  document.getElementById('field-lat').addEventListener('input', onCoordsInput);
  document.getElementById('field-lng').addEventListener('input', onCoordsInput);

  // Koordinat juga bisa di-enter untuk langsung reverse geocode
  const latInput = document.getElementById('field-lat');
  const lngInput = document.getElementById('field-lng');
  [latInput, lngInput].forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') geocodeFromFields();
    });
  });

  // Map search
  document.getElementById('btn-map-search').addEventListener('click', doMapSearch);
  document.getElementById('map-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doMapSearch();
    if (e.key === 'Escape') {
      document.getElementById('map-search-results').style.display = 'none';
    }
  });
  document.getElementById('map-search-input').addEventListener('input', () => {
    clearTimeout(mapSearchTimeout);
    mapSearchTimeout = setTimeout(doMapSearch, 500);
  });
  // Tutup dropdown saat klik di luar
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-search-bar') && !e.target.closest('#map-search-results')) {
      document.getElementById('map-search-results').style.display = 'none';
    }
  });

  // Modal search
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('modal-search').style.display = 'none';
  });
  document.getElementById('btn-do-search').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // Tutup modal klik overlay
  document.getElementById('modal-search').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-search')) {
      document.getElementById('modal-search').style.display = 'none';
    }
  });

  // Debug alamat
  document.getElementById('btn-debug-addr').addEventListener('click', showAddressDebug);
  document.getElementById('btn-close-debug').addEventListener('click', () => {
    document.getElementById('modal-debug').style.display = 'none';
  });
  document.getElementById('modal-debug').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-debug')) {
      document.getElementById('modal-debug').style.display = 'none';
    }
  });

  // Nama instansi – update overlay langsung saat mengetik
  document.getElementById('field-org').addEventListener('input', () => {
    const photo = getActive();
    if (photo) updateOverlay(photo);
  });
}

// ──────────────────────────────────────────────
// SEARCH LOCATION (Nominatim)
// ──────────────────────────────────────────────
async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;

  const resultsDiv = document.getElementById('search-results');
  resultsDiv.innerHTML = '<div class="spinner"></div> Mencari...';

  try {
    const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=8&accept-language=id`;
    const res  = await fetch(url);
    const data = await res.json();

    if (!data.length) {
      resultsDiv.innerHTML = '<p style="color:#64748b;font-size:.85rem;">Tidak ada hasil ditemukan.</p>';
      return;
    }

    resultsDiv.innerHTML = '';
    data.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.textContent = item.display_name;
      div.addEventListener('click', async () => {
        await applyCoords(parseFloat(item.lat), parseFloat(item.lon), false);
        const photo = getActive();
        if (photo) {
          photo.address = item.display_name;
          document.getElementById('field-address').value = item.display_name;
          updateOverlay(photo);
        }
        document.getElementById('modal-search').style.display = 'none';
      });
      resultsDiv.appendChild(div);
    });
  } catch {
    resultsDiv.innerHTML = '<p style="color:#dc2626;">Gagal mengambil hasil pencarian. Cek koneksi internet.</p>';
  }
}

// ──────────────────────────────────────────────
// MAP SEARCH (Nominatim inline)
// ──────────────────────────────────────────────
let mapSearchTimeout = null;

async function doMapSearch() {
  const q = document.getElementById('map-search-input').value.trim();
  const dropdown = document.getElementById('map-search-results');
  if (!q) { dropdown.style.display = 'none'; return; }

  dropdown.style.display = '';
  dropdown.innerHTML = '<div class="map-search-empty">⏳ Mencari...</div>';

  try {
    const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&accept-language=id&countrycodes=id`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'id' } });
    const data = await res.json();

    if (!data.length) {
      dropdown.innerHTML = '<div class="map-search-empty">Tidak ada hasil ditemukan.</div>';
      return;
    }

    dropdown.innerHTML = '';
    data.forEach((item) => {
      const parts = item.display_name.split(', ');
      const name   = parts.slice(0, 2).join(', ');
      const detail = parts.slice(2).join(', ');

      const div = document.createElement('div');
      div.className = 'map-search-result-item';
      div.innerHTML = `<div class="result-name">${escHtml(name)}</div><div class="result-detail">${escHtml(detail)}</div>`;
      div.addEventListener('click', () => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        if (map) {
          map.setView([lat, lng], 15);
          updateMarker(lat, lng);
        }
        document.getElementById('field-lat').value = lat.toFixed(7);
        document.getElementById('field-lng').value = lng.toFixed(7);
        document.getElementById('map-search-input').value = name;
        dropdown.style.display = 'none';
        applyCoords(lat, lng, true);
      });
      dropdown.appendChild(div);
    });
  } catch {
    dropdown.innerHTML = '<div class="map-search-empty" style="color:#dc2626;">Gagal mencari. Cek koneksi internet.</div>';
  }
}

// INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDragDrop();
  bindEvents();
});

// Saat orientasi berubah (portrait ↔ landscape), paksa Leaflet resize
window.addEventListener('orientationchange', () => {
  setTimeout(() => { if (map) map.invalidateSize(); }, 300);
  setTimeout(() => { if (map) map.invalidateSize(); }, 700);
});
window.addEventListener('resize', () => {
  if (map) map.invalidateSize();
});
