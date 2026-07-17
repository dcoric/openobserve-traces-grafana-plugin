import React from 'react';
import { Tooltip } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

export const getQueryEditorStyles = (theme: GrafanaTheme2) => {
  const control = css({
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    '& > *': {
      width: '100%',
      minWidth: 0,
      maxWidth: '100%',
    },
  });
  return {
    root: css({ width: '100%', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }),
    grid: css({
      display: 'grid',
      width: '100%',
      minWidth: 0,
      gap: theme.spacing(1),
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))',
    }),
    tagGrid: css({
      display: 'grid',
      width: '100%',
      minWidth: 0,
      gap: theme.spacing(1),
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
    }),
    field: css({ width: '100%', minWidth: 0, maxWidth: '100%' }),
    wide: css({ gridColumn: '1 / -1', minWidth: 0 }),
    control,
    action: css({ minWidth: 0, alignSelf: 'end', justifySelf: 'start' }),
    actionRow: css({ width: '100%', minWidth: 0 }),
  };
};

export type QueryEditorStyles = ReturnType<typeof getQueryEditorStyles>;

export function FieldLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  if (!tooltip) {
    return label;
  }
  return (
    <Tooltip content={tooltip}>
      <span>{label}</span>
    </Tooltip>
  );
}
