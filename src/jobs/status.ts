/** Transitions between these are unrestricted; only the value set is validated. */
export const STATUS_VALUES = ['new', 'shortlisted', 'applied', 'interview', 'offer', 'rejected', 'dismissed', 'withdrawn'] as const;

export type JobStatus = (typeof STATUS_VALUES)[number];

export function isValidStatus(value: string): value is JobStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}
