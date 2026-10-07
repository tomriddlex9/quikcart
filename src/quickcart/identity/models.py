"""Identity contracts: Scope, Principal, preferences."""

from datetime import datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from quickcart.identity.catalog import APPROVE_PERMISSIONS, BUSINESS, OPS, experience_for

ScopeType = Literal["store", "city", "category", "company"]
COMPANY_SCOPE_VALUE = "*"


class Scope(BaseModel):
    model_config = ConfigDict(frozen=True)

    scope_type: ScopeType
    scope_value: str = COMPANY_SCOPE_VALUE


class Principal(BaseModel):
    """The authenticated caller: identity + roles + effective permissions + data scopes."""

    model_config = ConfigDict(frozen=True)

    user_id: int
    email: str
    display_name: str
    roles: list[str]
    permissions: frozenset[str]
    scopes: list[Scope] = Field(default_factory=list)
    onboarding_done: bool = False

    @property
    def persona(self) -> str:
        """Primary role key (first assigned role)."""
        return self.roles[0] if self.roles else ""

    @property
    def experience(self) -> str:
        """``business`` or ``ops`` — drives which console the user lands in."""
        try:
            return experience_for(self.persona)
        except KeyError:
            return OPS

    @property
    def is_business(self) -> bool:
        return self.experience == BUSINESS

    def without_approvals(self) -> "Principal":
        """Copy with every ``proposal:approve:*`` permission removed (public demo)."""
        return self.model_copy(
            update={"permissions": self.permissions - frozenset(APPROVE_PERMISSIONS)}
        )

    def public(self) -> dict[str, Any]:
        """JSON-safe ``/me`` shape (permissions sorted for stable output)."""
        return {
            "user_id": self.user_id,
            "email": self.email,
            "display_name": self.display_name,
            "roles": list(self.roles),
            "persona": self.persona,
            "experience": self.experience,
            "permissions": sorted(self.permissions),
            "scopes": [scope.model_dump() for scope in self.scopes],
            "onboarding_done": self.onboarding_done,
        }


class Preferences(BaseModel):
    user_id: int
    persona: str | None = None
    home_store_id: int | None = None
    home_city: str | None = None
    briefing_time: time | None = None
    timezone: str = "Asia/Kolkata"
    onboarding_state: dict[str, Any] = Field(default_factory=dict)
    completed_journeys: list[str] = Field(default_factory=list)
    voice_enabled: bool = False
    pinned_metrics: list[str] = Field(default_factory=list)
    density: str | None = None


class PreferencesPatch(BaseModel):
    """Partial update; only explicitly provided fields are written."""

    model_config = ConfigDict(extra="forbid")

    persona: str | None = None
    home_store_id: int | None = None
    home_city: str | None = None
    briefing_time: time | None = None
    timezone: str | None = None
    onboarding_state: dict[str, Any] | None = None
    completed_journeys: list[str] | None = None
    voice_enabled: bool | None = None
    pinned_metrics: list[str] | None = None
    density: str | None = None


class UserRecord(BaseModel):
    user_id: int
    email: str
    display_name: str
    password_hash: str
    is_active: bool = True
    last_login_at: datetime | None = None


class SessionRecord(BaseModel):
    sid: str
    user_id: int
    issued_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    user_agent: str | None = None


class AuthResult(BaseModel):
    """Outcome of a successful login: the principal plus its server-side session."""

    principal: Principal
    sid: str
    expires_at: datetime
