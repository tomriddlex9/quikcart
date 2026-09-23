# QuickCart — Testing Strategy and Acceptance Gates

The project is not complete when code exists. A phase is complete when its observable behavior is tested.

---

# 1. Test layers

## Unit tests

Test pure logic quickly:

- simulator functions
- business calculations
- validation rules
- Spark transformation functions on tiny DataFrames
- feature builders
- RAG chunking
- agent routing helpers

## Contract tests

Validate:

- event envelopes
- API request/response schemas
- topic payloads
- Gold table schemas
- ML prediction schemas

## Integration tests

Validate boundaries:

- Python ↔ PostgreSQL
- Spark ↔ Delta
- Spark ↔ object storage
- producer ↔ Redpanda
- Debezium ↔ PostgreSQL ↔ broker
- MLflow tracking
- Qdrant indexing/search
- FastAPI routes

## End-to-end tests

Use small data only.

Validate a complete business flow.

---

# 2. Global quality gates

Before every merge/milestone:

```text
Ruff check passes
Pytest passes
No committed secrets
No generated large datasets in Git
README/run instructions updated
Current phase acceptance checks pass
```

---

# 3. Phase acceptance tests

## Phase 0

- [ ] Python environment installs from lockfile
- [ ] unit test runner works
- [ ] lint passes
- [ ] Docker Compose validates

## Phase 1

- [ ] PostgreSQL health check passes
- [ ] schema initialization is repeatable on empty DB
- [ ] seed 42 is deterministic
- [ ] generated orders preserve foreign keys
- [ ] completed delivery times are logically ordered
- [ ] generated data exhibits intended demand/delay relationships in aggregate

## Phase 2

- [ ] 30 SQL queries execute
- [ ] at least 10 use joins/aggregations
- [ ] at least 10 use intermediate constructs
- [ ] advanced set demonstrates windows/CTEs/time logic
- [ ] metric assumptions are documented

## Phase 3

- [ ] Spark starts under test configuration
- [ ] raw CSV parses with explicit schema
- [ ] JSON nested payload parses
- [ ] joins/aggregations produce expected fixtures
- [ ] execution plan can be captured

## Phase 4

- [ ] Bronze contains raw payload + metadata
- [ ] Silver casts and normalizes correctly
- [ ] invalid fixture reaches quarantine
- [ ] Gold metrics match independent expected values on fixture
- [ ] rerun does not duplicate deterministic dataset

## Phase 5

- [ ] duplicate event removed exactly once
- [ ] unknown foreign key quarantined
- [ ] SCD2 closes old record and opens new record
- [ ] MERGE inserts new business key
- [ ] MERGE updates existing key
- [ ] optimization examples produce explainable plan differences

## Phase 6

- [ ] Delta table writable/readable through S3-compatible endpoint
- [ ] same business pipeline passes using storage backend switch

## Phase 7

- [ ] producer publishes schema-valid event
- [ ] Spark reads event
- [ ] checkpoint restart resumes
- [ ] duplicate/replayed event does not double count
- [ ] late-event fixture follows documented policy

## Phase 8

- [ ] PostgreSQL insert captured
- [ ] update captured
- [ ] deletion policy captured
- [ ] CDC event lands in Bronze
- [ ] Silver current-state table reflects change

## Phase 9

- [ ] DAG imports cleanly
- [ ] DAG success path works
- [ ] intentional quality failure blocks dependent publish task
- [ ] retry behavior visible

## Phase 10

- [ ] dashboard KPIs match direct Gold queries
- [ ] filters do not alter definitions incorrectly
- [ ] empty state is handled

## Phase 11

- [ ] baseline model tracked
- [ ] stronger candidate tracked
- [ ] split strategy prevents obvious future leakage
- [ ] prediction table includes model version and timestamp
- [ ] forecast evaluation is time-aware

## Phase 12

- [ ] document ingestion idempotent
- [ ] retrieval returns expected document for evaluation queries
- [ ] missing-answer query does not fabricate internal policy
- [ ] result includes source metadata

## Phase 13

- [ ] analytics question chooses SQL/analytics tool
- [ ] policy question chooses RAG
- [ ] prediction question chooses ML
- [ ] mixed question can use multiple tools
- [ ] mutating SQL request rejected
- [ ] max-step loop enforced
- [ ] oversized SQL result limited

## Phase 14

- [ ] proposal can be created without executing
- [ ] proposal validation runs
- [ ] unapproved proposal cannot execute
- [ ] approved valid proposal executes simulated action
- [ ] rejected proposal remains non-executed
- [ ] audit history records state transition

## Phase 15

- [ ] CI passes on clean branch
- [ ] full smoke run documented
- [ ] monitoring optional profile starts
- [ ] final end-to-end demo succeeds

---

# 4. Data-quality test design

Each Silver domain should use fixture rows covering:

```text
valid record
null required field
type mismatch
unknown enum
duplicate key
unknown FK
out-of-range numeric
invalid timestamp
```

Tests must assert not only that invalid rows disappear from Silver but that they appear in the expected quarantine output.

---

# 5. Spark test principles

- Keep unit DataFrames tiny.
- Do not benchmark inside ordinary unit tests.
- Separate performance experiments from correctness tests.
- Avoid `collect()` on unknown-size production data; test collection is fine for tiny fixtures.
- Verify schemas as well as row values.

---

# 6. ML evaluation gates

No fixed metric threshold is required before seeing realistic synthetic signal, but each model must beat or meaningfully compare to a documented baseline.

A model with a high metric but obvious leakage fails acceptance.

Required deliverables per model:

- problem statement
- dataset window
- features
- target
- baseline
- split strategy
- metrics
- error analysis
- leakage review
- model version
- known limitations

---

# 7. RAG evaluation gates

Build an evaluation table:

```text
question_id
question
expected_doc
expected_section optional
must_answer boolean
```

Measure retrieval separately from generation.

Minimum qualitative checks:

- correct policy retrieved
- stale/wrong policy not preferred when metadata supports recency
- unsupported question acknowledged

---

# 8. Agent evaluation gates

Build an evaluation suite with categories:

### Tool routing

Expected tool(s) for question.

### Grounding

Does answer use returned facts rather than invented values?

### Safety

Does the agent refuse/redirect unsupported mutation path and create proposal instead?

### Resilience

What happens when:

- SQL tool errors
- RAG has no hit
- ML prediction unavailable
- user asks ambiguous store name

The agent should degrade transparently, not fabricate.

---

# 9. Final end-to-end acceptance scenario

Use one scripted scenario:

## Setup

- seed known deterministic dataset
- start streaming/CDC profiles
- build current Gold

## Trigger

Create a peak-demand + low-rider-capacity scenario for a selected store.

## Expected

1. source records/events generated
2. Bronze ingestion visible
3. Silver clean state visible
4. Gold metric shows deterioration
5. delay model emits increased risk
6. dashboard surfaces warning
7. agent explains drivers using real metrics/prediction
8. user asks for response
9. agent creates bounded proposal
10. user approves
11. simulated action executes
12. audit trail records outcome

The final demo should be scriptable/repeatable, not dependent on luck from random generation.
