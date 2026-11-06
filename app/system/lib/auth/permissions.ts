// Central permission list (decided in Phase 0):
//   * admin may do EVERYTHING, whether or not an action is listed here.
//   * each action lists the OTHER roles that may also perform it.
// To give farmers a new right, add 'farmer' to that action's list. That's all.
// Ownership (a farmer only touching their own farms) is checked separately in
// lib/auth/access.ts, so "farmer can do X" always means "on their own data".

export const ROLES = ["admin", "farmer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  // Own account
  "user.updateSelf": ["farmer"],
  "user.deleteSelf": ["farmer"],
  "user.list": [], // admin only

  // Farms and fields
  "farm.read": ["farmer"],
  "farm.create": ["farmer"],
  "farm.update": ["farmer"],
  "farm.delete": ["farmer"],
  "field.create": ["farmer"],
  "field.update": ["farmer"],
  "field.delete": ["farmer"],

  // Crops: the catalog is fixed to the 8 crops the model knows, so it is read-only
  "crop.read": ["farmer"],

  // Plantings and growth stage records
  "planting.create": ["farmer"],
  "planting.update": ["farmer"],
  "planting.delete": ["farmer"],
  "growth.create": ["farmer"],
  "growth.update": ["farmer"],
  "growth.delete": ["farmer"],

  // Soil readings
  "reading.create": ["farmer"],
  "reading.update": ["farmer"],
  "reading.delete": ["farmer"],

  // Weather
  "weather.refresh": ["farmer"],
  "weather.manual": ["farmer"],
  "weather.delete": ["farmer"],

  // Water (all go through the SQL functions)
  "water.initial": ["farmer"],
  "water.refill": ["farmer"],
  "water.irrigate": ["farmer"],
  "water.editEntry": ["farmer"],
  "water.undo": ["farmer"],
  "allocation.set": ["farmer"],
  "irrigation.editNotes": ["farmer"],

  // Predictions
  "prediction.create": ["farmer"],
  "prediction.delete": ["farmer"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Can this role perform this action? Admin always can. */
export function can(role: Role, permission: Permission): boolean {
  if (role === "admin") return true;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Roles stored as free text in users.user_role are narrowed here; unknown → least privilege. */
export function toRole(value: string): Role {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : "farmer";
}
