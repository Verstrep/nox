/** Formatage des valeurs affichees dans l'interface. */

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: Date): string {
  return DATE_TIME_FORMATTER.format(value);
}

/** Formate une date ISO recue du runner. Retourne `null` si elle est illisible. */
export function formatIsoDateTime(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_TIME_FORMATTER.format(date);
}

const BYTE_UNITS = ["o", "Ko", "Mo"] as const;

/** Taille lisible, avec les unites binaires usuelles. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return "-";
  }

  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  // Les octets restent entiers ; au-dela, une decimale suffit a situer l'ordre
  // de grandeur sans encombrer la liste.
  const rounded = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unitIndex] ?? "o"}`;
}
