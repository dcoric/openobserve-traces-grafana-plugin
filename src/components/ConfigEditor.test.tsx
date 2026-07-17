import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DataSourceInstanceSettings, DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import { ConfigEditor } from './ConfigEditor';
import type { O2DataSourceOptions, O2SecureJsonData } from '../types';

jest.mock('@grafana/runtime', () => ({ getDataSourceSrv: jest.fn() }));

const getList = jest.fn();
const getDataSourceSrvMock = jest.mocked(getDataSourceSrv);
const LOG_DATASOURCES = [
  { uid: 'logs-primary', name: 'Primary logs' },
  { uid: 'logs-secondary', name: 'Secondary logs' },
] as unknown as DataSourceInstanceSettings[];

describe('ConfigEditor settings', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: class {
        disconnect() {
          return undefined;
        }

        observe() {
          return undefined;
        }

        unobserve() {
          return undefined;
        }
      },
    });
  });

  beforeEach(() => {
    getList.mockReset().mockReturnValue(LOG_DATASOURCES);
    getDataSourceSrvMock.mockReturnValue({ getList } as never);
  });

  it('renders plugin-owned settings in fluid section grids with stable names', () => {
    const props: DataSourcePluginOptionsEditorProps<O2DataSourceOptions, O2SecureJsonData> = {
      options: {
        id: 1,
        uid: 'openobserve-test',
        orgId: 1,
        name: 'OpenObserve',
        typeLogoUrl: '',
        type: 'gresearch-openobserve-traces-datasource',
        typeName: 'OpenObserve Traces',
        access: 'proxy',
        url: 'http://localhost:5080',
        user: '',
        database: '',
        basicAuth: false,
        basicAuthUser: '',
        isDefault: false,
        jsonData: {},
        secureJsonFields: {},
        readOnly: false,
        withCredentials: false,
      },
      onOptionsChange: jest.fn(),
    };

    render(<ConfigEditor {...props} />);

    expect(screen.getByTestId('config-http-settings')).toBeInTheDocument();
    expect(screen.getByTestId('config-openobserve-section')).toBeInTheDocument();
    expect(screen.getByTestId('config-trace-logs-section')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Organization' })).toBeInTheDocument();
    const logsDatasource = screen.getByRole('combobox', { name: 'Logs datasource' });
    expect(logsDatasource).toHaveAttribute('id', 'config-logs-datasource');
    expect(getList).toHaveBeenCalledWith({ logs: true });
  });

  it('filters log datasources and persists the selected UID', async () => {
    const onOptionsChange = jest.fn();
    const props = createProps(onOptionsChange, 'logs-primary');

    render(<ConfigEditor {...props} />);

    const logsDatasource = screen.getByRole('combobox', { name: 'Logs datasource' });
    expect(logsDatasource).toHaveValue('');
    fireEvent.keyDown(logsDatasource, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByText('Secondary logs'));

    await waitFor(() => expect(onOptionsChange).toHaveBeenCalled());
    expect(onOptionsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({
          tracesToLogsV2: expect.objectContaining({ datasourceUid: 'logs-secondary' }),
        }),
      })
    );
  });

  it('keeps a missing configured UID visible without rewriting it', () => {
    const onOptionsChange = jest.fn();

    render(<ConfigEditor {...createProps(onOptionsChange, 'logs-missing')} />);

    expect(screen.getByText('logs-missing (not found)')).toBeInTheDocument();
    expect(onOptionsChange).not.toHaveBeenCalled();
  });
});

function createProps(
  onOptionsChange: jest.Mock,
  datasourceUid?: string
): DataSourcePluginOptionsEditorProps<O2DataSourceOptions, O2SecureJsonData> {
  return {
    options: {
      id: 1,
      uid: 'openobserve-test',
      orgId: 1,
      name: 'OpenObserve',
      typeLogoUrl: '',
      type: 'gresearch-openobserve-traces-datasource',
      typeName: 'OpenObserve Traces',
      access: 'proxy',
      url: 'http://localhost:5080',
      user: '',
      database: '',
      basicAuth: false,
      basicAuthUser: '',
      isDefault: false,
      jsonData: datasourceUid ? { tracesToLogsV2: { datasourceUid } } : {},
      secureJsonFields: {},
      readOnly: false,
      withCredentials: false,
    },
    onOptionsChange,
  };
}
