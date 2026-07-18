import type { SeasonCatalog, SeasonWindow } from './types.js';
import { shiftAirDate } from './broadcast-schedule.js';

const ACGSECRETS_BASE_URL = 'https://acgsecrets.hk/bangumi';

export function seasonKeyForDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}Q${Math.floor((Number(values.month) - 1) / 3) + 1}`;
}

export function previousSeasonKey(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  const previousQuarter = Number(quarter) - 1;
  return previousQuarter ? `${year}Q${previousQuarter}` : `${Number(year) - 1}Q4`;
}

export function acgSecretsUrlForSeason(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  const month = (Number(quarter) - 1) * 3 + 1;
  return `${ACGSECRETS_BASE_URL}/${year}${String(month).padStart(2, '0')}/`;
}

export function buildSeasonWindow(today: string, current: SeasonCatalog, previous: SeasonCatalog): SeasonWindow {
  const normalDates = [...current.entries.values()]
    .filter((item) => item.seasonKind === 'new' && isValidDateString(item.normalPremiereDate))
    .map((item) => item.normalPremiereDate)
    .sort();
  const anchorDate = normalDates[0] ?? firstDateOfSeason(current.seasonKey);
  const overlapThrough = shiftAirDate(anchorDate, 13);
  const overlapActive = today <= overlapThrough;
  const entries = new Map(current.entries);

  if (overlapActive) {
    for (const [subjectId, entry] of previous.entries) {
      if (!entries.has(subjectId)) entries.set(subjectId, entry);
    }
  }

  return {
    currentSeasonKey: current.seasonKey,
    previousSeasonKey: previous.seasonKey,
    anchorDate,
    overlapThrough,
    authoritative: current.available !== false && (!overlapActive || previous.available !== false),
    activeSubjectIds: new Set(entries.keys()),
    entries
  };
}

function firstDateOfSeason(seasonKey: string): string {
  const [, year, quarter] = seasonKey.match(/^(\d{4})Q([1-4])$/) ?? [];
  const month = (Number(quarter) - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
