export const STATUS_COLORS = {
  CRITICAL: "red",
  WAITING: "yellow",
  READY: "green"
} as const;

export const USER_ROLES = ["ADMIN", "LOGISTICS", "TECHNICIAN", "VALIDATOR"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DEFAULT_SETTINGS = {
  maxNearbyMinutes: 90,
  suggestionWindowDays: 3,
  costPerKm: 2.4,
  averageHotelCost: 320,
  averageCarCost: 210
};
