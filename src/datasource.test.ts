import { getTemplateSrv } from '@grafana/runtime';
import type { ScopedVars } from '@grafana/data';
import { DataSource } from './datasource';
import type { O2Query } from './types';

jest.mock('@grafana/runtime', () => ({
  DataSourceWithBackend: class DataSourceWithBackend {},
  getTemplateSrv: jest.fn(),
}));

describe('DataSource query handling', () => {
  it('interpolates every supported query field and tag without mutating the source query', () => {
    const replace = jest.fn((value: string) => `resolved:${value}`);
    jest.mocked(getTemplateSrv).mockReturnValue({
      replace,
      getVariables: jest.fn(),
      containsTemplate: jest.fn(),
      updateTimeRange: jest.fn(),
    });

    const tags = [{ key: '${tagKey}', value: '${tagValue}' }];
    const query: O2Query = {
      refId: 'A',
      stream: '${stream}',
      traceId: '${traceId}',
      service: '${service}',
      spanName: '${spanName}',
      minDuration: '${minDuration}',
      maxDuration: '${maxDuration}',
      tags,
    };

    const result = new DataSource({} as never).applyTemplateVariables(query, {} as ScopedVars);

    expect(result).toEqual({
      ...query,
      stream: 'resolved:${stream}',
      traceId: 'resolved:${traceId}',
      service: 'resolved:${service}',
      spanName: 'resolved:${spanName}',
      minDuration: 'resolved:${minDuration}',
      maxDuration: 'resolved:${maxDuration}',
      tags: [{ key: 'resolved:${tagKey}', value: 'resolved:${tagValue}' }],
    });
    expect(query.tags).toBe(tags);
    expect(query.tags?.[0]).toEqual({ key: '${tagKey}', value: '${tagValue}' });
  });

  it('surfaces stream discovery failures to the caller', async () => {
    const datasource = new DataSource({} as never);
    const getResource = jest.fn().mockRejectedValue(new Error('stream request failed'));
    datasource.getResource = getResource;

    await expect(datasource.getStreams()).rejects.toThrow('stream request failed');
  });

  it('rejects a malformed successful stream response', async () => {
    const datasource = new DataSource({} as never);
    datasource.getResource = jest.fn().mockResolvedValue({ streams: 'not-an-array' });

    await expect(datasource.getStreams()).rejects.toThrow('Invalid streams response');
  });

  it('returns an empty list for a valid empty stream response', async () => {
    const datasource = new DataSource({} as never);
    datasource.getResource = jest.fn().mockResolvedValue({ streams: [] });

    await expect(datasource.getStreams()).resolves.toEqual([]);
  });
});
