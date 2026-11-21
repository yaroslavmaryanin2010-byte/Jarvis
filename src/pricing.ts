import type { Env } from "./types";
import { getSetting } from "./db";

// Тарифы хранятся в настройках (Настройки → Тарифы). Значения вносите те же, что в калькуляторе.
export interface Rates {
  filament_per_kg: Record<string, number>; // цена кг пластика по типам: {"PLA": ..., "PETG": ...}
  kwh_day: number;
  kwh_night: number;
  night_share: number;      // доля печати в ночном тарифе, 0..1
  printer_watts: number;    // средняя мощность при печати
  wear_per_hour: number;    // износ и амортизация, за час
  margin: number;           // множитель (например, 2 = наценка 100%)
  min_price: number;
}

export async function calcPrice(env: Env, a: { grams: number; hours: number; filament: string; qty?: number }): Promise<string> {
  const r = await getSetting<Rates | null>(env, "rates", null);
  const perKg = r?.filament_per_kg?.[a.filament];
  if (!r || !perKg || !r.kwh_day || !r.printer_watts) {
    return `Тарифы не заполнены для «${a.filament}». Откройте Настройки → Тарифы.`;
  }
  const qty = Math.max(1, a.qty ?? 1);
  const material = (a.grams / 1000) * perKg;
  const kwhRate = r.kwh_day * (1 - r.night_share) + r.kwh_night * r.night_share;
  const energy = (r.printer_watts / 1000) * a.hours * kwhRate;
  const wear = r.wear_per_hour * a.hours;
  const cost = material + energy + wear;
  const unit = Math.max(r.min_price, cost * r.margin);
  const fmt = (n: number) => Math.round(n * 100) / 100;
  return JSON.stringify({
    себестоимость_шт: fmt(cost), цена_клиенту_шт: fmt(unit), количество: qty, цена_клиенту_партия: fmt(unit * qty),
    состав: { пластик: fmt(material), электричество: fmt(energy), износ: fmt(wear) },
  });
}
