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
camera.position.set(160, 110, 430);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
wrap.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 70, 0);
controls.enableDamping = true;

// Стена, на которую падает тень.
const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(900, 600),
  new THREE.MeshStandardMaterial({ color: 0xe8e6e2, roughness: 0.95 })
);
wall.position.z = 0;
wall.receiveShadow = true;
scene.add(wall);

// Лампа (точечный источник) и её визуализация.
// Сцена в миллиметрах, а three.js рассчитывает освещение в метрах:
// с decay=2 и большой интенсивностью картинка пересвечивается.
// Поэтому decay=0 (без затухания) и умеренная интенсивность.
const lamp = new THREE.PointLight(0xfff2dd, 2.2, 0, 0);
lamp.castShadow = true;
lamp.shadow.mapSize.set(2048, 2048);
lamp.shadow.camera.near = 5;
lamp.shadow.camera.far = 1000;
lamp.shadow.bias = -0.0005;
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
  wallDist: document.getElementById('wall-dist-input'),
  lampDist: document.getElementById('lamp-dist-input'),
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
    size: Math.min(200, Math.max(10, num(els.size, 40))),
    depth: Math.min(30, Math.max(1, num(els.depth, 5))),
    spacing: Math.min(30, Math.max(-5, num(els.spacing, 2))),
    barThickness: Math.min(20, Math.max(1, num(els.bar, 4))),
    bottomBar: els.bottomBar.checked,
    frame: els.frame.checked,
    wallDist: Math.min(400, Math.max(20, num(els.wallDist, 40))),
    lampDist: Math.min(400, Math.max(20, num(els.lampDist, 80))),
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

// Размещение сцены: светильник (бра) висит на стене НИЖЕ модели и
// светит вверх. Модель параллельна стене, поэтому тень на стене —
// это равномерно увеличенная копия надписи, БЕЗ искажений
// (проекция точечного источника между параллельными плоскостями —
// гомотетия). Лампа дальше от стены, чем модель: лучи от неё через
// буквы уходят вверх и назад, на стену над светильником.
function updatePlacement() {
  const s = readState();
  modelGroup.position.set(0, 0, s.wallDist);

  const zLamp = s.wallDist + s.lampDist;
  const modelBottom = currentGeometry?.boundingBox?.min.y ?? -20;
  const lampY = modelBottom - 25; // лампа на 25 мм ниже нижней кромки модели

  lamp.position.set(0, lampY, zLamp);
  bulb.position.copy(lamp.position);

  // Корпус бра: от стены до лампы, верхняя кромка чуть ниже лампы.
  const sconceDepth = Math.max(20, zLamp - 6);
  sconce.scale.z = sconceDepth;
  sconce.position.set(0, lampY - 20, sconceDepth / 2);

  // Масштаб тени на стене (коэффициент гомотетии).
  const scale = zLamp / s.lampDist;
  const info = document.getElementById('shadow-info');
  info.textContent = `Тень на стене: без искажений, масштаб ×${scale.toFixed(2)}`;
}

// ---------- Экспорт STL ----------

els.exportBtn.addEventListener('click', () => {
  if (!currentGeometry) return;
  const exporter = new STLExporter();
  // Временный меш без трансформаций — STL в исходных мм, по центру.
  const tmp = new THREE.Mesh(currentGeometry);
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
// Расстояния влияют только на размещение в сцене, модель не пересоздают.
for (const el of [els.wallDist, els.lampDist]) {
  el.addEventListener('input', updatePlacement);
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
