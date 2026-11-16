export interface Settings {
  maxGroups: number;
  defaultGroupQuotaBytes: number;
  userMonthlyQuotaBytes: number;
  matchThreshold: number;
  maxFileBytes: number;
}

const SETTING_KEYS = {
  maxGroups: "max_groups",
  defaultGroupQuotaBytes: "default_group_quota_bytes",
  userMonthlyQuotaBytes: "user_monthly_quota_bytes",
  matchThreshold: "match_threshold",
  maxFileBytes: "max_file_bytes",
} as const satisfies Record<keyof Settings, string>;

type SettingKey = (typeof SETTING_KEYS)[keyof Settings];

export const settingSql = (key: SettingKey) =>
  `(SELECT CAST(value AS REAL) FROM settings WHERE key = '${key}')`;

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const stored = new Map(results.map((row) => [row.key, Number(row.value)]));
  const read = (name: keyof Settings) => {
    const value = stored.get(SETTING_KEYS[name]);
    if (value === undefined) throw new Error(`setting ${SETTING_KEYS[name]} is missing`);
    return value;
  };
  return {
    maxGroups: read("maxGroups"),
    defaultGroupQuotaBytes: read("defaultGroupQuotaBytes"),
    userMonthlyQuotaBytes: read("userMonthlyQuotaBytes"),
    matchThreshold: read("matchThreshold"),
    maxFileBytes: read("maxFileBytes"),
  };
}

export async function saveSettings(db: D1Database, patch: Partial<Settings>): Promise<void> {
  const updates = Object.entries(patch).map(([name, value]) =>
    db.prepare("UPDATE settings SET value = ?1 WHERE key = ?2").bind(String(value), SETTING_KEYS[name as keyof Settings]),
  );
  if (updates.length > 0) await db.batch(updates);
}
