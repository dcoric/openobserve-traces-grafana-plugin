import React from 'react';
import { QueryEditorHelpProps } from '@grafana/data';
import { O2Query } from '../types';

export function CheatSheet(_props: QueryEditorHelpProps<O2Query>) {
  return (
    <div>
      <h2>OpenObserve Traces</h2>
      <p>Two query modes back the trace view:</p>
      <ul>
        <li>
          <strong>Search</strong> — find traces by service, span/operation name, duration, error status and attribute
          filters. Results appear as a table; click a trace id to open the full waterfall.
        </li>
        <li>
          <strong>Trace ID</strong> — fetch every span of one trace by its 32-character hexadecimal id and render the
          waterfall directly.
        </li>
      </ul>
      <p>
        Durations accept human units: <code>100us</code>, <code>1.5ms</code>, <code>2s</code>. A bare number is treated
        as microseconds (OpenObserve&apos;s native duration unit).
      </p>
    </div>
  );
}
