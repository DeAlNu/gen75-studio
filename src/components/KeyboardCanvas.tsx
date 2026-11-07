import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { PhysicalKey } from '../core/definition/types';

interface Props {
  keys: PhysicalKey[];
  width: number;
  height: number;
  label: string;
  legend?: (key: PhysicalKey) => string;
  title?: (key: PhysicalKey) => string;
  selected?: ReadonlySet<number>;
  onKeyClick?: (key: PhysicalKey, e: MouseEvent<HTMLButtonElement>) => void;
  keyClass?: (key: PhysicalKey) => string;
  showCoords?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function KeyboardCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState(44);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = (): void => setUnit(Math.max(18, Math.min(56, Math.floor((el.clientWidth - 4) / p.width))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.width]);

  const boardStyle = {
    '--u': `${unit}px`,
    width: `calc(var(--u) * ${p.width})`,
    height: `calc(var(--u) * ${p.height})`,
    ...p.style,
  } as CSSProperties;

  return (
    <div className="boardwrap" ref={wrap}>
      <div className={`board ${p.className ?? ''}`} style={boardStyle} role="group" aria-label={p.label}>
        {p.keys.map((k) => {
          const style = { '--x': k.x, '--y': k.y, '--w': k.w, '--h': k.h, background: k.color } as CSSProperties;
          const sel = p.selected?.has(k.index) ?? false;
          const cls = ['key', k.encoder !== null ? 'knob' : '', sel ? 'sel' : '', p.keyClass?.(k) ?? ''].filter(Boolean).join(' ');
          const content = (
            <>
              {p.legend?.(k)}
              {p.showCoords && (
                <small>
                  {k.row},{k.col}
                </small>
              )}
            </>
          );
          if (!p.onKeyClick) {
            return (
              <div key={k.index} className={cls} style={style}>
                {content}
              </div>
            );
          }
          return (
            <button
              key={k.index}
              type="button"
              className={cls}
              style={style}
              title={p.title?.(k)}
              aria-label={`Tombol ${k.row},${k.col}: ${p.legend?.(k) ?? ''}`}
              aria-pressed={sel}
              onClick={(e) => p.onKeyClick?.(k, e)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
