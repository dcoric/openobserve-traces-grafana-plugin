import { DataSourceInstanceSettings, CoreApp, ScopedVars } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';

import { O2Query, O2DataSourceOptions, DEFAULT_QUERY } from './types';

export class DataSource extends DataSourceWithBackend<O2Query, O2DataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<O2DataSourceOptions>) {
    super(instanceSettings);
  }

  getDefaultQuery(_: CoreApp): Partial<O2Query> {
    return DEFAULT_QUERY;
  }

  applyTemplateVariables(query: O2Query, scopedVars: ScopedVars): O2Query {
    const t = getTemplateSrv();
    const replace = (v?: string) => (v ? t.replace(v, scopedVars) : v);
    return {
      ...query,
      traceId: replace(query.traceId),
      service: replace(query.service),
      spanName: replace(query.spanName),
      rawWhere: replace(query.rawWhere),
      stream: replace(query.stream),
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
    try {
      const res = await this.getResource('streams');
      return Array.isArray(res?.streams) ? res.streams : [];
    } catch (_e) {
      return [];
    }
  }
}
