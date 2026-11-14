package api

import (
	"context"
	"net/http/httptest"
	"testing"

	"deutschfremsprache/internal/config"
	"deutschfremsprache/internal/store"
)

// Words can be filed into the learner's own packages, one at a time or a
// whole batch at once; packages are private and deleting one keeps its words.
func TestVocabPackages(t *testing.T) {
	st := openTestStore(t)
	server, err := New(context.Background(), config.Config{DataDir: t.TempDir(), JWTSecret: "x"}, st)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server.Handler())
	defer srv.Close()
	c, stranger := other(t, srv.URL), other(t, srv.URL)

	var p store.VocabPackage
	if code := c.json("POST", "/api/vocab/packages", map[string]string{"name": "  A2   Kapitel 3 "}, &p); code != 201 || p.Name != "A2 Kapitel 3" {
		t.Fatalf("create: %d %+v", code, p)
	}
	if code := c.json("POST", "/api/vocab/packages", map[string]string{"name": "a2 kapitel 3"}, nil); code != 409 {
		t.Fatalf("duplicate name: %d", code)
	}

	var v store.VocabEntry
	if code := c.json("POST", "/api/vocab", map[string]any{"language": "en-US", "term": "apple", "packageId": p.ID}, &v); code != 201 || v.PackageID == nil || *v.PackageID != p.ID {
		t.Fatalf("single add: %d %+v", code, v.PackageID)
	}
	var bulk struct{ Added []store.VocabEntry }
	c.json("POST", "/api/vocab/bulk", map[string]any{"language": "en-US", "packageId": p.ID,
		"items": []map[string]string{{"term": "pear", "meaning": "lê"}, {"term": "plum", "meaning": "mận"}}}, &bulk)
	if len(bulk.Added) != 2 || *bulk.Added[0].PackageID != p.ID || *bulk.Added[1].PackageID != p.ID {
		t.Fatalf("bulk: %+v", bulk)
	}

	// Someone else's package cannot be used.
	if code := stranger.json("POST", "/api/vocab", map[string]any{"language": "en-US", "term": "kiwi", "packageId": p.ID}, nil); code != 400 {
		t.Fatalf("foreign package: %d", code)
	}
	var theirs []store.VocabPackage
	if stranger.json("GET", "/api/vocab/packages", nil, &theirs); len(theirs) != 0 {
		t.Fatalf("stranger sees packages: %+v", theirs)
	}

	var list []store.VocabPackage
	if c.json("GET", "/api/vocab/packages", nil, &list); len(list) != 1 || list[0].Words != 3 {
		t.Fatalf("list: %+v", list)
	}

	// Moving a word out of its package.
	if code := c.json("PUT", "/api/vocab/"+itoa(v.ID), map[string]any{"term": "apple", "packageId": nil}, &v); code != 200 || v.PackageID != nil {
		t.Fatalf("unfile: %d %+v", code, v.PackageID)
	}

	if code := c.json("PUT", "/api/vocab/packages/"+itoa(p.ID), map[string]string{"name": "Obst"}, &p); code != 200 || p.Name != "Obst" {
		t.Fatalf("rename: %d %+v", code, p)
	}
	if code := c.json("DELETE", "/api/vocab/packages/"+itoa(p.ID), nil, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	var words []store.VocabEntry
	if c.json("GET", "/api/vocab", nil, &words); len(words) != 3 || words[0].PackageID != nil {
		t.Fatalf("words after delete: %+v", words)
	}
}
