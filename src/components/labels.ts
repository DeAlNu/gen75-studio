/** Mengganti nama tombol Windows dan Alt menjadi Cmd dan Opt untuk tampilan Mac. */
export function macLabel(label: string, on: boolean): string {
  return on ? label.replace(/Win/g, 'Cmd').replace(/Alt/g, 'Opt') : label;
}
