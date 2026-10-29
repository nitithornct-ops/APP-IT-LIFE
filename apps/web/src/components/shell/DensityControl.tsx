import { DENSITIES, setDensity, useDensity, type Density } from '../../stores/density';

const labels: Record<Density, string> = {
  compact: 'กระชับ', standard: 'มาตรฐาน', comfortable: 'อ่านสบาย',
};

export function DensityControl({ mobile = false }: { mobile?: boolean }) {
  const density = useDensity();
  return (
    <label className={mobile ? 'density-control flex items-center justify-between gap-2' : 'density-control hidden items-center gap-2 xl:flex'}>
      <span className={mobile ? 'text-sm' : 'sr-only'}>ความหนาแน่นข้อมูล</span>
      <select aria-label="ความหนาแน่นข้อมูล" value={density} onChange={event => setDensity(event.target.value as Density)}
        className="max-w-32 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text-secondary)]">
        {DENSITIES.map(value => <option key={value} value={value}>{labels[value]}</option>)}
      </select>
    </label>
  );
}
