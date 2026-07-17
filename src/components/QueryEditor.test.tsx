import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { CoreApp, type QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { QueryEditor } from './QueryEditor';
import type { O2DataSourceOptions, O2Query } from '../types';

describe('QueryEditor stream discovery', () => {
  it('shows an accessible error when stream discovery fails', async () => {
    const getStreams = jest.fn<ReturnType<DataSource['getStreams']>, Parameters<DataSource['getStreams']>>();
    getStreams.mockRejectedValue(new Error('stream request failed'));
    const datasource = createDatasourceMock(getStreams);
    const props: QueryEditorProps<DataSource, O2Query, O2DataSourceOptions> = {
      query: { refId: 'A', queryType: 'search' },
      onChange: jest.fn(),
      onRunQuery: jest.fn(),
      datasource,
      app: CoreApp.Explore,
    };

    render(<QueryEditor {...props} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('stream request failed');
  });

  it('keeps stable accessible names for search and trace controls', async () => {
    const getStreams = jest.fn<ReturnType<DataSource['getStreams']>, Parameters<DataSource['getStreams']>>();
    getStreams.mockResolvedValue([]);
    const datasource = createDatasourceMock(getStreams);
    const props: QueryEditorProps<DataSource, O2Query, O2DataSourceOptions> = {
      query: { refId: 'A', queryType: 'search' },
      onChange: jest.fn(),
      onRunQuery: jest.fn(),
      datasource,
      app: CoreApp.Explore,
    };

    const view = render(<QueryEditor {...props} />);

    expect(screen.getByRole('textbox', { name: 'Service' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Span name' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Min duration' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Max duration' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Stream' })).toBeVisible();
    await waitFor(() => expect(datasource.getStreams).toHaveBeenCalledTimes(1));

    view.rerender(<QueryEditor {...props} query={{ ...props.query, queryType: 'traceId' }} />);

    expect(screen.getByRole('textbox', { name: 'Trace ID' })).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Node graph' })).toBeInTheDocument();
  });

  it('keeps query control ids unique and labels targeted when two editors render', async () => {
    const getStreams = jest.fn<ReturnType<DataSource['getStreams']>, Parameters<DataSource['getStreams']>>();
    getStreams.mockResolvedValue([]);
    const datasource = createDatasourceMock(getStreams);
    const props: QueryEditorProps<DataSource, O2Query, O2DataSourceOptions> = {
      query: { refId: 'A', queryType: 'search', tags: [{ key: 'http.method', value: 'GET' }] },
      onChange: jest.fn(),
      onRunQuery: jest.fn(),
      datasource,
      app: CoreApp.Explore,
    };

    const first = render(<QueryEditor {...props} />);
    const second = render(<QueryEditor {...props} query={{ ...props.query, refId: 'B' }} />);
    await waitFor(() => expect(datasource.getStreams).toHaveBeenCalledTimes(2));

    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const container of [first.container, second.container]) {
      expect(within(container).getByTestId('query-search-fields')).toBeInTheDocument();
      expect(within(container).getByTestId('query-duration-fields')).toBeInTheDocument();
      expect(within(container).getByTestId('query-stream-field')).toBeInTheDocument();
      for (const label of container.querySelectorAll<HTMLLabelElement>('label[for]')) {
        const target = Array.from(container.querySelectorAll<HTMLElement>('[id]')).find(
          (element) => element.id === label.htmlFor
        );
        expect(target).toBeDefined();
      }
      expect(within(container).getByRole('textbox', { name: 'Service' })).toBeInTheDocument();
      expect(within(container).getByRole('textbox', { name: 'Tag 1 attribute' })).toBeInTheDocument();
      expect(within(container).getByRole('textbox', { name: 'Tag 1 value' })).toBeInTheDocument();
    }
  });
});

function createDatasourceMock(getStreams: jest.MockedFunction<DataSource['getStreams']>): DataSource {
  const datasource = Object.create(DataSource.prototype) as DataSource;
  datasource.getStreams = getStreams;
  return datasource;
}
