import React, { ChangeEvent, useEffect, useId, useState } from 'react';
import { Alert, Field, InlineSwitch, Input, RadioButtonGroup, Select, Stack, useStyles2 } from '@grafana/ui';
import type { QueryEditorProps, SelectableValue } from '@grafana/data';
import { DataSource } from '../datasource';
import { O2DataSourceOptions, O2Query, O2QueryType } from '../types';
import { QuerySearchEditor } from './QuerySearchEditor';
import { FieldLabel, getQueryEditorStyles } from './QueryEditorStyles';

type Props = QueryEditorProps<DataSource, O2Query, O2DataSourceOptions>;

const QUERY_TYPES: Array<SelectableValue<O2QueryType>> = [
  { label: 'Search', value: 'search' },
  { label: 'Trace ID', value: 'traceId' },
];

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const queryType: O2QueryType = query.queryType ?? 'search';
  const idPrefix = `query-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const styles = useStyles2(getQueryEditorStyles);
  const [streamOptions, setStreamOptions] = useState<Array<SelectableValue<string>>>([]);
  const [streamError, setStreamError] = useState<string>();
  const [streamLoading, setStreamLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const request = Promise.resolve().then(() => {
      if (!active) {
        return undefined;
      }
      setStreamLoading(true);
      setStreamError(undefined);
      return datasource.getStreams();
    });
    request
      .then((streams) => {
        if (active && streams) {
          setStreamOptions(streams.map((s) => ({ label: s, value: s })));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setStreamOptions([]);
          setStreamError(error instanceof Error && error.message ? error.message : 'Stream discovery failed.');
        }
      })
      .finally(() => {
        if (active) {
          setStreamLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [datasource]);

  const onField = <K extends keyof O2Query>(key: K, value: O2Query[K]) => {
    onChange({ ...query, [key]: value });
  };

  const streamSelector = (
    <Field
      className={styles.field}
      label={
        <FieldLabel label="Stream" tooltip="Trace stream to query (defaults to the datasource's default stream)." />
      }
      htmlFor={`${idPrefix}-stream`}
    >
      <Select
        className={styles.control}
        aria-label="Stream"
        inputId={`${idPrefix}-stream`}
        isClearable
        allowCustomValue
        isLoading={streamLoading}
        placeholder="default stream"
        options={streamOptions}
        value={query.stream ?? null}
        onChange={(v) => onField('stream', v?.value)}
      />
    </Field>
  );

  return (
    <div className={styles.root}>
      <Stack direction="column" gap={1} width="100%" minWidth={0} maxWidth="100%">
        <RadioButtonGroup
          id={`${idPrefix}-query-type`}
          options={QUERY_TYPES}
          value={queryType}
          onChange={(v) => onChange({ ...query, queryType: v })}
          size="md"
          aria-label="Query type"
        />

        {streamError && (
          <Alert title="Unable to load streams" severity="error" aria-live="assertive">
            {streamError}
          </Alert>
        )}

        {queryType === 'traceId' ? (
          <>
            <div className={styles.grid} data-testid="query-trace-fields">
              <Field
                className={`${styles.field} ${styles.wide}`}
                label={<FieldLabel label="Trace ID" tooltip="The 32-character hexadecimal trace id to display." />}
                htmlFor={`${idPrefix}-trace-id`}
              >
                <Input
                  className={styles.control}
                  aria-label="Trace ID"
                  id={`${idPrefix}-trace-id`}
                  value={query.traceId ?? ''}
                  placeholder="e.g. 0af7651916cd43dd8448eb211c80319c"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => onField('traceId', e.target.value)}
                  onBlur={onRunQuery}
                  onKeyDown={(e) => e.key === 'Enter' && onRunQuery()}
                />
              </Field>
            </div>
            <div className={styles.grid} data-testid="query-trace-options">
              {streamSelector}
              <Field className={styles.field} label="Node graph" htmlFor={`${idPrefix}-node-graph`}>
                <InlineSwitch
                  id={`${idPrefix}-node-graph`}
                  aria-label="Node graph"
                  value={!!query.nodeGraph}
                  onChange={(e) => onField('nodeGraph', e.currentTarget.checked)}
                />
              </Field>
            </div>
          </>
        ) : (
          <QuerySearchEditor
            query={query}
            onChange={onChange}
            onRunQuery={onRunQuery}
            streamSelector={streamSelector}
            idPrefix={idPrefix}
            styles={styles}
          />
        )}
      </Stack>
    </div>
  );
}
