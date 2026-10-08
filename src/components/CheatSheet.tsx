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
          filters. Returns 50 traces by default and at most 500. If a page is full, more traces may match; narrow the
          filters or time range to see them. Click a trace id to open the full waterfall.
        </li>
        <li>
          <strong>Trace ID</strong> — enter the 32-character hexadecimal id of one trace and render its waterfall. At
          most 5,000 spans are shown. If the trace is larger, a warning is displayed. The selected time range is widened
          by five minutes on each side, so the trace must fall within that window to be found.
        </li>
      </ul>
      <p>
        Durations accept human units: <code>100us</code>, <code>1.5ms</code>, <code>2s</code>. A bare number is treated
        as microseconds (OpenObserve&apos;s native duration unit).
      </p>
    </div>
  );
}
