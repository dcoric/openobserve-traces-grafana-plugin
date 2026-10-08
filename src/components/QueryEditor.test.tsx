import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      expect(within(container).getByRole('combobox', { name: 'Tag 1 attribute' })).toBeInTheDocument();
      expect(within(container).getByRole('textbox', { name: 'Tag 1 value' })).toBeInTheDocument();
    }
  });

  it('retains custom attributes when schema discovery fails', async () => {
    const datasource = createDatasourceMock(jest.fn().mockResolvedValue([]));
    datasource.getSchema = jest.fn().mockRejectedValue(new Error('Unavailable'));
    const onChange = jest.fn();
    render(
      <QueryEditor
        datasource={datasource}
        app={CoreApp.Explore}
        query={{ refId: 'A', stream: 'custom', tags: [{ key: 'saved.attribute', value: 'GET' }] }}
        onChange={onChange}
        onRunQuery={jest.fn()}
      />
    );
    expect(await screen.findByText('You can still enter attribute names manually.')).toBeVisible();
    expect(datasource.getSchema).toHaveBeenCalledWith('custom');
    expect(screen.getByRole('combobox', { name: 'Tag 1 attribute' })).toHaveValue('saved.attribute');
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag 1 value' }), { target: { value: 'POST' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ tags: [{ key: 'saved.attribute', value: 'POST' }] })
    );
  });

  it('blocks automatic execution of invalid durations and retains decimal limits for validation', async () => {
    const datasource = createDatasourceMock(jest.fn().mockResolvedValue([]));
    const onRunQuery = jest.fn();
    const onChange = jest.fn();
    const props = { datasource, app: CoreApp.Explore, onRunQuery, onChange };
    const view = render(<QueryEditor {...props} query={{ refId: 'A', minDuration: 'bad', limit: 501 }} />);
    await waitFor(() => expect(datasource.getSchema).toHaveBeenCalled());
    expect(screen.getByText(/Use a non-negative duration/)).toBeVisible();
    expect(screen.getByText(/Use a whole number up to 500/)).toBeVisible();
    fireEvent.blur(screen.getByRole('textbox', { name: 'Min duration' }));
    expect(onRunQuery).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Limit' }), { target: { value: '1.5' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1.5 }));
    view.rerender(<QueryEditor {...props} query={{ refId: 'A', minDuration: '${duration}', limit: 500 }} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Min duration' }), { key: 'Enter' });
    expect(onRunQuery).toHaveBeenCalledTimes(1);
  });
});

function createDatasourceMock(getStreams: jest.MockedFunction<DataSource['getStreams']>): DataSource {
  const datasource = Object.create(DataSource.prototype) as DataSource;
  datasource.getStreams = getStreams;
  datasource.getSchema = jest.fn().mockResolvedValue(['http_method']);
  return datasource;
}
