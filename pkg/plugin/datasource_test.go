package plugin

import (
	"strings"
	"testing"
)

func TestBuildTraceDetailSQL(t *testing.T) {
	sql := buildTraceDetailSQL("default", "0af7651916cd43dd8448eb211c80319c")
	want := `SELECT * FROM "default" WHERE trace_id = '0af7651916cd43dd8448eb211c80319c' ORDER BY start_time`
	if sql != want {
		t.Errorf("got:\n%s\nwant:\n%s", sql, want)
	}
}

func TestBuildSearchSQL_Filters(t *testing.T) {
	q := &queryModel{
		Service:     "frontend",
		SpanName:    "GET /",
		StatusError: true,
		MinDuration: "1.5ms",
		MaxDuration: "2s",
		Tags:        []tagFilter{{Key: "http_method", Value: "GET"}},
		RawWhere:    "http_status_code = 500",
	}
	filters := buildSearchFilters(q)
	having, err := buildSearchHaving(q)
	if err != nil {
		t.Fatalf("buildSearchHaving: %v", err)
	}
	sql := buildSearchSQL("default", filters, having, 50)

	for _, want := range []string{
		`service_name = 'frontend'`,
		`operation_name = 'GET /'`,
		`span_status = 'ERROR'`,
		`http_method = 'GET'`,
		`(http_status_code = 500)`,
		`GROUP BY trace_id`,
		`FROM "default"`,
		// duration bounds are trace-level (HAVING on the aggregate), not WHERE.
		`HAVING max(duration) >= 1500 AND max(duration) <= 2000000`,
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("search SQL missing %q\nSQL: %s", want, sql)
		}
	}
	if strings.Contains(sql, "WHERE") && strings.Contains(sql, "duration >= 1500") {
		t.Errorf("duration must not be a span-level WHERE predicate\nSQL: %s", sql)
	}
}

func TestBuildSearchFilters_SQLInjectionEscaped(t *testing.T) {
	q := &queryModel{Service: "a' OR '1'='1"}
	filters := buildSearchFilters(q)
	if len(filters) != 1 || filters[0] != `service_name = 'a'' OR ''1''=''1'` {
		t.Errorf("single quotes not escaped: %v", filters)
	}
}

func TestQuoteStreamStripsUnsafe(t *testing.T) {
	if got := quoteStream(`default"; DROP`); got != `"defaultDROP"` {
		t.Errorf("quoteStream did not sanitize: %s", got)
	}
}

func TestSchemaStreamParam(t *testing.T) {
	cases := map[string]string{
		"/schema?stream=default":          "default",
		"/schema?stream=my_stream&type=x": "my_stream",
		"/schema":                         "",
	}
	for in, want := range cases {
		if got := schemaStreamParam(in); got != want {
			t.Errorf("schemaStreamParam(%q) = %q, want %q", in, got, want)
		}
	}
}
