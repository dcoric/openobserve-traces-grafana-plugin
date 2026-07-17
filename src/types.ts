import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type O2QueryType = 'search' | 'traceId';

export interface O2TagFilter {
  key: string;
  value: string;
}

/**
 * O2Query is the query model sent to the backend. It must stay in sync with
 * the queryModel struct in pkg/plugin/query.go.
 */
export interface O2Query extends DataQuery {
  queryType?: O2QueryType;

  // Trace-by-id mode.
  traceId?: string;

  // Search builder.
  service?: string;
  spanName?: string;
  statusError?: boolean;
  minDuration?: string;
  maxDuration?: string;
  tags?: O2TagFilter[];
  rawWhere?: string;
  limit?: number;

  // Stream override (falls back to the datasource default stream).
  stream?: string;

  // Emit a node graph alongside the waterfall for trace-by-id queries.
  nodeGraph?: boolean;
}

export const DEFAULT_QUERY: Partial<O2Query> = {
  queryType: 'search',
  limit: 50,
};

/** Trace-to-logs correlation config; read by Grafana core to build span links. */
export interface TraceToLogsOptions {
  datasourceUid?: string;
  tags?: Array<{ key: string; value?: string }>;
  spanStartTimeShift?: string;
  spanEndTimeShift?: string;
  filterByTraceID?: boolean;
  filterBySpanID?: boolean;
  query?: string;
}

/** Datasource configuration (jsonData). */
export interface O2DataSourceOptions extends DataSourceJsonData {
  orgId?: string;
  defaultStream?: string;
  nodeGraph?: boolean;
  tracesToLogsV2?: TraceToLogsOptions;
}

/**
 * Secure values. Basic Auth password is stored under the conventional
 * `basicAuthPassword` key managed by Grafana's HTTP settings, so no custom
 * secure fields are required here.
 */
export interface O2SecureJsonData {
  basicAuthPassword?: string;
}
