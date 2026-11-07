import { useMemo } from 'react';
import { matchingProfile } from '../core/profiles';
import { runRestore } from '../features/backup/runRestore';
import { appStore, useApp } from '../state/app';

/** Pilihan profil di bilah atas: tukar cepat dengan ringkasan perubahan dan konfirmasi dulu. */
export function ProfileSwitcher() {
  const profiles = useApp((s) => s.profiles);
  const lastProfileId = useApp((s) => s.lastProfileId);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const keymap = useApp((s) => s.keymap);
  const lighting = useApp((s) => s.lighting);
  const macroBuffer = useApp((s) => s.macroBuffer);
  const encoders = useApp((s) => s.encoders);

  const current = useMemo(() => appStore.getState().exportBackup(), [keymap, lighting, macroBuffer, encoders]);
  if (profiles.length === 0) return null;

  const match = current ? matchingProfile(profiles, current) : undefined;
  const fallback = lastProfileId && profiles.some((p) => p.id === lastProfileId) ? lastProfileId : '';
  const value = match?.id ?? fallback;

  const choose = async (id: string): Promise<void> => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const out = await runRestore(JSON.stringify(p.backup), { title: `Terapkan profil "${p.name}"?`, confirmLabel: 'Terapkan' });
    if (out.applied) appStore.getState().setLastProfile(p.id);
    appStore.setState({ toast: out.applied ? `Profil "${p.name}": ${out.text}` : out.text });
  };

  return (
    <label className="switch">
      <span>Profil</span>
      <select aria-label="Profil aktif" value={value} disabled={!writable || busy} onChange={(e) => void choose(e.target.value)}>
        {value === '' && (
          <option value="" disabled>
            tanpa profil
          </option>
        )}
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {!match && p.id === value ? ' (diubah)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
