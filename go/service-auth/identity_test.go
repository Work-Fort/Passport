package auth

import "testing"

func TestIdentityTypeConstants(t *testing.T) {
	tests := []struct {
		name     string
		typeVal  string
		expected string
	}{
		{"user type", TypeUser, "user"},
		{"agent type", TypeAgent, "agent"},
		{"service type", TypeService, "service"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.typeVal != tt.expected {
				t.Errorf("got %q, want %q", tt.typeVal, tt.expected)
			}
		})
	}
}

func TestIdentityIsZero(t *testing.T) {
	var id Identity
	if id.ID != "" {
		t.Error("zero Identity should have empty ID")
	}
	if id.Type != "" {
		t.Error("zero Identity should have empty Type")
	}
}

func TestIdentityFields(t *testing.T) {
	id := Identity{
		ID:          "550e8400-e29b-41d4-a716-446655440000",
		Username:    "kazw",
		Name:        "Kaz Walker",
		DisplayName: "Kaz",
		Type:        TypeUser,
	}
	if id.ID != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("ID mismatch: %s", id.ID)
	}
	if id.Username != "kazw" {
		t.Errorf("Username mismatch: %s", id.Username)
	}
	if id.Name != "Kaz Walker" {
		t.Errorf("Name mismatch: %s", id.Name)
	}
	if id.DisplayName != "Kaz" {
		t.Errorf("DisplayName mismatch: %s", id.DisplayName)
	}
	if id.Type != TypeUser {
		t.Errorf("Type mismatch: %s", id.Type)
	}
}
