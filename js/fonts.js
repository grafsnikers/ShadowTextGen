// Загрузка TTF-шрифтов (с поддержкой кириллицы) и построение
// из текста контуров THREE.Shape для дальнейшего выдавливания.

import * as THREE from 'three';
import * as opentypeLib from 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.js';

const opentype = opentypeLib.parse ? opentypeLib : opentypeLib.default;

// Шрифты из открытого репозитория Google Fonts (отдаются CDN с CORS).
export const FONTS = [
  { id: 'ptsans', name: 'PT Sans', url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ptsans/PT_Sans-Web-Regular.ttf' },
  { id: 'roboto', name: 'Roboto', url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf' },
  { id: 'montserrat', name: 'Montserrat', url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/montserrat/Montserrat%5Bwght%5D.ttf' },
  { id: 'pacifico', name: 'Pacifico (рукописный)', url: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/pacifico/Pacifico-Regular.ttf' },
];

const cache = new Map();

// Асинхронная загрузка шрифта с кэшированием по id.
export async function loadFont(fontDef) {
  if (!cache.has(fontDef.id)) {
    const promise = (async () => {
      const res = await fetch(fontDef.url);
      if (!res.ok) {
        throw new Error(`Не удалось загрузить шрифт «${fontDef.name}» (HTTP ${res.status})`);
      }
      return opentype.parse(await res.arrayBuffer());
    })();
    // При ошибке удаляем промис из кэша, чтобы загрузку можно было повторить.
    promise.catch(() => cache.delete(fontDef.id));
    cache.set(fontDef.id, promise);
  }
  return cache.get(fontDef.id);
}

// Строит из текста набор THREE.Shape (буквы с корректными внутренними
// контурами-«дырками», например у «О», «В», «Ю»). Возвращает
// { shapes, missing } — фигуры и список символов без глифов в шрифте.
export function buildTextShapes(font, text, size, letterSpacing = 0) {
  const scale = size / font.unitsPerEm;
  let x = 0;
  const contours = [];
  const missing = new Set();

  const chars = String(text).replace(/[\r\n\t]/g, ' ');
  for (const ch of chars) {
    if (ch === ' ') {
      x += font.unitsPerEm * 0.33 * scale + letterSpacing;
      continue;
    }
    if (font.charToGlyphIndex(ch) === 0) {
      missing.add(ch);
      continue;
    }
    const glyph = font.charToGlyph(ch);
    for (const c of splitPathToContours(glyph.getPath(x, 0, size))) {
      contours.push(c);
    }
    x += glyph.advanceWidth * scale + letterSpacing;
  }

  return { shapes: nestContours(contours), missing: [...missing] };
}

// Разбивает путь opentype.js на замкнутые контуры и превращает
// каждый в THREE.Shape. testPts — только точки на кривой (без опорных
// точек Безье), они используются для проверки вложенности контуров.
function splitPathToContours(path) {
  const contours = [];
  let shape = null;
  let testPts = null;

  const startNew = (x, y) => {
    if (shape) contours.push({ shape, testPts });
    shape = new THREE.Shape();
    testPts = [];
    shape.moveTo(x, y);
    testPts.push([x, y]);
  };

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M': startNew(cmd.x, cmd.y); break;
      case 'L':
        shape.lineTo(cmd.x, cmd.y);
        testPts.push([cmd.x, cmd.y]);
        break;
      case 'Q':
        shape.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        testPts.push([cmd.x, cmd.y]);
        break;
      case 'C':
        shape.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        testPts.push([cmd.x, cmd.y]);
        break;
      case 'Z': shape.closePath(); break;
    }
  }
  if (shape) contours.push({ shape, testPts });
  return contours;
}

// Определяет вложенность контуров: контуры нечётной глубины — «дырки»
// ближайшего охватывающего контура (внутренность «О», «А», «ё» и т.п.).
function nestContours(contours) {
  const info = contours
    .map((c) => ({ ...c, area: Math.abs(polygonArea(c.testPts)) }))
    .filter((c) => c.area > 1e-6)
    .map((c) => ({ ...c, bbox: bboxOf(c.testPts) }));

  const shapes = [];
  for (const c of info) {
    const containers = info.filter((o) => o !== c && contains(o, c));
    if (containers.length % 2 === 0) {
      // Чётная глубина — самостоятельная фигура (тело буквы).
      shapes.push(c.shape);
    } else {
      // Нечётная глубина — дырка самого маленького охватывающего контура.
      const parent = containers.reduce((a, b) => (a.area < b.area ? a : b));
      parent.shape.holes.push(c.shape);
    }
  }
  return shapes;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
  }
  return a / 2;
}

function bboxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// Находится ли контур c внутри контура o (по центроиду c).
function contains(o, c) {
  const bb = o.bbox;
  const p = centroid(c.testPts);
  if (p[0] < bb.minX || p[0] > bb.maxX || p[1] < bb.minY || p[1] > bb.maxY) {
    return false;
  }
  return pointInPolygon(p, o.testPts);
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const [px, py] of pts) { x += px; y += py; }
  return [x / pts.length, y / pts.length];
}

function pointInPolygon([px, py], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
