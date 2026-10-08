import { DataSourceInstanceSettings, CoreApp, ScopedVars } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';

import { O2Query, O2DataSourceOptions, DEFAULT_QUERY } from './types';

export class DataSource extends DataSourceWithBackend<O2Query, O2DataSourceOptions> {
  private readonly defaultStream: string;

  constructor(instanceSettings: DataSourceInstanceSettings<O2DataSourceOptions>) {
    super(instanceSettings);
    this.defaultStream = instanceSettings.jsonData?.defaultStream || 'default';
  }

  getDefaultQuery(_: CoreApp): Partial<O2Query> {
    return DEFAULT_QUERY;
  }

  applyTemplateVariables(query: O2Query, scopedVars: ScopedVars): O2Query {
    const t = getTemplateSrv();
    const replace = (v?: string) => (v === undefined ? undefined : t.replace(v, scopedVars));
    return {
      ...query,
      traceId: replace(query.traceId),
      service: replace(query.service),
      spanName: replace(query.spanName),
      minDuration: replace(query.minDuration),
      maxDuration: replace(query.maxDuration),
      stream: replace(query.stream),
      tags: query.tags?.map((tag) => ({
        ...tag,
        key: replace(tag.key) ?? '',
        value: replace(tag.value) ?? '',
      })),
    };
  }

  filterQuery(query: O2Query): boolean {
    if (query.hide) {
      return false;
    }
    // A trace-by-id query needs an id; a search can run with no filters.
    if (query.queryType === 'traceId') {
      return !!query.traceId?.trim();
    }
    return true;
  }

  /** Lists the available trace streams for the configured org (query-editor picker). */
  async getStreams(): Promise<string[]> {
    const res = await this.getResource<{ streams?: unknown }>('streams');
    if (!res || !Array.isArray(res.streams)) {
      throw new Error('Invalid streams response: streams must be an array');
    }
    if (!res.streams.every((stream) => typeof stream === 'string')) {
      throw new Error('Invalid streams response: streams must contain only strings');
    }
    if (res.streams.length === 0) {
      return [];
    }
    return res.streams;
  }

  async getSchema(stream?: string): Promise<string[]> {
    const response = await this.getResource<{ schema?: unknown }>('schema', { stream: stream || this.defaultStream });
    if (!response || !Array.isArray(response.schema)) {
      throw new Error('Invalid schema response: schema must be an array');
    }
    const names: string[] = [];
    for (const field of response.schema) {
      if (!field || typeof field !== 'object' || !('name' in field) || typeof field.name !== 'string') {
        throw new Error('Invalid schema response: fields must have string names');
      }
      names.push(field.name);
    }
    return [...new Set(names)].sort();
  }
}
