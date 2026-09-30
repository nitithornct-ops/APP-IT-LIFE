interface DocumentRulerProps {
  left: number;
  right: number;
  disabled: boolean;
  onIndent: (side: 'left' | 'right', value: number) => void;
}

export function DocumentRuler({ left, right, disabled, onIndent }: DocumentRulerProps) {
  return <div className="document-ruler" aria-label="ไม้บรรทัดหน่วยเซนติเมตร" data-print-hide>
    <div className="document-ruler-ticks" aria-hidden="true">
      {Array.from({ length: 22 }, (_, index) => <span key={index} style={{ left: `${index * 10}mm` }}>{index}</span>)}
    </div>
    <label className="document-ruler-control">เยื้องซ้าย
      <input type="range" aria-label="เยื้องย่อหน้าซ้าย (มม.)" min="0" max="170" step="1" value={left} disabled={disabled}
        onChange={event => onIndent('left', Math.min(150 - right, Number(event.target.value)))} />
      <output>{left / 10} ซม.</output>
    </label>
    <label className="document-ruler-control">เยื้องขวา
      <input type="range" aria-label="เยื้องย่อหน้าขวา (มม.)" min="0" max="170" step="1" value={right} disabled={disabled} dir="rtl"
        onChange={event => onIndent('right', Math.min(150 - left, Number(event.target.value)))} />
      <output>{right / 10} ซม.</output>
    </label>
  </div>;
}
