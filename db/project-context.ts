import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
import {projects} from './projects';
const now=sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
export const contextRecords=sqliteTable('project_context_records',{
 id:text('id').primaryKey().$defaultFn(()=>crypto.randomUUID()),mandateId:text('mandate_id').notNull(),projectId:text('project_id').notNull().references(()=>projects.id),
 kind:text('kind',{enum:['memory','readiness','scenario','mission','ledger','agent_run','land_pathway','development_stage','development_milestone','development_partnership','funding_tranche','value_creation','transition_site','infrastructure_reuse','interface_finding','public_metric','monetization']}).notNull(),title:text('title').notNull(),
 data:text('data',{mode:'json'}).$type<Record<string,unknown>>().notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull().default(now),
},t=>[index('context_project_kind').on(t.mandateId,t.projectId,t.kind)]);
export const contextEdges=sqliteTable('project_context_edges',{
 id:text('id').primaryKey().$defaultFn(()=>crypto.randomUUID()),mandateId:text('mandate_id').notNull(),projectId:text('project_id').notNull().references(()=>projects.id),
 sourceType:text('source_type').notNull(),sourceId:text('source_id').notNull(),predicate:text('predicate').notNull(),targetType:text('target_type').notNull(),targetId:text('target_id').notNull(),evidenceId:text('evidence_id'),createdAt:text('created_at').notNull().default(now),
},t=>[index('context_edges_project').on(t.mandateId,t.projectId)]);
export const reportingPeriods=sqliteTable('reporting_periods',{
 id:text('id').primaryKey().$defaultFn(()=>crypto.randomUUID()),mandateId:text('mandate_id').notNull(),projectId:text('project_id').notNull().references(()=>projects.id),name:text('name').notNull(),
 cadence:text('cadence',{enum:['weekly','monthly','quarterly']}).notNull(),state:text('state',{enum:['OPEN','REVIEW','EXCEPTIONS','APPROVED','CLOSED','REOPENED']}).notNull().default('OPEN'),
 revision:integer('revision').notNull().default(0),updatedAt:text('updated_at').notNull().default(now),
},t=>[index('reporting_project').on(t.mandateId,t.projectId)]);
export const reportingSnapshots=sqliteTable('reporting_snapshots',{
 id:text('id').primaryKey().$defaultFn(()=>crypto.randomUUID()),periodId:text('period_id').notNull().references(()=>reportingPeriods.id),mandateId:text('mandate_id').notNull(),projectId:text('project_id').notNull(),revision:integer('revision').notNull(),
 body:text('body',{mode:'json'}).$type<Record<string,unknown>>().notNull(),approvedBy:text('approved_by').notNull(),createdAt:text('created_at').notNull().default(now),
},t=>[uniqueIndex('reporting_snapshot_period').on(t.periodId,t.revision)]);
