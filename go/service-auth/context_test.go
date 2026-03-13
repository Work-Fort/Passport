// SPDX-License-Identifier: Apache-2.0

package auth

import (
	"context"
	"testing"
)

func TestIdentityFromContext_Present(t *testing.T) {
	want := Identity{
		ID:       "test-id",
		Username: "testuser",
		Type:     TypeUser,
	}
	ctx := ContextWithIdentity(context.Background(), want)
	got, ok := IdentityFromContext(ctx)
	if !ok {
		t.Fatal("expected identity in context")
	}
	if got.ID != want.ID {
		t.Errorf("ID: got %q, want %q", got.ID, want.ID)
	}
	if got.Username != want.Username {
		t.Errorf("Username: got %q, want %q", got.Username, want.Username)
	}
}

func TestIdentityFromContext_Missing(t *testing.T) {
	_, ok := IdentityFromContext(context.Background())
	if ok {
		t.Error("expected no identity in empty context")
	}
}

func TestMustIdentity_Panics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic for missing identity")
		}
	}()
	MustIdentity(context.Background())
}

func TestMustIdentity_Returns(t *testing.T) {
	want := Identity{ID: "test-id", Type: TypeAgent}
	ctx := ContextWithIdentity(context.Background(), want)
	got := MustIdentity(ctx)
	if got.ID != want.ID {
		t.Errorf("ID: got %q, want %q", got.ID, want.ID)
	}
}
