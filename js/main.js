// Точка входа приложения: сцена Three.js (стена, лампа, модель),
// привязка UI, перестроение модели и экспорт в STL.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { FONTS, loadFont, buildTextShapes } from './fonts.js';
import { buildModelGeometry } from './model.js';

const wrap = document.getElementById('canvas-wrap');
const statusEl = document.getElementById('status');

// ---------- Сцена ----------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151b);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
camera.position.set(180, 160, 460);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
wrap.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 150, 40);
controls.enableDamping = true;

// Стена, на которую падает тень. Большая — чтобы помещались крупные
// надписи; центр смещён вверх (тень проецируется выше светильника).
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(2400, 1600),
  new THREE.MeshStandardMaterial({ color: 0xe8e6e2, roughness: 0.95 })
);
wall.position.set(0, 600, 0);
wall.receiveShadow = true;
scene.add(wall);

// Лампа (точечный источник) и её визуализация.
// Сцена в миллиметрах, а three.js рассчитывает освещение в метрах:
// с decay=2 и большой интенсивностью картинка пересвечивается.
// Поэтому decay=0 (без затухания) и умеренная интенсивность.
const lamp = new THREE.PointLight(0xfff2dd, 2.2, 0, 0);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 10;
lamp.shadow.camera.far = 400;
lamp.shadow.bias = -0.0002;
lamp.shadow.normalBias = 0.3;
scene.add(lamp);

const bulb = new THREE.Mesh(
  new THREE.SphereGeometry(8, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffe9b8 })
);
scene.add(bulb);

// Корпус светильника (бра): крепится к стене под моделью, лампа —
// на его верхнем торце, светит вверх. Отбрасывает тень, поэтому
// стена под светильником остаётся тёмной, а над ним — светлой.
const sconce = new THREE.Mesh(
  new THREE.BoxGeometry(64, 26, 1),
  new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5 })
);
sconce.castShadow = true;
scene.add(sconce);

scene.add(new THREE.AmbientLight(0xffffff, 0.3));

// Группа модели светильника.
const modelGroup = new THREE.Group();
scene.add(modelGroup);
const modelMaterial = new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.6 });
let currentGeometry = null;

// ---------- UI ----------

const els = {
  text: document.getElementById('text-input'),
  font: document.getElementById('font-select'),
  size: document.getElementById('size-input'),
  depth: document.getElementById('depth-input'),
  spacing: document.getElementById('spacing-input'),
  bar: document.getElementById('bar-input'),
  bottomBar: document.getElementById('bottom-bar-check'),
  frame: document.getElementById('frame-check'),
  sconce: document.getElementById('sconce-dist-input'),
  modelDist: document.getElementById('model-dist-input'),
  shadowHeight: document.getElementById('shadow-height-input'),
  exportBtn: document.getElementById('export-btn'),
};

for (const f of FONTS) {
  const option = document.createElement('option');
  option.value = f.id;
  option.textContent = f.name;
  els.font.appendChild(option);
}

function readState() {
  const num = (el, fallback) => {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    text: els.text.value,
    fontDef: FONTS.find((f) => f.id === els.font.value) || FONTS[0],
    size: Math.min(400, Math.max(10, num(els.size, 60))),
    depth: Math.min(30, Math.max(1, num(els.depth, 3))),
    spacing: Math.min(30, Math.max(-5, num(els.spacing, 2))),
    barThickness: Math.min(20, Math.max(1, num(els.bar, 4))),
    bottomBar: els.bottomBar.checked,
    frame: els.frame.checked,
    sconceDist: Math.min(100, Math.max(20, num(els.sconce, 100))),
    modelDist: Math.min(95, Math.max(10, num(els.modelDist, 50))),
    shadowHeight: Math.min(1200, Math.max(50, num(els.shadowHeight, 200))),
  };
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ---------- Перестроение модели ----------

let rebuildToken = 0;
let rebuildTimer = null;

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 250);
}

async function rebuild() {
  const token = ++rebuildToken;
  const s = readState();
  setStatus('');
  try {
    const font = await loadFont(s.fontDef);
    if (token !== rebuildToken) return; // пришёл более свежий запрос

    const { shapes, missing } = buildTextShapes(font, s.text, s.size, s.spacing);
    const geometry = buildModelGeometry(shapes, {
      depth: s.depth,
      wallDist: s.modelDist,
      lampDist: s.sconceDist,
      wallTextHeight: s.shadowHeight,
      wallTextSize: s.size,
      barThickness: s.barThickness,
      bottomBar: s.bottomBar,
      frame: s.frame,
    });

    replaceModel(geometry);

    if (missing.length) {
      setStatus(`Нет глифов для: ${missing.join(' ')}`);
    } else if (!geometry) {
      setStatus('Введите непустой текст');
    }
  } catch (err) {
    setStatus(`Ошибка: ${err.message}`);
  }
}

function replaceModel(geometry) {
  for (const child of modelGroup.children) {
    child.geometry.dispose();
  }
  modelGroup.clear();

  currentGeometry = geometry;
  if (geometry) {
    const mesh = new THREE.Mesh(geometry, modelMaterial);
    mesh.castShadow = true;
    modelGroup.add(mesh);
  }
  els.exportBtn.disabled = !geometry;
  // Положение лампы зависит от нижней кромки модели.
  updatePlacement();
}

// Размещение сцены. Геометрия модели строится уже в координатах сцены
// (стена z=0, лампа на оси (0, 0, L)), поэтому модель стоит в нуле.
// Бра: корпус от стены до лампы, лампа на его верхнем торце, светит вверх.
const BULB_DIAMETER = 20; // мм — оценка размера реальной колбы для полутени
function updatePlacement() {
  const s = readState();
  const L = s.sconceDist;
  const d = currentGeometry?.userData?.wallDist ?? s.modelDist;

  lamp.position.set(0, 0, L);
  bulb.position.copy(lamp.position);

  // Корпус бра: от стены до лампы, верхняя кромка чуть ниже лампы.
  sconce.scale.z = L;
  sconce.position.set(0, -19, L / 2);

  // Полутень на стене от реальной (не точечной) лампы:
  // край тени размывается на r·wz/(L−wz) с каждой стороны.
  const r = BULB_DIAMETER / 2;
  const penumbra = (r * (d + s.depth)) / Math.max(L - d - s.depth, 1);
  const info = document.getElementById('shadow-info');
  info.textContent =
    `Тень точная, без искажений (модель-конус вдоль лучей). ` +
    `Полутень от лампы Ø${BULB_DIAMETER} мм ≈ ${penumbra.toFixed(1)} мм` +
    (penumbra < 10 ? '' : ' — ставьте модель ближе к стене');
}

// ---------- Экспорт STL ----------

els.exportBtn.addEventListener('click', () => {
  if (!currentGeometry) return;
  const exporter = new STLExporter();
  // Ориентация для печати: задняя (большая) грань модели — на стол.
  // Геометрия построена в координатах сцены (z — вдоль лучей), поэтому
  // поворачиваем вокруг X и опускаем так, чтобы задняя грань легла в z=0.
  const d = currentGeometry.userData.wallDist ?? 0;
  const tmp = new THREE.Mesh(currentGeometry);
  tmp.rotation.x = -Math.PI / 2;   // (x, y, z) → (x, z, −y)
  tmp.position.y = -d;             // задняя грань (z=d) — на платформе
  tmp.updateMatrixWorld(true);
  const data = exporter.parse(tmp, { binary: true });
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = (els.text.value.trim().replace(/\s+/g, '-') || 'shadow-text');
  a.href = url;
  a.download = `${name}.stl`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- События ----------

for (const el of [els.text, els.size, els.depth, els.spacing, els.bar]) {
  el.addEventListener('input', scheduleRebuild);
}
els.font.addEventListener('change', scheduleRebuild);
els.bottomBar.addEventListener('change', scheduleRebuild);
els.frame.addEventListener('change', scheduleRebuild);
// Расстояния входят в анаморфное сжатие геометрии — модель пересоздаётся.
for (const el of [els.sconce, els.modelDist, els.shadowHeight]) {
  el.addEventListener('input', scheduleRebuild);
}

function onResize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}
window.addEventListener('resize', onResize);

// ---------- Запуск ----------

onResize();
updatePlacement();
rebuild();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
