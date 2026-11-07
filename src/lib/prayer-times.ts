// Prayer-time anchors for the daily sabaq reminders.
//
// Uses the `adhan` library (MIT) to compute the five daily prayers. Times are
// returned as local-time Date objects. Asr always uses the standard (Shafi)
// shadow length so reminders line up with the majority of prayer calendars.

import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';
import type { CalculationParameters } from 'adhan';

export interface PrayerTimeSet {
  fajr: Date;
  dhuhr: Date;
  asr: Date;
  maghrib: Date;
  isha: Date;
}

export interface CityPreset {
  id: string;
  name: string;
  lat: number;
  lng: number;
  calcMethod: CalculationParameters;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** French UOIF-style 12 degree angles (fajr and isha). */
function parisCalculation(): CalculationParameters {
  const params = CalculationMethod.Other();
  params.fajrAngle = 12;
  params.ishaAngle = 12;
  return params;
}

/**
 * Cities offered in Settings. `custom` carries placeholder coordinates; the
 * real ones live in the settings store (customLat / customLng).
 */
export const CITY_PRESETS: CityPreset[] = [
  { id: 'makkah', name: 'Makkah', lat: 21.4225, lng: 39.8262, calcMethod: CalculationMethod.UmmAlQura() },
  { id: 'madinah', name: 'Madinah', lat: 24.4672, lng: 39.6111, calcMethod: CalculationMethod.UmmAlQura() },
  { id: 'stockholm', name: 'Stockholm', lat: 59.3293, lng: 18.0686, calcMethod: CalculationMethod.MuslimWorldLeague() },
  {
    id: 'gothenburg',
    name: 'Gothenburg',
    lat: 57.7089,
    lng: 11.9746,
    calcMethod: CalculationMethod.MuslimWorldLeague(),
  },
  { id: 'malmo', name: 'Malmo', lat: 55.604981, lng: 13.003822, calcMethod: CalculationMethod.MuslimWorldLeague() },
  { id: 'london', name: 'London', lat: 51.5074, lng: -0.1278, calcMethod: CalculationMethod.MuslimWorldLeague() },
  { id: 'berlin', name: 'Berlin', lat: 52.52, lng: 13.405, calcMethod: CalculationMethod.MuslimWorldLeague() },
  { id: 'paris', name: 'Paris', lat: 48.8566, lng: 2.3522, calcMethod: parisCalculation() },
  { id: 'istanbul', name: 'Istanbul', lat: 41.0082, lng: 28.9784, calcMethod: CalculationMethod.Turkey() },
  { id: 'cairo', name: 'Cairo', lat: 30.0444, lng: 31.2357, calcMethod: CalculationMethod.Egyptian() },
  { id: 'dubai', name: 'Dubai', lat: 25.2048, lng: 55.2708, calcMethod: CalculationMethod.Dubai() },
  { id: 'custom', name: 'Custom', lat: 0, lng: 0, calcMethod: CalculationMethod.MuslimWorldLeague() },
];

export function getCityPreset(id: string): CityPreset {
  return CITY_PRESETS.find((city) => city.id === id) ?? CITY_PRESETS[CITY_PRESETS.length - 1];
}

/** Resolve the coordinates currently selected in Settings, if any. */
export function getCityCoordinates(
  cityId: string,
  customLat: number | null,
  customLng: number | null
): GeoPoint | null {
  if (cityId === 'custom') {
    if (customLat == null || customLng == null) return null;
    if (!Number.isFinite(customLat) || !Number.isFinite(customLng)) return null;
    if (Math.abs(customLat) > 90 || Math.abs(customLng) > 180) return null;
    return { lat: customLat, lng: customLng };
  }
  const city = getCityPreset(cityId);
  return { lat: city.lat, lng: city.lng };
}

/**
 * Compute today's prayer times for a location. `method` is an adhan
 * CalculationParameters instance (e.g. CITY_PRESETS[i].calcMethod).
 */
export function getPrayerTimes(
  lat: number,
  lng: number,
  method?: CalculationParameters,
  date?: Date
): PrayerTimeSet {
  const params = method ?? CalculationMethod.MuslimWorldLeague();
  // Standard Asr (Shafi shadow length) across the app.
  params.madhab = Madhab.Shafi;

  const times = new PrayerTimes(new Coordinates(lat, lng), date ?? new Date(), params);
  return {
    fajr: times.fajr,
    dhuhr: times.dhuhr,
    asr: times.asr,
    maghrib: times.maghrib,
    isha: times.isha,
  };
}

const ANCHOR_OFFSETS: Record<'fajr' | 'asr' | 'maghrib' | 'isha', number> = {
  fajr: 20,
  asr: 30,
  maghrib: 15,
  isha: 20,
};

/**
 * Minutes after the anchor prayer at which the sabaq reminder fires.
 * Non-prayer anchors (e.g. 'fixed') return 0.
 */
export function anchorToOffset(anchor: string): number {
  if (anchor === 'fajr' || anchor === 'asr' || anchor === 'maghrib' || anchor === 'isha') {
    return ANCHOR_OFFSETS[anchor];
  }
  return 0;
}

/**
 * Convert a prayer anchor into a concrete local clock time for the given day.
 * Returns null for fixed-time slots or unusable (invalid) prayer dates.
 */
export function slotTimeForAnchor(
  anchor: string,
  times: PrayerTimeSet
): { hour: number; minute: number } | null {
  let base: Date | null = null;
  if (anchor === 'fajr') base = times.fajr;
  else if (anchor === 'asr') base = times.asr;
  else if (anchor === 'maghrib') base = times.maghrib;
  else if (anchor === 'isha') base = times.isha;

  if (!base || Number.isNaN(base.getTime())) return null;

  const shifted = new Date(base.getTime() + anchorToOffset(anchor) * 60_000);
  return { hour: shifted.getHours(), minute: shifted.getMinutes() };
}
