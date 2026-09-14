export type CarId = 'apex' | 'shadow' | 'volt' | 'inferno';
export type TrackId =
  | 'classic' | 'grandprix' | 'karting' | 'street'
  | 'rally' | 'oval' | 'island' | 'snow' | 'desert';
export type ThemeId = 'golf' | 'f1' | 'city' | 'jungle' | 'snow' | 'desert';
export type LayoutId = 'classic' | 'grandprix' | 'karting' | 'street' | 'rally' | 'oval' | 'island';

export type CarDef = {
  name: string;
  style: CarId;
  color: [number, number, number];
  coins: number;
  maxSpeed: number;
  model: string;
};

export type TrackDef = {
  name: string;
  coins: number;
  laps: number;
  difficulty: string;
  subtitle: string;
  theme: ThemeId;
  layout: LayoutId;
};

export const GARAGE_CARS: Record<CarId, CarDef> = {
  apex: { name: 'APEX R', style: 'apex', color: [1, 0.12, 0.08], coins: 0, maxSpeed: 70, model: 'models/apex.glb' },
  shadow: { name: 'SHADOW GT', style: 'shadow', color: [0.14, 0.15, 0.18], coins: 1000, maxSpeed: 78, model: 'models/shadow.glb' },
  volt: { name: 'VOLT X', style: 'volt', color: [0.91, 0.93, 0.96], coins: 1800, maxSpeed: 86, model: 'models/volt.glb' },
  inferno: { name: 'INFERNO S', style: 'inferno', color: [0.83, 0.09, 0.12], coins: 3000, maxSpeed: 96, model: 'models/inferno.glb' }
};

export const TRACKS: Record<TrackId, TrackDef> = {
  classic: { name: 'GOLF CLUB CIRCUIT', coins: 0, laps: 2, difficulty: 'Medium', subtitle: 'Free · 2-Lap Country Club · Golf Course', theme: 'golf', layout: 'classic' },
  grandprix: { name: 'F1 GRAND PRIX', coins: 500, laps: 3, difficulty: 'Hard', subtitle: '500 coins · 3-Lap Formula Circuit', theme: 'f1', layout: 'grandprix' },
  karting: { name: 'KARTING CIRCUIT', coins: 900, laps: 4, difficulty: 'Hard', subtitle: '900 coins · 4-Lap Technical · Karting', theme: 'golf', layout: 'karting' },
  street: { name: 'CITY STREETS', coins: 1400, laps: 3, difficulty: 'Hard', subtitle: '1,400 coins · 3-Lap Downtown', theme: 'city', layout: 'street' },
  rally: { name: 'JUNGLE TRAIL', coins: 2000, laps: 2, difficulty: 'Medium', subtitle: '2,000 coins · 2-Lap Rainforest', theme: 'jungle', layout: 'rally' },
  oval: { name: 'HIGH-SPEED OVAL', coins: 2600, laps: 5, difficulty: 'Easy', subtitle: '2,600 coins · 5-Lap Speedway', theme: 'f1', layout: 'oval' },
  island: { name: 'JUNGLE ISLAND', coins: 3200, laps: 3, difficulty: 'Medium', subtitle: '3,200 coins · 3-Lap Canopy Circuit', theme: 'jungle', layout: 'island' },
  snow: { name: 'SNOW CIRCUIT', coins: 4000, laps: 3, difficulty: 'Hard', subtitle: '4,000 coins · 3-Lap Icy Classic', theme: 'snow', layout: 'classic' },
  desert: { name: 'DESERT CIRCUIT', coins: 5000, laps: 2, difficulty: 'Easy', subtitle: '5,000 coins · 2-Lap Sandy Classic', theme: 'desert', layout: 'classic' }
};

export const TRACK_LAYOUTS: Record<LayoutId, { roadW: number; pts: [number, number, number][] }> = {
  classic: {
    roadW: 22,
    pts: [
      [0, 0, -168], [40, 0, -168], [82, 0, -166], [118, 0, -154],
      [142, 0, -128], [150, 0, -92], [146, 0, -56], [128, 0, -28],
      [96, 0, -10], [58, 0, 2], [36, 0, 24], [44, 0, 52],
      [28, 0, 78], [4, 0, 96], [-28, 0, 108], [-62, 0, 104],
      [-88, 0, 82], [-102, 0, 50], [-108, 0, 14], [-116, 0, -22],
      [-108, 0, -58], [-86, 0, -88], [-54, 0, -118], [-22, 0, -150]
    ]
  },
  grandprix: {
    roadW: 20,
    pts: [
      [0, 0, -190], [50, 0, -190], [110, 0, -188], [160, 0, -170],
      [188, 0, -130], [196, 0, -70], [188, 0, -10], [160, 0, 36],
      [118, 0, 64], [70, 0, 78], [28, 0, 70], [4, 0, 96],
      [-20, 0, 128], [-58, 0, 150], [-108, 0, 152], [-150, 0, 128],
      [-172, 0, 80], [-168, 0, 28], [-140, 0, -8], [-150, 0, -48],
      [-138, 0, -92], [-100, 0, -128], [-50, 0, -162], [-16, 0, -182]
    ]
  },
  karting: {
    roadW: 11,
    pts: [
      [0, 0, -88], [28, 0, -88], [52, 0, -78], [64, 0, -52],
      [58, 0, -24], [72, 0, 0], [64, 0, 26], [40, 0, 42],
      [16, 0, 50], [4, 0, 70], [-20, 0, 82], [-48, 0, 74],
      [-66, 0, 48], [-60, 0, 18], [-72, 0, -8], [-58, 0, -34],
      [-36, 0, -52], [-10, 0, -70], [8, 0, -80]
    ]
  },
  street: {
    roadW: 20,
    pts: [
      [-16, 0, -156], [36, 0, -156], [88, 0, -156], [118, 0, -150],
      [128, 0, -132], [128, 0, -86], [128, 0, -40], [122, 0, -12],
      [96, 0, 2], [78, 0, 18], [78, 0, 52], [86, 0, 78],
      [118, 0, 90], [128, 0, 110], [128, 0, 142], [110, 0, 154],
      [64, 0, 158], [16, 0, 158], [-28, 0, 154], [-56, 0, 138],
      [-64, 0, 104], [-64, 0, 62], [-86, 0, 40], [-122, 0, 28],
      [-130, 0, 0], [-130, 0, -48], [-130, 0, -100], [-122, 0, -138],
      [-88, 0, -154], [-48, 0, -156]
    ]
  },
  rally: {
    roadW: 13,
    pts: [
      [0, 0, -150], [42, 0, -146], [86, 0, -128], [112, 0, -90],
      [104, 0, -48], [124, 0, -12], [108, 0, 28], [70, 0, 54],
      [28, 0, 78], [6, 0, 110], [-32, 0, 128], [-78, 0, 118],
      [-112, 0, 84], [-124, 0, 36], [-104, 0, -4], [-118, 0, -44],
      [-92, 0, -82], [-48, 0, -112], [-16, 0, -136]
    ]
  },
  oval: {
    roadW: 26,
    pts: [
      [0, 0, -118], [48, 0, -116], [92, 0, -100], [122, 0, -66],
      [136, 0, -20], [136, 0, 24], [122, 0, 70], [92, 0, 104],
      [48, 0, 118], [0, 0, 120], [-48, 0, 118], [-92, 0, 104],
      [-122, 0, 70], [-136, 0, 24], [-136, 0, -20], [-122, 0, -66],
      [-92, 0, -100], [-48, 0, -116]
    ]
  },
  island: {
    roadW: 15,
    pts: [
      [16, 0, -148], [64, 0, -136], [108, 0, -104], [132, 0, -56],
      [136, 0, -4], [120, 0, 44], [86, 0, 84], [40, 0, 112],
      [-8, 0, 124], [-56, 0, 116], [-98, 0, 86], [-126, 0, 40],
      [-132, 0, -12], [-112, 0, -60], [-74, 0, -100], [-28, 0, -132]
    ]
  }
};

export const REWARD_BY_PLACE: Record<number, number> = { 1: 120, 2: 75, 3: 45 };
export const AI_COLORS: [number, number, number][] = [
  [0.1, 0.31, 0.84], [1, 0.8, 0], [0.12, 0.68, 0.36],
  [0.71, 0.17, 1], [0, 0.74, 0.83], [1, 1, 1]
];
export const NAMES = ['YOU', 'RIVAL 1', 'RIVAL 2', 'RIVAL 3', 'RIVAL 4', 'RIVAL 5', 'RIVAL 6'];

export const COIN_KEY = 'forzaLegendsCoins';
export const OWNED_CARS_KEY = 'forzaLegendsOwnedCars';
export const OWNED_TRACKS_KEY = 'forzaLegendsOwnedTracks';
export const REMOVE_ADS_KEY = 'forzaLegendsRemoveAds';
export const DAILY_KEY = 'forzaLegendsDailyReward';
export const SETTINGS_KEY = 'forzaLegendsSettings';
export const PLAYER_NAME_KEY = 'forzaLegendsPlayerName';
export const RACE_HISTORY_KEY = 'forzaLegendsRaceHistory';
export const TEST_COINS = 1_000_000;

export type RaceHistoryEntry = {
  name: string;
  place: number;
  time: number;
  track: string;
  car: string;
  reward: number;
  at: number;
};

export function loadCoins(): number {
  try {
    const coins = Number(localStorage.getItem(COIN_KEY));
    const current = Number.isFinite(coins) && coins >= 0 ? Math.floor(coins) : 0;
    return Math.max(current, TEST_COINS);
  } catch {
    return TEST_COINS;
  }
}

export function saveCoins(value: number): void {
  try { localStorage.setItem(COIN_KEY, String(value)); } catch { /* ignore */ }
}

export function loadSet(key: string, fallback: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list) && list.length) return new Set(list);
  } catch { /* ignore */ }
  return new Set(fallback);
}

export function saveSet(key: string, set: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function loadBool(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function saveBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
}

export function loadPlayerName(): string {
  try {
    const name = (localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
    return name.slice(0, 16);
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 16);
  try { localStorage.setItem(PLAYER_NAME_KEY, clean); } catch { /* ignore */ }
}

export function loadRaceHistory(): RaceHistoryEntry[] {
  try {
    const raw = localStorage.getItem(RACE_HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e.name === 'string').slice(0, 40);
  } catch {
    return [];
  }
}

export function saveRaceHistory(entries: RaceHistoryEntry[]): void {
  try {
    localStorage.setItem(RACE_HISTORY_KEY, JSON.stringify(entries.slice(0, 40)));
  } catch { /* ignore */ }
}

export function pushRaceHistory(entry: RaceHistoryEntry): RaceHistoryEntry[] {
  const next = [entry, ...loadRaceHistory()].slice(0, 40);
  saveRaceHistory(next);
  return next;
}
