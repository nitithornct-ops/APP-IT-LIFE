import type { TicketRatingCriterion, TicketRatingDetails, TicketRatingKey } from '@itlife/shared';
import { cn } from '../../utils/cn';

const levelLabels: Record<number, string> = {
  1: 'ควรปรับปรุง',
  2: 'พอใช้',
  3: 'ดี',
  4: 'ดีมาก',
  5: 'ยอดเยี่ยม',
};

export function TicketRatingFields({
  criteria,
  scores,
  onChange,
  compact = false,
}: {
  criteria: TicketRatingCriterion[];
  scores: Partial<TicketRatingDetails>;
  onChange: (key: TicketRatingKey, value: number) => void;
  compact?: boolean;
}) {
  const completed = criteria.filter((criterion) => scores[criterion.key] !== undefined).length;

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-700 dark:text-slate-200">ให้คะแนนแต่ละหัวข้อ 1–5</legend>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500" aria-label="คำอธิบายระดับคะแนน">
        {Object.entries(levelLabels).map(([value, label]) => <span key={value}><b>{value}</b> {label}</span>)}
      </div>
      <div className={cn('mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700', compact && 'mt-3')}>
        {criteria.map((criterion, index) => {
          const selected = scores[criterion.key];
          return (
            <div key={criterion.key} className={cn('grid gap-2 p-3 sm:grid-cols-[minmax(190px,1fr)_auto] sm:items-center', compact && 'p-2')}>
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200"><span className="mr-1 text-slate-400">{index + 1}.</span>{criterion.label}</p>
                {criterion.description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{criterion.description}</p>}
                <p className="text-xs font-medium text-primary-600 dark:text-primary-300" aria-live="polite">
                  {selected === undefined ? 'ยังไม่ได้ให้คะแนน' : `${selected}/5 · ${levelLabels[selected]}`}
                </p>
              </div>
              <div role="radiogroup" aria-label={criterion.label} className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected === value}
                    aria-label={`${criterion.label} ${value} คะแนน ${levelLabels[value]}`}
                    title={`${value} คะแนน — ${levelLabels[value]}`}
                    onClick={() => onChange(criterion.key, value)}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-extrabold transition focus-visible:outline-none',
                      selected === value
                        ? 'border-amber-500 bg-amber-400 text-amber-950 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-amber-300 hover:bg-amber-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-amber-900/20',
                      compact && 'h-8 w-8 text-xs',
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs font-semibold text-slate-500">ให้คะแนนแล้ว {completed}/{criteria.length} หัวข้อ</p>
    </fieldset>
  );
}
