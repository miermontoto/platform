// validación de los assets exportados contra specs.mjs: tamaño aceptado por la tienda, sin alpha,
// png al día con el manifiesto, máximo por slot e idioma, slots obligatorios y contenido clave
// ([data-safe]) dentro de la safe area de los creative. devuelve incidencias, no lanza.
import { open } from 'node:fs/promises';
import { STORE, classify, safeRect } from './specs.mjs';

const PNG_SIGNATURE = '89504e470d0a1a0a';
// cabecera leída: ihdr + chunks previos al primer idat (ahí va trns si lo hay)
const HEAD_BYTES = 64 * 1024;
const CHUNK_OVERHEAD = 12;
// color types png con canal alpha: gris+alpha y rgba
const ALPHA_COLOR_TYPES = new Set([4, 6]);
const SAFE_TOLERANCE_PX = 0.5;

const error = (path, msg) => ({ level: 'error', path, msg });
const warn = (path, msg) => ({ level: 'warn', path, msg });

// tamaño y transparencia de un png leyendo solo su cabecera
const readPng = async (file) => {
  const fh = await open(file);
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    const b = buffer.subarray(0, bytesRead);
    if (b.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) throw new Error('no es un png');
    const types = [];
    for (let at = 8; at + 8 <= b.length && types.at(-1) !== 'IDAT'; at += CHUNK_OVERHEAD + b.readUInt32BE(at)) {
      types.push(b.toString('latin1', at + 4, at + 8));
    }
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: ALPHA_COLOR_TYPES.has(b[25]) || types.includes('tRNS') };
  } finally {
    await fh.close();
  }
};

// un asset: el png en disco frente al manifiesto y la spec. job = { path, w, h, scale, lang, variant }
export const checkFile = async (job, file) => {
  const want = [Math.round(job.w * job.scale), Math.round(job.h * job.scale)];
  const png = await readPng(file).catch((e) => ({ fail: e.message }));
  if (png.fail) return { issues: [error(job.path, `ilegible: ${png.fail}`)] };
  const hit = classify(job.path, png.w, png.h);
  const issues = [
    // convención de carpetas: <tienda>/<idioma>/<slot>/…
    job.path.split('/')[1] !== job.lang && warn(job.path, `fuera de su carpeta de idioma (${job.lang}/)`),
    (png.w !== want[0] || png.h !== want[1]) && error(job.path, `mide ${png.w}x${png.h} y el manifiesto espera ${want.join('x')} (¿export viejo?)`),
    !hit && warn(job.path, 'carpeta sin spec de tienda: no se valida'),
    hit && !hit.slot && error(job.path, `${png.w}x${png.h} no es un tamaño que acepte ${hit.store}`),
    hit && png.alpha && !hit.spec.alpha && error(job.path, 'tiene canal alpha o transparencia (la tienda lo rechaza)'),
  ].filter(Boolean);
  return { issues, ...hit };
};

// contenido clave del creative ([data-safe], rects en px css) dentro de la safe area del slot
export const checkSafe = (job, slot, rects) => {
  const safe = safeRect(slot, Math.round(job.w * job.scale), job.scale);
  if (!safe) return [];
  if (!rects.length) return [warn(job.path, 'creative sin elementos [data-safe]: la safe area no se comprueba')];
  const out = (r) => r.left < safe.left - SAFE_TOLERANCE_PX || r.top < safe.top - SAFE_TOLERANCE_PX || r.right > safe.right + SAFE_TOLERANCE_PX || r.bottom > safe.bottom + SAFE_TOLERANCE_PX;
  const box = (r) => [r.left, r.top, r.right, r.bottom].map(Math.round).join(',');
  return rects.filter(out).map((r) => error(job.path, `"${r.name}" (${box(r)}) se sale de la safe area (${box(safe)}) del ${slot.label}`));
};

// el conjunto: máximo por slot (app store) o tipo de dispositivo (play) e idioma + obligatorios.
// entries = [{ job, store, spec, slot }] (lo que devuelve checkFile + su job)
export const checkSet = (entries) => {
  const valid = entries.filter((e) => e.slot);
  const groups = Object.groupBy(valid, (e) => `${e.store}|${e.job.lang}|${e.store === STORE.APP ? e.slot.id : e.job.variant}`);
  const over = Object.values(groups)
    .filter((g) => g.length > g[0].spec.maxPerSlot)
    .map((g) => error(`${g[0].store}/ (${g[0].job.lang})`, `${g.length} assets para ${g[0].slot.label}: máximo ${g[0].spec.maxPerSlot}`));
  const byLang = Object.groupBy(valid, (e) => `${e.store}|${e.job.lang}`);
  const missing = Object.values(byLang).flatMap((g) => {
    const ids = new Set(g.map((e) => e.slot.id));
    return g[0].spec.slots
      .filter((s) => s.requiredWith && !ids.has(s.id) && [...ids].some((id) => id.startsWith(s.requiredWith)))
      .map((s) => error(`${g[0].store}/ (${g[0].job.lang})`, `falta ${s.label}: obligatorio con capturas de ${s.requiredWith}`));
  });
  return [...over, ...missing];
};
