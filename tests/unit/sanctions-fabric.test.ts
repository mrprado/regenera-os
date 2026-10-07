import { describe, expect, it } from "vitest";
import { assess } from "@/lib/diligence/matches";
import { nearbyAssets, normalizeReverse, normalizeSoil } from "@/lib/fabric/adapters";
import { activePacks, packFor } from "@/lib/fabric/packs";
import { answer, QUESTIONS } from "@/lib/fabric/questions";
import { SOURCE_META, sourceRecords } from "@/lib/fabric/sources";
import { INTEGRATIONS } from "@/lib/integrations/registry";
import { indexEntries, matchName } from "@/lib/sanctions/match";
import { CsvStream, EntrySet, HeaderCsv, ofacAliases, ofacPrimary, ukPick, unXml } from "@/lib/sanctions/parse";

describe("streaming CSV", () => {
  it("parses quotes, doubled quotes and newlines across arbitrary chunk boundaries", () => {
    const text = 'a,"b, ""quoted""",c\r\n1,"multi\nline",3\n';
    for (let size = 1; size <= text.length; size++) {
      const p = new CsvStream(); const rows: string[][] = [];
      for (let i = 0; i < text.length; i += size) rows.push(...p.push(text.slice(i, i + size)));
      rows.push(...p.end());
      expect(rows, `chunk ${size}`).toEqual([["a", 'b, "quoted"', "c"], ["1", "multi\nline", "3"]]);
    }
  });
});

describe("sanctions list parsers", () => {
  it("OFAC SDN + aliases share the entry id, kind and programme", () => {
    const set = new EntrySet(), meta = new Map<string, [string, string]>();
    ofacPrimary(new CsvStream().push('306,"BANCO NACIONAL DE CUBA",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"a.k.a. \'BNC\'."\n7,"DOE, John",individual,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- \n'), set, meta);
    ofacAliases(new CsvStream().push('306,220,"aka","NATIONAL BANK OF CUBA",-0- \n'), set, meta);
    expect(set.entries).toEqual([["SDN-306", "BANCO NACIONAL DE CUBA", "entity", "CUBA", ""], ["SDN-7", "DOE, John", "individual", "SDGT", ""], ["SDN-306", "NATIONAL BANK OF CUBA", "entity", "CUBA", ""]]);
  });
  it("UK list: finds the header after the report-date line and joins name parts", () => {
    const set = new EntrySet(); const h = new HeaderCsv("Unique ID", ukPick, set);
    h.rows(new CsvStream().push("Report Date: 07-Oct-2026\nLast Updated,Unique ID,Name 6,Name 1,Name type,Regime Name,Designation Type,Address Country\n04/08/2026,RUS0001,PETROV,Ivan,Primary Name,Russia,Individual,Russia\n04/08/2026,RUS0001,PETROV,Ivan,Primary Name,Russia,Individual,Russia\n"));
    expect(set.entries).toEqual([["UK-RUS0001", "Ivan PETROV", "individual", "Russia", "Russia"]]);
  });
  it("UN XML: individuals and entities with aliases", () => {
    const set = new EntrySet();
    unXml("<CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER><NATIONALITY><VALUE>DR Congo</VALUE></NATIONALITY></INDIVIDUAL></INDIVIDUALS><ENTITIES><ENTITY><FIRST_NAME>ADF</FIRST_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER><ENTITY_ALIAS><ALIAS_NAME>Allied Democratic Forces</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES></CONSOLIDATED_LIST>", set);
    expect(set.entries.map(e => [e[0], e[1], e[2]])).toEqual([["UN-CDi.001", "ERIC BADEGE", "individual"], ["UN-CDe.001", "ADF", "entity"], ["UN-CDe.001", "Allied Democratic Forces", "entity"]]);
  });
});

describe("sanctions matching", () => {
  const idx = indexEntries("ofac", [["SDN-306", "BANCO NACIONAL DE CUBA", "entity", "CUBA", ""], ["SDN-9", "ACME TRADING LLC", "entity", "IRAN", ""], ["SDN-10", "ROSNEFT", "entity", "UKRAINE-EO13662", ""]]);
  it("exact after normalization; strong word overlap; single words only exact", () => {
    expect(matchName("Banco Nacional de Cuba, S.A.", idx)[0]).toMatchObject({ listId: "SDN-306", score: 1 });
    expect(matchName("Acme Trading", idx)[0]?.listId).toBe("SDN-9");
    expect(matchName("Rosneft", idx)[0]?.listId).toBe("SDN-10");
    expect(matchName("Acme", idx)).toEqual([]);
    expect(matchName("Regenera Development Office", idx)).toEqual([]);
  });
});

describe("data fabric", () => {
  it("every fabric overlay names a registered integration, and every integration gets a record", () => {
    const keys = new Set(INTEGRATIONS.map(i => i.key));
    for (const k of Object.keys(SOURCE_META)) expect(keys.has(k), k).toBe(true);
    expect(sourceRecords()).toHaveLength(INTEGRATIONS.length);
  });
  it("only freemium sources are switched on: non-commercial terms stay off", () => {
    for (const i of INTEGRATIONS.filter(x => x.commercialUse === "no")) expect(["license_required", "disabled", "development_only"], i.key).toContain(i.featureState);
  });
  it("country packs resolve ISO3, ISO2 and names; one per country with projects", () => {
    expect(packFor("MEX")?.key).toBe("mx");
    expect(packFor("United Kingdom")?.key).toBe("gb");
    expect(packFor("DEU")?.key).toBe("eu");
    expect(packFor("Kenya")).toBeNull();
    expect(activePacks(["MEX", "Mexico", "USA", null]).map(a => [a.pack.key, a.projects])).toEqual([["mx", 2], ["us", 1]]);
  });
  it("SoilGrids, Climate TRACE and reverse-geocode normalizers", () => {
    const soil = normalizeSoil({ properties: { layers: [{ name: "soc", unit_measure: { d_factor: 10, target_units: "g/kg" }, depths: [{ label: "0-5cm", values: { mean: 247 } }] }, { name: "clay", unit_measure: { d_factor: 10, target_units: "%" }, depths: [{ label: "0-5cm", values: { mean: null } }] }] } });
    expect(soil.map(s => [s.key, s.numeric])).toEqual([["soil_soc", 24.7]]);
    const near = nearbyAssets({ assets: [{ Id: 1, Name: "Plant A", Sector: "power", Centroid: { Geometry: [-102.5, 21.95] }, EmissionsSummary: [{ Gas: "co2e_100yr", EmissionsQuantity: 1000, Capacity: 50, CapacityUnits: "MW" }] }, { Id: 2, Name: "Far", Centroid: { Geometry: [-90, 15] } }] }, 21.9, -102.5, 50);
    expect(near).toHaveLength(1); expect(near[0]).toMatchObject({ name: "Plant A", capacity: "50 MW" });
    expect(normalizeReverse({ address: { county: "Jesús María", state: "Aguascalientes", "ISO3166-2-lvl4": "MX-AGU", country: "México", country_code: "mx" } })).toMatchObject({ county: "Jesús María", stateCode: "MX-AGU", countryCode: "MX" });
  });
  it("a question answers from stored facts with levels, verify sources and gaps", () => {
    const project = { id: "p", country: "MEX" } as never;
    const fact = (key: string, integrationKey: string) => ({ key, integrationKey, label: key, value: "x" }) as never;
    const a = answer("water_risk", project, [fact("aq_bws", "resource_watch"), fact("solar_ghi", "nasa_power"), fact("precip", "nasa_power")]);
    expect(a.facts.map(f => f.key)).toEqual(["aq_bws", "precip"]);
    expect(a.facts[0].level).toBe("L1");
    expect(a.verify.some(v => v.name === "CONAGUA")).toBe(true);
    expect(QUESTIONS.land_nature.caution).toMatch(/not evidence of absence/);
  });
});

describe("matching shows criteria, not a score", () => {
  it("lists met, failed and unknown criteria", () => {
    const p = { assetClass: "solar", technology: "PV", country: "MEX", capacity: 100, capacityUnit: "MW" } as never;
    const prof = { roles: ["epc"], assetClasses: ["solar"], technologies: "PV, BESS", jurisdictions: ["USA"], minProjectSize: 20, maxProjectSize: 300, bankable: true } as never;
    const c = assess(p, { id: "o", name: "EPC Co", country: "USA", sector: null }, prof, [], "epc");
    expect(c.met).toEqual(expect.arrayContaining(["Role: epc", "Asset class solar", "Technology PV", "Marked bankable / tier-1"]));
    expect(c.failed).toEqual(["Not present in MEX per profile"]);
    expect(c).not.toHaveProperty("score");
  });
});
