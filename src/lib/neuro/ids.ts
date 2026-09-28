/** Local identifier for records created in the browser (not a patient ID). */
export const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
