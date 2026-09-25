// Построение геометрии модели светильника.
//
// Модель — не плоская экструзия, а УСЕЧЁННАЯ ПИРАМИДА (конус вдоль
// лучей света): сечения параллельны стене, задняя грань крупнее,
// передняя анаморфически сжата, боковые грани лежат точно на лучах
// «лампа → контур тени». Благодаря этому тень на стене — ТОЧНАЯ копия
// заданного текста: у плоской модели передняя и задняя грани букв
// проецируются с разным масштабом и края тени размазываются, а здесь
// каждый луч проходит через тело ровно один раз.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// shapes — массив THREE.Shape в локальных координатах (базовая линия
// y = 0, надпись вдоль +x). Параметры (всё в мм):
//   depth — толщина модели вдоль лучей;
//   wallDist — расстояние задней грани модели от стены (d);
//   lampDist — расстояние лампы от стены (L), d + depth < L;
//   wallTextHeight — высота НИЗА тени над осью лампы (H);
//   wallTextSize — высота надписи НА СТЕНЕ (мм) — масштаб надписи
//     нормализуется точно под это значение;
//   barThickness, bottomBar, frame — соединительные планки для печати.
// Возвращает геометрию в координатах сцены: стена z=0, лампа (0, 0, L).
export function buildModelGeometry(shapes, opts) {
  const {
    depth = 3,
    wallDist = 50,
    lampDist = 100,
    wallTextHeight = 200,
    wallTextSize = 60,
    barThickness = 4,
    bottomBar = true,
    frame = false,
    margin = 8,
  } = opts;

  const L = lampDist;
  // Модель не должна доходить до лампы, иначе геометрия вырождается.
  const d = Math.min(wallDist, L - depth - 2);
  if (d < 5) return null;

  // Выдавливаем буквы: локальный z от 0 (задняя грань, к стене)
  // до depth (передняя грань, к лампе).
  const letterGeoms = shapes.map(
    (s) => new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 })
  );
  if (letterGeoms.length === 0) return null;

  const letters = BufferGeometryUtils.mergeGeometries(letterGeoms);
  letters.computeBoundingBox();
  const bb = letters.boundingBox;

  // Нормализация масштаба: приводим высоту надписи к wallTextSize
  // (кегль шрифта ≠ высота букв, поэтому считаем по фактическому bbox).
  const textScale = wallTextSize / Math.max(bb.max.y - bb.min.y, 1e-6);

  // Сдвиг надписи в «стеновые» координаты: центр над лампой,
  // низ надписи на высоте wallTextHeight над осью лампы.
  const ox = -((bb.min.x + bb.max.x) / 2) * textScale;
  const oy = wallTextHeight - bb.min.y * textScale;
  letters.scale(textScale, textScale, 1);
  letters.translate(ox, oy, 0);

  const parts = [letters];
  const addBar = (x0, y0, x1, y1) => {
    // Планка-прямоугольник в СТЕНОВЫХ координатах, толщина как у букв.
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, depth).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, depth / 2);
    parts.push(g);
  };

  const left = -(bb.max.x - bb.min.x) * textScale / 2 - margin; // стеновые координаты
  const right = (bb.max.x - bb.min.x) * textScale / 2 + margin;
  const textTop = wallTextHeight + (bb.max.y - bb.min.y) * textScale;

  // Планки задаются прямо на стене — после конусного сжатия они тоже
  // станут конусными и не испортят тень.
  if (bottomBar) {
    addBar(left, wallTextHeight - barThickness - 2, right, wallTextHeight + 0.5);
  }
  if (frame) {
    addBar(left, wallTextHeight - barThickness - 2, right, wallTextHeight + 0.5);
    addBar(left, textTop, right, textTop + barThickness);
    addBar(left, wallTextHeight - barThickness - 2, left + barThickness, textTop + barThickness);
    addBar(right - barThickness, wallTextHeight - barThickness - 2, right, textTop + barThickness);
  }

  const merged = BufferGeometryUtils.mergeGeometries(parts);

  // Анаморфное сжатие. Сечение тела на расстоянии wz от стены должно
  // иметь масштаб k = (L - wz) / L относительно оси лампы (0,0) —
  // тогда оно ровно заполняет лучи, проходящие через контур тени,
  // и тень на стене совпадает с заданным текстом ТОЧНО.
  const pos = merged.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = (L - (d + z)) / L;
    pos.setXYZ(i, x * k, y * k, d + z);
  }

  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.userData.wallDist = d; // нужно при экспорте STL (ориентация печати)
  return merged;
}
