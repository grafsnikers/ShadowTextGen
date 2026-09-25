// Построение единой геометрии модели светильника:
// выдавленные буквы + соединительные планки (чтобы модель печаталась
// одной деталью). Все размеры — в миллиметрах.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// shapes — массив THREE.Shape (результат buildTextShapes).
// opts: depth (мм), barThickness (мм), bottomBar (bool), frame (bool), margin (мм).
export function buildModelGeometry(shapes, opts) {
  const {
    depth = 5,
    barThickness = 4,
    bottomBar = true,
    frame = false,
    margin = 8,
  } = opts;

  // Выдавливаем буквы. ExtrudeGeometry — неиндексированная геометрия,
  // поэтому боксы тоже приводим к неиндексированным перед слиянием.
  const letterGeoms = shapes.map(
    (s) => new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 })
  );
  if (letterGeoms.length === 0) return null;

  const letters = BufferGeometryUtils.mergeGeometries(letterGeoms);
  letters.computeBoundingBox();
  const bb = letters.boundingBox;
  const minX = bb.min.x, maxX = bb.max.x;
  const minY = bb.min.y, maxY = bb.max.y;

  const parts = [letters];
  const addBar = (cx, cy, w, h) => {
    const g = new THREE.BoxGeometry(w, h, depth).toNonIndexed();
    g.translate(cx, cy, depth / 2);
    parts.push(g);
  };

  const width = maxX - minX + margin * 2;
  const cx = (minX + maxX) / 2;
  const left = minX - margin;
  const right = maxX + margin;

  // Нижняя планка: верхняя кромка чуть выше базовой линии (y = 0),
  // чтобы перекрыться с нижними точками букв и слиться в одно тело.
  if (bottomBar) {
    const top = 0.5;
    const bottom = Math.min(-barThickness, minY - 2);
    addBar(cx, (top + bottom) / 2, width, top - bottom);
  }

  // Полная рамка: верхняя перекладина и боковые стойки.
  if (frame) {
    const fBottom = Math.min(-barThickness, minY - 2);
    const fTop = maxY + barThickness;
    addBar(cx, (maxY + fTop) / 2, width, barThickness);
    addBar(left, (fBottom + fTop) / 2, barThickness, fTop - fBottom);
    addBar(right, (fBottom + fTop) / 2, barThickness, fTop - fBottom);
  }

  const merged = BufferGeometryUtils.mergeGeometries(parts);
  merged.computeBoundingBox();
  const b = merged.boundingBox;
  // Центрируем модель по всем осям — удобно и для сцены, и для STL.
  merged.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -depth / 2);
  merged.computeBoundingBox();
  return merged;
}
