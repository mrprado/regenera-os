// Two permission models that are never merged (docs/data/DATA_GOVERNANCE.md). Open institutional data (WRI, World
// Bank, NASA…) is governed by licence, attribution, redistribution and source integrity. Indigenous and traditional
// knowledge, oral history and sacred or cultural knowledge is governed by its community: custodian, consent,
// authorized use, commercial and publication permission, attribution, benefit-sharing and revocation. Governed
// knowledge lives in the community module (db/community.ts) and never enters the dataset registry, search, Ask the
// OS or the MCP server.
export const KNOWLEDGE_VS_OPEN = [
  { title: "Open data governance", items: ["Licence", "Attribution", "Redistribution", "Source integrity (original kept, never overwritten by AI)"] },
  { title: "Knowledge governance (community-held)", items: ["Community and custodian", "Consent", "Authorized use", "Commercial-use permission", "Publication permission", "Attribution", "Benefit-sharing", "Revocation"] },
] as const;
