import { useEffect, useState } from 'react';
import { getGateHints } from '../api';
import type { CheckHint, Finding } from '../types';

/** Gate findings with a plain-language "how to fix" for each check. */
export function Findings({ findings }: { findings: Finding[] }) {
  const [hints, setHints] = useState<Record<string, CheckHint>>({});
  useEffect(() => { let live = true; getGateHints().then((h) => { if (live) setHints(h && typeof h === 'object' ? h : {}); }); return () => { live = false; }; }, []);
  return (
    <ul className="findings">
      {findings.map((f, i) => {
        const hint = hints[f.check];
        return (
          <li key={i}>
            <span className={`sev-${f.severity}`}>{f.severity}</span> <code>{f.check}</code>{f.message ? ` — ${f.message}` : ''}{f.location ? ` (${f.location})` : ''}
            {hint && <div className="hint"><strong>{hint.title}.</strong> {hint.fix}</div>}
          </li>
        );
      })}
    </ul>
  );
}
