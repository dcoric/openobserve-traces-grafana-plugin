import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { CheatSheet } from './components/CheatSheet';
import { O2Query, O2DataSourceOptions } from './types';

export const plugin = new DataSourcePlugin<DataSource, O2Query, O2DataSourceOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor)
  .setQueryEditorHelp(CheatSheet);
