-- V007 — Identity & RBAC (Phase B1).
-- Users, roles, permissions, data scopes, per-user preferences, server-side
-- sessions (JWT `sid` claim → auth_sessions), and an append-only audit log.
-- Seeds the static role/permission catalog; mirrored by
-- quickcart.identity.catalog (a unit test keeps them in sync). Demo users are
-- seeded by `python -m quickcart.identity.seed`, never by SQL (password hashes
-- are produced by argon2, not stored in migrations).
--
-- Business roles never hold sql:execute / copilot:sql_tool. `admin` manages
-- users/audit/system but holds no proposal:approve:* permission.

CREATE TABLE app_users (
    user_id       BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    role_key   TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    experience TEXT NOT NULL CHECK (experience IN ('business', 'ops'))
);

CREATE TABLE permissions (
    perm_key    TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_key TEXT NOT NULL REFERENCES roles(role_key) ON DELETE CASCADE,
    perm_key TEXT NOT NULL REFERENCES permissions(perm_key) ON DELETE CASCADE,
    PRIMARY KEY (role_key, perm_key)
);

CREATE TABLE user_roles (
    user_id  BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    role_key TEXT NOT NULL REFERENCES roles(role_key),
    PRIMARY KEY (user_id, role_key)
);

-- Data scopes. `company` scope uses scope_value '*' (unrestricted).
CREATE TABLE user_scopes (
    user_id     BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    scope_type  TEXT NOT NULL CHECK (scope_type IN ('store', 'city', 'category', 'company')),
    scope_value TEXT NOT NULL,
    PRIMARY KEY (user_id, scope_type, scope_value)
);

CREATE TABLE user_preferences (
    user_id             BIGINT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
    persona             TEXT REFERENCES roles(role_key),
    home_store_id       BIGINT,
    home_city           TEXT,
    briefing_time       TIME,
    timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    onboarding_state    JSONB NOT NULL DEFAULT '{}',
    completed_journeys  TEXT[] NOT NULL DEFAULT '{}',
    voice_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    pinned_metrics      TEXT[] NOT NULL DEFAULT '{}',
    density             TEXT
);

CREATE TABLE auth_sessions (
    sid        UUID PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent TEXT
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id, expires_at);

CREATE TABLE audit_log (
    audit_id       BIGSERIAL PRIMARY KEY,
    actor_user_id  BIGINT REFERENCES app_users(user_id) ON DELETE SET NULL,
    action         TEXT NOT NULL,
    resource_type  TEXT,
    resource_id    TEXT,
    channel        TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'agent', 'voice')),
    detail         JSONB NOT NULL DEFAULT '{}',
    correlation_id TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_actor ON audit_log (actor_user_id, created_at);
CREATE INDEX idx_audit_log_resource ON audit_log (resource_type, resource_id);

-- Static catalog seed ---------------------------------------------------------

INSERT INTO roles (role_key, label, experience) VALUES
    ('business_exec', 'Business Executive', 'business'),
    ('city_manager', 'City Manager', 'business'),
    ('store_manager', 'Store Manager', 'business'),
    ('category_manager', 'Category Manager', 'business'),
    ('leadership', 'Leadership', 'business'),
    ('ops_manager', 'Operations Manager', 'ops'),
    ('inventory_manager', 'Inventory Manager', 'ops'),
    ('admin', 'Administrator', 'ops');

INSERT INTO permissions (perm_key, description) VALUES
    ('kpi:read', 'Read headline KPIs and trends'),
    ('drill:store', 'Drill into store-level metrics'),
    ('drill:order', 'Drill into individual orders'),
    ('copilot:chat', 'Chat with the analytics copilot'),
    ('copilot:voice', 'Use the copilot by voice'),
    ('copilot:sql_tool', 'Let the copilot call the bounded read-only SQL tool'),
    ('proposal:create', 'Create action proposals'),
    ('proposal:approve:restock', 'Approve or reject restock proposals'),
    ('proposal:approve:ops', 'Approve or reject incident / ops-notification proposals'),
    ('proposal:approve:escalated', 'Approve or reject escalated proposals'),
    ('promo:draft', 'Draft promotions'),
    ('promo:publish', 'Publish promotions'),
    ('target:read', 'Read targets'),
    ('target:write', 'Set targets'),
    ('report:export', 'Export reports'),
    ('digest:subscribe', 'Subscribe to the daily digest'),
    ('alert:rule:write', 'Create or edit alert rules'),
    ('sql:execute', 'Run read-only SQL in the query console'),
    ('system:read', 'Read pipeline and system status'),
    ('user:manage', 'Manage users and roles'),
    ('audit:read', 'Read the audit log');

INSERT INTO role_permissions (role_key, perm_key) VALUES
    ('business_exec', 'kpi:read'),
    ('business_exec', 'drill:store'),
    ('business_exec', 'drill:order'),
    ('business_exec', 'copilot:chat'),
    ('business_exec', 'copilot:voice'),
    ('business_exec', 'proposal:create'),
    ('business_exec', 'promo:draft'),
    ('business_exec', 'target:read'),
    ('business_exec', 'report:export'),
    ('business_exec', 'digest:subscribe'),
    ('business_exec', 'alert:rule:write'),
    ('city_manager', 'kpi:read'),
    ('city_manager', 'drill:store'),
    ('city_manager', 'drill:order'),
    ('city_manager', 'copilot:chat'),
    ('city_manager', 'copilot:voice'),
    ('city_manager', 'proposal:create'),
    ('city_manager', 'promo:draft'),
    ('city_manager', 'target:read'),
    ('city_manager', 'report:export'),
    ('city_manager', 'digest:subscribe'),
    ('store_manager', 'kpi:read'),
    ('store_manager', 'drill:store'),
    ('store_manager', 'drill:order'),
    ('store_manager', 'copilot:chat'),
    ('store_manager', 'copilot:voice'),
    ('store_manager', 'proposal:create'),
    ('store_manager', 'target:read'),
    ('store_manager', 'digest:subscribe'),
    ('category_manager', 'kpi:read'),
    ('category_manager', 'drill:store'),
    ('category_manager', 'drill:order'),
    ('category_manager', 'copilot:chat'),
    ('category_manager', 'copilot:voice'),
    ('category_manager', 'proposal:create'),
    ('category_manager', 'promo:draft'),
    ('category_manager', 'promo:publish'),
    ('category_manager', 'target:read'),
    ('category_manager', 'report:export'),
    ('category_manager', 'digest:subscribe'),
    ('leadership', 'kpi:read'),
    ('leadership', 'drill:store'),
    ('leadership', 'copilot:chat'),
    ('leadership', 'copilot:voice'),
    ('leadership', 'proposal:approve:escalated'),
    ('leadership', 'target:read'),
    ('leadership', 'target:write'),
    ('leadership', 'report:export'),
    ('leadership', 'digest:subscribe'),
    ('leadership', 'alert:rule:write'),
    ('ops_manager', 'kpi:read'),
    ('ops_manager', 'drill:store'),
    ('ops_manager', 'drill:order'),
    ('ops_manager', 'copilot:chat'),
    ('ops_manager', 'copilot:sql_tool'),
    ('ops_manager', 'proposal:create'),
    ('ops_manager', 'proposal:approve:ops'),
    ('ops_manager', 'alert:rule:write'),
    ('ops_manager', 'sql:execute'),
    ('ops_manager', 'system:read'),
    ('inventory_manager', 'kpi:read'),
    ('inventory_manager', 'drill:store'),
    ('inventory_manager', 'drill:order'),
    ('inventory_manager', 'copilot:chat'),
    ('inventory_manager', 'copilot:sql_tool'),
    ('inventory_manager', 'proposal:create'),
    ('inventory_manager', 'proposal:approve:restock'),
    ('inventory_manager', 'sql:execute'),
    ('inventory_manager', 'system:read'),
    ('admin', 'kpi:read'),
    ('admin', 'drill:store'),
    ('admin', 'drill:order'),
    ('admin', 'copilot:chat'),
    ('admin', 'copilot:sql_tool'),
    ('admin', 'proposal:create'),
    ('admin', 'target:read'),
    ('admin', 'sql:execute'),
    ('admin', 'system:read'),
    ('admin', 'user:manage'),
    ('admin', 'audit:read');

