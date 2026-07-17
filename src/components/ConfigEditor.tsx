import React, { ChangeEvent } from 'react';
import {
  DataSourceHttpSettings,
  Field,
  FieldSet,
  Input,
  InlineSwitch,
  Select,
  Stack,
  TagsInput,
  Tooltip,
  useStyles2,
} from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import type { DataSourcePluginOptionsEditorProps, GrafanaTheme2, SelectableValue } from '@grafana/data';
import { css } from '@emotion/css';
import { O2DataSourceOptions, O2SecureJsonData, TraceToLogsOptions } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<O2DataSourceOptions, O2SecureJsonData> {}

const SHIFT_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'None', value: '0' },
  { label: '-1m', value: '-1m' },
  { label: '-5m', value: '-5m' },
  { label: '-1h', value: '-1h' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '1h', value: '1h' },
];

const getStyles = (theme: GrafanaTheme2) => {
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
    httpSettings: css({ width: '100%', minWidth: 0, maxWidth: '100%', overflowX: 'auto' }),
    section: css({ width: '100%', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }),
    grid: css({
      display: 'grid',
      width: '100%',
      minWidth: 0,
      gap: theme.spacing(1),
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
    }),
    field: css({ width: '100%', minWidth: 0, maxWidth: '100%' }),
    wide: css({ gridColumn: '1 / -1', minWidth: 0 }),
    control,
  };
};

function FieldLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  if (!tooltip) {
    return label;
  }
  return (
    <Tooltip content={tooltip}>
      <span>{label}</span>
    </Tooltip>
  );
}

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;
  const { jsonData } = options;
  const styles = useStyles2(getStyles);

  const updateJsonData = (patch: Partial<O2DataSourceOptions>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });
  };

  const updateTracesToLogs = (patch: Partial<TraceToLogsOptions>) => {
    updateJsonData({ tracesToLogsV2: { ...(jsonData.tracesToLogsV2 ?? {}), ...patch } });
  };

  const t2l = jsonData.tracesToLogsV2 ?? {};
  const logDatasourceOptions = getDataSourceSrv()
    .getList({ logs: true })
    .map<SelectableValue<string>>((dataSource) => ({ label: dataSource.name, value: dataSource.uid }));
  const selectedLogDatasource = t2l.datasourceUid
    ? (logDatasourceOptions.find((option) => option.value === t2l.datasourceUid) ?? {
        label: `${t2l.datasourceUid} (not found)`,
        value: t2l.datasourceUid,
      })
    : null;

  return (
    <div className={styles.root}>
      <Stack direction="column" gap={2} width="100%" minWidth={0} maxWidth="100%">
        <div className={styles.httpSettings} data-testid="config-http-settings">
          <DataSourceHttpSettings
            defaultUrl="http://localhost:5080"
            urlLabel="URL"
            dataSourceConfig={options}
            onChange={onOptionsChange}
            showAccessOptions={false}
          />
        </div>

        <div className={styles.section} data-testid="config-openobserve-section">
          <FieldSet label="OpenObserve">
            <div className={styles.grid}>
              <Field
                className={`${styles.field} ${styles.wide}`}
                label={
                  <FieldLabel
                    label="Organization"
                    tooltip="OpenObserve organization id used in every API path (/api/{org}/...). Defaults to 'default'."
                  />
                }
                htmlFor="config-org-id"
              >
                <Input
                  className={styles.control}
                  aria-label="Organization"
                  id="config-org-id"
                  placeholder="default"
                  value={jsonData.orgId ?? ''}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateJsonData({ orgId: e.target.value })}
                />
              </Field>

              <Field
                className={`${styles.field} ${styles.wide}`}
                label={
                  <FieldLabel
                    label="Default traces stream"
                    tooltip="Stream queried when a query does not pick one. OpenObserve's default traces stream is usually 'default'."
                  />
                }
                htmlFor="config-default-stream"
              >
                <Input
                  className={styles.control}
                  aria-label="Default traces stream"
                  id="config-default-stream"
                  placeholder="default"
                  value={jsonData.defaultStream ?? ''}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateJsonData({ defaultStream: e.target.value })}
                />
              </Field>

              <Field className={styles.field} label="Node graph" htmlFor="config-node-graph">
                <InlineSwitch
                  id="config-node-graph"
                  aria-label="Node graph"
                  value={!!jsonData.nodeGraph}
                  onChange={(e) => updateJsonData({ nodeGraph: e.currentTarget.checked })}
                />
              </Field>
            </div>
          </FieldSet>
        </div>

        <div className={styles.section} data-testid="config-trace-logs-section">
          <FieldSet label="Trace to logs">
            <div className={styles.grid}>
              <Field className={styles.field} label="Logs datasource" htmlFor="config-logs-datasource">
                <Select
                  className={styles.control}
                  aria-label="Logs datasource"
                  inputId="config-logs-datasource"
                  isClearable
                  options={logDatasourceOptions}
                  placeholder="Select a logs datasource"
                  value={selectedLogDatasource}
                  onChange={(value) => updateTracesToLogs({ datasourceUid: value?.value })}
                />
              </Field>

              <Field className={styles.field} label="Tags" htmlFor="config-logs-tags">
                <TagsInput
                  className={styles.control}
                  id="config-logs-tags"
                  tags={(t2l.tags ?? []).map((tag) => tag.key)}
                  onChange={(tags) => updateTracesToLogs({ tags: tags.map((key) => ({ key })) })}
                />
              </Field>

              <Field className={styles.field} label="Span start time shift" htmlFor="config-span-start-shift">
                <Select
                  className={styles.control}
                  inputId="config-span-start-shift"
                  options={SHIFT_OPTIONS}
                  allowCustomValue
                  value={t2l.spanStartTimeShift ?? '0'}
                  onChange={(v) => updateTracesToLogs({ spanStartTimeShift: v.value })}
                />
              </Field>

              <Field className={styles.field} label="Span end time shift" htmlFor="config-span-end-shift">
                <Select
                  className={styles.control}
                  inputId="config-span-end-shift"
                  options={SHIFT_OPTIONS}
                  allowCustomValue
                  value={t2l.spanEndTimeShift ?? '0'}
                  onChange={(v) => updateTracesToLogs({ spanEndTimeShift: v.value })}
                />
              </Field>

              <Field className={styles.field} label="Filter by trace ID" htmlFor="config-filter-trace-id">
                <InlineSwitch
                  id="config-filter-trace-id"
                  aria-label="Filter by trace ID"
                  value={!!t2l.filterByTraceID}
                  onChange={(e) => updateTracesToLogs({ filterByTraceID: e.currentTarget.checked })}
                />
              </Field>

              <Field className={styles.field} label="Filter by span ID" htmlFor="config-filter-span-id">
                <InlineSwitch
                  id="config-filter-span-id"
                  aria-label="Filter by span ID"
                  value={!!t2l.filterBySpanID}
                  onChange={(e) => updateTracesToLogs({ filterBySpanID: e.currentTarget.checked })}
                />
              </Field>
            </div>
          </FieldSet>
        </div>
      </Stack>
    </div>
  );
}
