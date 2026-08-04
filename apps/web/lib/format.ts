/** Formatage des dates affichees dans l'interface. */

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: Date): string {
  return DATE_TIME_FORMATTER.format(value);
}
