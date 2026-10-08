# OpenObserve Traces design system

## 1. Identity

This plugin is a native Grafana workspace for finding and inspecting traces. Query controls stay compact and familiar, with stream selection, search filters and trace lookup in reading order. Grafana owns navigation, query execution, results and the trace waterfall.

## 2. Color

Use Grafana's `GrafanaTheme2` tokens and `@grafana/ui` controls in both themes. Surfaces inherit `colors.background.primary` and `secondary`; text uses `colors.text.primary` and `secondary`; separators use `colors.border.weak`. Validation uses the native Field error state and Alert severity. No plugin-specific palette or decorative accent borders.

## 3. Typography

Inherit Grafana's font family and typography scale. Native Field labels, FieldSet legends, ConfigSection headings and Alert messages establish hierarchy. Technical identifiers remain selectable. Placeholder examples supplement visible labels.

## 4. Spacing and layout

Use `theme.spacing(1)` for related controls, `theme.spacing(2)` within sections and `theme.spacing(3)` between configuration sections. Query grids use intrinsic tracks with an 18rem preferred minimum, tag rows 16rem, and configuration grids 20rem. Each minimum is capped at 100% so controls form one column in narrow Explore panes. Widths, `minWidth: 0`, percentages and grid tracks are layout mechanics. Grafana owns page scrolling; plugin sections must not clip focus rings or create horizontal scrolling.

## 5. Components

- **Field and Input:** visible label linked to a unique ID, full-width control, native focus/disabled/error states. Validation text remains next to its field and is associated with the input.
- **Combobox:** stream, attribute, logs datasource and time-shift selection. Native keyboard navigation, selected label, loading feedback, clear action where empty is meaningful, and custom values for streams, attributes and shifts. Discovery failure leaves custom entry usable and explains the fallback.
- **Query modes:** RadioButtonGroup selects Search or Trace ID. Search retains all saved filters. Trace ID uses the native waterfall and optional node graph.
- **Tag rows:** attribute/value fields with a named remove button, followed by an Add action. Trace-to-logs mappings retain both the trace attribute and optional log label.
- **Configuration sections:** plugin-ui ConnectionSettings, Auth and AdvancedHttpSettings preserve Grafana's existing storage fields. OpenObserve settings and optional trace-to-logs mappings use native FieldSet and Stack. Read-only settings remain disabled.

## 6. Interaction

Use native Grafana control feedback and reduced-motion behavior. No additional animation. Text edits retain their current query model; valid blur or Enter runs the query. Invalid durations or limits show an actionable field error and prevent automatic blur submission. Dashboard variables are validated after Grafana resolves them. Async discovery discards stale responses when the datasource or stream changes.

## 7. Surfaces

Use the host's existing surface hierarchy, borders, radii and popover elevation. Do not add cards around individual query fields. Form sections group related settings with spacing and headings. Native popovers render above the editor without being clipped by plugin wrappers.

## 8. Accessibility and scope

Target WCAG AA for plugin-owned controls: visible focus, descriptive names, keyboard operation, associated inline errors, and status text that does not rely on color. Verify Search, Trace ID and configuration in light/dark at desktop and narrow widths, including long attribute names and discovery failures. The host's toolbar, waterfall layout, fonts and control sizing remain Grafana's responsibility. No custom accessibility exceptions are introduced by this refresh.
