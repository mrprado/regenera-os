# Project lifecycle

Vocabulary: lib/projects/vocab.ts. Engine: lib/projects/engine.ts.

**Stages (18):** Opportunity, Screening, Diagnostic, Project readiness, Development, Structuring, Capital alignment,
Diligence, Financial close, Engineering, Procurement, Construction, Commissioning, COD, Operations, Repowering, Exit,
Decommissioning. The Pipeline board groups them into Origination, Development, Capital, Execution and Operations.
Every move is recorded in `project_stage_history` with a reason; moves in the last 7 days appear on Today.

**Status** (separate from stage): Active, On hold, Dropped, Operating.

**Readiness (14 dimensions):** land, technical, engineering, environmental, permitting, grid/interconnection,
commercial, financial, capital, legal, stakeholder, procurement, construction, operations. Statuses: Unknown, Not
started, Early, In progress, Substantially ready, Ready, Blocked, Not applicable. A new project starts with every
dimension Unknown. There is no overall score: the spec forbids fake precision.

**Constraints:** category (25), severity (low, medium, high, critical), evidence, owner, resolution action, deadline,
dependency, status (open, in progress, resolved, accepted risk). Today shows open high/critical constraints, overdue
ones and Blocked readiness dimensions.

**From opportunity to project:** "Create project" on an opportunity creates the project, links the opportunity to it
and proposes the opportunity's organization as sponsor (to confirm). Nothing is converted automatically.
