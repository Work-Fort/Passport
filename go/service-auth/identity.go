package auth

// Identity types.
const (
	TypeUser    = "user"
	TypeAgent   = "agent"
	TypeService = "service"
)

// Identity represents a verified caller — human user, agent, or service.
// All fields are populated by the auth middleware after token validation.
type Identity struct {
	ID          string // UUID, stable primary key
	Username    string // unique handle (e.g., "kazw")
	Name        string // full name (e.g., "Kaz Walker")
	DisplayName string // preferred display name (e.g., "Kaz")
	Type        string // TypeUser, TypeAgent, or TypeService
}
