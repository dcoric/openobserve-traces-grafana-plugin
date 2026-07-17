import React, { ChangeEvent } from 'react';
import { DataSourceHttpSettings, InlineField, Input, InlineSwitch, FieldSet, Select, TagsInput } from '@grafana/ui';
import { DataSourcePicker } from '@grafana/runtime';
import { DataSourcePluginOptionsEditorProps, SelectableValue } from '@grafana/data';
import { O2DataSourceOptions, O2SecureJsonData, TraceToLogsOptions } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<O2DataSourceOptions, O2SecureJsonData> {}

const LABEL_WIDTH = 26;

const SHIFT_OPTIONS: Array<SelectableValue<string>> = [
  { label: 'None', value: '0' },
  { label: '-1m', value: '-1m' },
  { label: '-5m', value: '-5m' },
  { label: '-1h', value: '-1h' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '1h', value: '1h' },
];

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;
  const { jsonData } = options;

  const updateJsonData = (patch: Partial<O2DataSourceOptions>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });
  };

  const updateTracesToLogs = (patch: Partial<TraceToLogsOptions>) => {
    updateJsonData({ tracesToLogsV2: { ...(jsonData.tracesToLogsV2 ?? {}), ...patch } });
  };

  const t2l = jsonData.tracesToLogsV2 ?? {};

  return (
    <>
      <DataSourceHttpSettings
        defaultUrl="http://localhost:5080"
        dataSourceConfig={options}
        onChange={onOptionsChange}
        showAccessOptions={false}
      />

      <FieldSet label="OpenObserve">
        <InlineField
          label="Organization"
          labelWidth={LABEL_WIDTH}
          tooltip="OpenObserve organization id used in every API path (/api/{org}/...). Defaults to 'default'."
        >
          <Input
            id="config-org-id"
            width={40}
            placeholder="default"
            value={jsonData.orgId ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateJsonData({ orgId: e.target.value })}
          />
        </InlineField>

        <InlineField
          label="Default traces stream"
          labelWidth={LABEL_WIDTH}
          tooltip="Stream queried when a query does not pick one. OpenObserve's default traces stream is usually 'default'."
        >
          <Input
            id="config-default-stream"
            width={40}
            placeholder="default"
            value={jsonData.defaultStream ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => updateJsonData({ defaultStream: e.target.value })}
          />
        </InlineField>

        <InlineField
          label="Node graph"
          labelWidth={LABEL_WIDTH}
          tooltip="Emit a span-level node graph alongside the trace waterfall for trace-by-id queries."
        >
          <InlineSwitch
            id="config-node-graph"
            value={!!jsonData.nodeGraph}
            onChange={(e) => updateJsonData({ nodeGraph: e.currentTarget.checked })}
          />
        </InlineField>
      </FieldSet>

      <FieldSet label="Trace to logs">
        <InlineField
          label="Logs data source"
          labelWidth={LABEL_WIDTH}
          tooltip="Data source opened from a span to view correlated logs."
        >
          <DataSourcePicker
            current={t2l.datasourceUid}
            noDefault
            width={40}
            onChange={(ds) => updateTracesToLogs({ datasourceUid: ds.uid })}
          />
        </InlineField>

        <InlineField
          label="Tags"
          labelWidth={LABEL_WIDTH}
          tooltip="Span/resource tags copied into the logs query as label filters (e.g. service_name, host_name)."
        >
          <TagsInput
            tags={(t2l.tags ?? []).map((tag) => tag.key)}
            onChange={(tags) => updateTracesToLogs({ tags: tags.map((key) => ({ key })) })}
          />
        </InlineField>

        <InlineField label="Span start time shift" labelWidth={LABEL_WIDTH}>
          <Select
            width={20}
            options={SHIFT_OPTIONS}
            allowCustomValue
            value={t2l.spanStartTimeShift ?? '0'}
            onChange={(v) => updateTracesToLogs({ spanStartTimeShift: v.value })}
          />
        </InlineField>

        <InlineField label="Span end time shift" labelWidth={LABEL_WIDTH}>
          <Select
            width={20}
            options={SHIFT_OPTIONS}
            allowCustomValue
            value={t2l.spanEndTimeShift ?? '0'}
            onChange={(v) => updateTracesToLogs({ spanEndTimeShift: v.value })}
          />
        </InlineField>

        <InlineField label="Filter by trace ID" labelWidth={LABEL_WIDTH}>
          <InlineSwitch
            value={!!t2l.filterByTraceID}
            onChange={(e) => updateTracesToLogs({ filterByTraceID: e.currentTarget.checked })}
          />
        </InlineField>

        <InlineField label="Filter by span ID" labelWidth={LABEL_WIDTH}>
          <InlineSwitch
            value={!!t2l.filterBySpanID}
            onChange={(e) => updateTracesToLogs({ filterBySpanID: e.currentTarget.checked })}
          />
        </InlineField>
      </FieldSet>
    </>
  );
}
