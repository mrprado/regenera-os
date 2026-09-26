# Data model (index)

Source of truth: `db/*.ts` (Drizzle), exported by `db/schema.ts`; migrations `drizzle/0000`–`0024`. Detailed notes:
docs/data-model.md, docs/capital-model.md, docs/private-capital-model.md, docs/regulatory-model.md,
docs/contracts-model.md, docs/engineering-model.md, docs/materials-model.md.

| File | Tables |
|---|---|
| db/schema.ts | mandates (entities), mandate_members, audit_log, oauth_accounts, jobs, job_schedules, system_state |
| db/crm.ts | organizations, contacts, deals (opportunities), activities, messages, triggers, signals, lists, partners, prompts, ai_runs, provider_calls, source_cache … |
| db/automation.ts | sequences, enrollments, replies, tasks, relationships (mailbox), meeting briefs |
| db/projects.ts | projects, project_parties, project_readiness, constraints, project_stage_history, capital_requirements, capital_tranches, risks |
| db/capital.ts | capital_profiles, capital_mandates, private_capital_profiles, investor_qualifications, capital_opportunities, capital_matches, commitments, material_deliveries, introductions, debt_securities |
| db/contracts.ts | contracts, contract_versions, contract_parties, contract_obligations, documents, document_links |
| db/regulatory.ts | project_jurisdictions, requirements, permits, regulatory_reviews, kyc_checks |
| db/integrations.ts | integrations, sources, place_facts, verifications |
| db/delivery.ts | project_milestones, decisions, studies, design_packages, engineering_requirements, es_issues, insurance_policies |
| db/economics.ts | revenue_streams, economic_cases |
| db/procurement.ts | epds, boq_items, procurement_packages, bids, network_profiles |
| db/portal.ts | portal_users, portal_invites, portal_sessions, portal_grants, portal_access_log, portal_messages, document_requests, project_updates, data_rooms, data_room_documents, nda_acceptances, distribution_approvals, broker_profiles, referral_registrations, referral_agreements, commission_schedules, commission_events, intake_submissions |
| db/playbooks.ts | playbooks, playbook_versions, playbook_runs, playbook_corrections |
| db/evidence.ts | claims, claim_evidence |
| db/systems.ts | system_assessments, interventions |
| db/events.ts | events, trigger_rules, notifications, notification_mutes, stage_gates |
| db/spatial.ts | spatial_layers |
| db/generated.ts | generated_documents, esign_envelopes |
| db/graph.ts | relationship_edges |
| db/funding.ts, db/radar.ts, db/intel.ts, db/auth.ts | funding, radar, intelligence, MCP, auth sessions |

Conventions: UUID text ids; `mandate_id` on entity data; ISO timestamps; JSON columns typed in Drizzle; demo data in
the `mandate_demo` entity (and `is_demo` on portal users, data rooms, spatial layers).
