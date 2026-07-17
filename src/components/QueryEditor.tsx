import React, { ChangeEvent, useEffect, useState } from 'react';
import {
  InlineField,
  InlineFieldRow,
  Input,
  InlineSwitch,
  RadioButtonGroup,
  Select,
  TextArea,
  Button,
  IconButton,
  Stack,
} from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { DataSource } from '../datasource';
import { O2DataSourceOptions, O2Query, O2QueryType, O2TagFilter } from '../types';

type Props = QueryEditorProps<DataSource, O2Query, O2DataSourceOptions>;

const QUERY_TYPES: Array<SelectableValue<O2QueryType>> = [
  { label: 'Search', value: 'search' },
  { label: 'Trace ID', value: 'traceId' },
];

const LABEL_WIDTH = 16;

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const queryType: O2QueryType = query.queryType ?? 'search';
  const [streamOptions, setStreamOptions] = useState<Array<SelectableValue<string>>>([]);

  useEffect(() => {
    let active = true;
    datasource.getStreams().then((streams) => {
      if (active) {
        setStreamOptions(streams.map((s) => ({ label: s, value: s })));
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
    <InlineField label="Stream" labelWidth={LABEL_WIDTH} tooltip="Trace stream to query (defaults to the datasource's default stream).">
      <Select
        width={32}
        isClearable
        allowCustomValue
        placeholder="default stream"
        options={streamOptions}
        value={query.stream ?? null}
        onChange={(v) => onField('stream', v?.value)}
      />
    </InlineField>
  );

  return (
    <Stack direction="column" gap={1}>
      <RadioButtonGroup
        options={QUERY_TYPES}
        value={queryType}
        onChange={(v) => onChange({ ...query, queryType: v })}
        size="md"
      />

      {queryType === 'traceId' ? (
        <>
          <InlineFieldRow>
            <InlineField label="Trace ID" labelWidth={LABEL_WIDTH} grow tooltip="The 32-character hexadecimal trace id to display.">
              <Input
                value={query.traceId ?? ''}
                placeholder="e.g. 0af7651916cd43dd8448eb211c80319c"
                onChange={(e: ChangeEvent<HTMLInputElement>) => onField('traceId', e.target.value)}
                onBlur={onRunQuery}
                onKeyDown={(e) => e.key === 'Enter' && onRunQuery()}
              />
            </InlineField>
          </InlineFieldRow>
          <InlineFieldRow>
            {streamSelector}
            <InlineField label="Node graph" labelWidth={LABEL_WIDTH} tooltip="Show a span-level node graph next to the waterfall.">
              <InlineSwitch value={!!query.nodeGraph} onChange={(e) => onField('nodeGraph', e.currentTarget.checked)} />
            </InlineField>
          </InlineFieldRow>
        </>
      ) : (
        <SearchEditor query={query} onChange={onChange} onRunQuery={onRunQuery} streamSelector={streamSelector} />
      )}
    </Stack>
  );
}

interface SearchEditorProps {
  query: O2Query;
  onChange: (q: O2Query) => void;
  onRunQuery: () => void;
  streamSelector: React.ReactNode;
}

function SearchEditor({ query, onChange, onRunQuery, streamSelector }: SearchEditorProps) {
  const set = <K extends keyof O2Query>(key: K, value: O2Query[K]) => onChange({ ...query, [key]: value });
  const tags = query.tags ?? [];

  const setTag = (i: number, patch: Partial<O2TagFilter>) => {
    const next = tags.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
    set('tags', next);
  };
  const addTag = () => set('tags', [...tags, { key: '', value: '' }]);
  const removeTag = (i: number) => set('tags', tags.filter((_, idx) => idx !== i));

  return (
    <Stack direction="column" gap={0}>
      <InlineFieldRow>
        <InlineField label="Service" labelWidth={LABEL_WIDTH} tooltip="service_name equals">
          <Input
            width={28}
            value={query.service ?? ''}
            placeholder="service_name"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('service', e.target.value)}
            onBlur={onRunQuery}
          />
        </InlineField>
        <InlineField label="Span name" labelWidth={LABEL_WIDTH} tooltip="operation_name equals">
          <Input
            width={28}
            value={query.spanName ?? ''}
            placeholder="operation_name"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('spanName', e.target.value)}
            onBlur={onRunQuery}
          />
        </InlineField>
      </InlineFieldRow>

      <InlineFieldRow>
        <InlineField label="Min duration" labelWidth={LABEL_WIDTH} tooltip="e.g. 1.5ms, 100us, 2s">
          <Input
            width={14}
            value={query.minDuration ?? ''}
            placeholder="100us"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('minDuration', e.target.value)}
            onBlur={onRunQuery}
          />
        </InlineField>
        <InlineField label="Max duration" labelWidth={LABEL_WIDTH} tooltip="e.g. 1.5ms, 100us, 2s">
          <Input
            width={14}
            value={query.maxDuration ?? ''}
            placeholder="2s"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('maxDuration', e.target.value)}
            onBlur={onRunQuery}
          />
        </InlineField>
        <InlineField label="Errors only" labelWidth={LABEL_WIDTH} tooltip="span_status = 'ERROR'">
          <InlineSwitch value={!!query.statusError} onChange={(e) => set('statusError', e.currentTarget.checked)} />
        </InlineField>
        <InlineField label="Limit" labelWidth={LABEL_WIDTH}>
          <Input
            width={12}
            type="number"
            value={query.limit ?? 50}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('limit', parseInt(e.target.value, 10) || 0)}
            onBlur={onRunQuery}
          />
        </InlineField>
      </InlineFieldRow>

      <InlineFieldRow>{streamSelector}</InlineFieldRow>

      {tags.map((tag, i) => (
        <InlineFieldRow key={i}>
          <InlineField label={i === 0 ? 'Tag' : ' '} labelWidth={LABEL_WIDTH}>
            <Input
              width={24}
              value={tag.key}
              placeholder="attribute (e.g. http_method)"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTag(i, { key: e.target.value })}
              onBlur={onRunQuery}
            />
          </InlineField>
          <InlineField label="=" labelWidth={3}>
            <Input
              width={24}
              value={tag.value}
              placeholder="value"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTag(i, { value: e.target.value })}
              onBlur={onRunQuery}
            />
          </InlineField>
          <IconButton name="trash-alt" aria-label="Remove tag filter" onClick={() => removeTag(i)} />
        </InlineFieldRow>
      ))}
      <div>
        <Button variant="secondary" size="sm" icon="plus" onClick={addTag}>
          Add tag filter
        </Button>
      </div>

      <InlineFieldRow>
        <InlineField
          label="Raw WHERE"
          labelWidth={LABEL_WIDTH}
          grow
          tooltip="Advanced: SQL appended to the WHERE clause, e.g. http_status_code >= 500. Runs with your OpenObserve credentials."
        >
          <TextArea
            rows={2}
            value={query.rawWhere ?? ''}
            placeholder="http_status_code >= 500"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => set('rawWhere', e.target.value)}
            onBlur={onRunQuery}
          />
        </InlineField>
      </InlineFieldRow>
    </Stack>
  );
}
