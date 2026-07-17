import React, { ChangeEvent } from 'react';
import { Button, Field, IconButton, Input, InlineSwitch, Stack } from '@grafana/ui';
import type { O2Query, O2TagFilter } from '../types';
import { FieldLabel, type QueryEditorStyles } from './QueryEditorStyles';

interface QuerySearchEditorProps {
  query: O2Query;
  onChange: (query: O2Query) => void;
  onRunQuery: () => void;
  streamSelector: React.ReactNode;
  idPrefix: string;
  styles: QueryEditorStyles;
}

export function QuerySearchEditor({
  query,
  onChange,
  onRunQuery,
  streamSelector,
  idPrefix,
  styles,
}: QuerySearchEditorProps) {
  const controlId = (name: string) => `${idPrefix}-${name}`;
  const set = <K extends keyof O2Query>(key: K, value: O2Query[K]) => onChange({ ...query, [key]: value });
  const tags = query.tags ?? [];

  const setTag = (i: number, patch: Partial<O2TagFilter>) => {
    const next = tags.map((tag, index) => (index === i ? { ...tag, ...patch } : tag));
    set('tags', next);
  };
  const addTag = () => set('tags', [...tags, { key: '', value: '' }]);
  const removeTag = (i: number) =>
    set(
      'tags',
      tags.filter((_, index) => index !== i)
    );

  return (
    <Stack direction="column" gap={1} width="100%" minWidth={0}>
      <div className={styles.grid} data-testid="query-search-fields">
        <Field
          className={styles.field}
          label={<FieldLabel label="Service" tooltip="service_name equals" />}
          htmlFor={controlId('service')}
        >
          <Input
            className={styles.control}
            aria-label="Service"
            id={controlId('service')}
            value={query.service ?? ''}
            placeholder="service_name"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('service', e.target.value)}
            onBlur={onRunQuery}
          />
        </Field>
        <Field
          className={styles.field}
          label={<FieldLabel label="Span name" tooltip="operation_name equals" />}
          htmlFor={controlId('span-name')}
        >
          <Input
            className={styles.control}
            aria-label="Span name"
            id={controlId('span-name')}
            value={query.spanName ?? ''}
            placeholder="operation_name"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('spanName', e.target.value)}
            onBlur={onRunQuery}
          />
        </Field>
      </div>

      <div className={styles.grid} data-testid="query-duration-fields">
        <Field
          className={styles.field}
          label={<FieldLabel label="Min duration" tooltip="e.g. 1.5ms, 100us, 2s" />}
          htmlFor={controlId('min-duration')}
        >
          <Input
            className={styles.control}
            aria-label="Min duration"
            id={controlId('min-duration')}
            value={query.minDuration ?? ''}
            placeholder="100us"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('minDuration', e.target.value)}
            onBlur={onRunQuery}
          />
        </Field>
        <Field
          className={styles.field}
          label={<FieldLabel label="Max duration" tooltip="e.g. 1.5ms, 100us, 2s" />}
          htmlFor={controlId('max-duration')}
        >
          <Input
            className={styles.control}
            aria-label="Max duration"
            id={controlId('max-duration')}
            value={query.maxDuration ?? ''}
            placeholder="2s"
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('maxDuration', e.target.value)}
            onBlur={onRunQuery}
          />
        </Field>
        <Field className={styles.field} label="Errors only" htmlFor={controlId('errors-only')}>
          <InlineSwitch
            id={controlId('errors-only')}
            aria-label="Errors only"
            value={!!query.statusError}
            onChange={(e) => set('statusError', e.currentTarget.checked)}
          />
        </Field>
        <Field className={styles.field} label="Limit" htmlFor={controlId('limit')}>
          <Input
            className={styles.control}
            id={controlId('limit')}
            type="number"
            value={query.limit ?? 50}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set('limit', parseInt(e.target.value, 10) || 0)}
            onBlur={onRunQuery}
          />
        </Field>
      </div>

      <div className={styles.grid} data-testid="query-stream-field">
        <div className={styles.wide}>{streamSelector}</div>
      </div>

      {tags.map((tag, i) => (
        <div className={styles.tagGrid} data-testid="query-tag-grid" key={i}>
          <Field className={styles.field} label={`Tag ${i + 1} attribute`} htmlFor={controlId(`tag-${i}-key`)}>
            <Input
              className={styles.control}
              id={controlId(`tag-${i}-key`)}
              aria-label={`Tag ${i + 1} attribute`}
              value={tag.key}
              placeholder="attribute (e.g. http_method)"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTag(i, { key: e.target.value })}
              onBlur={onRunQuery}
            />
          </Field>
          <Field className={styles.field} label={`Tag ${i + 1} value`} htmlFor={controlId(`tag-${i}-value`)}>
            <Input
              className={styles.control}
              id={controlId(`tag-${i}-value`)}
              aria-label={`Tag ${i + 1} value`}
              value={tag.value}
              placeholder="value"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTag(i, { value: e.target.value })}
              onBlur={onRunQuery}
            />
          </Field>
          <IconButton
            className={styles.action}
            name="trash-alt"
            aria-label={`Remove tag filter ${i + 1}`}
            onClick={() => removeTag(i)}
          />
        </div>
      ))}
      <div className={styles.actionRow}>
        <Button variant="secondary" size="sm" icon="plus" onClick={addTag}>
          Add tag filter
        </Button>
      </div>
    </Stack>
  );
}
