# Documents

- **Registry** (/documents): every document is a record pointing to where it lives (Drive, data room), with category,
  version, status (draft → executed/superseded), confidentiality, owner, project, counterparty, effective and expiry
  dates. New versions supersede; nothing is overwritten. Uploads to R2 arrive when R2 is enabled.
- **Agreement register** (/contracts): every agreement type with key terms, lifecycle, executed lock, amendments and
  obligations (with evidence, recurrence and alerts on Today). docs/contracts-model.md.
- **Generator** (/documents/generator): 27 template types (NDAs, engagement letters, scopes, referral and introducer
  agreements, MOU, collaboration, SOW, data room access, qualification attestation, conflict disclosure, information
  request, LOI, term sheet, meeting memo, teaser, investment memo) and data-driven reports (project brief, site
  intelligence, capital pathway, systems assessment, monthly update, commission statement). Empty fields render
  [TO CONFIRM]. Legal templates start "DRAFT — COUNSEL REVIEW REQUIRED" with a PDF watermark until an owner records
  the named counsel's approval. Versions are kept. Output: branded PDF (pdf-lib) and DOCX (fflate).
- **Signature**: provider interface; mock provider for development (nothing is sent; each signature is recorded);
  DocuSign and Dropbox Sign adapters report "credential required"; recording the signed PDF link always works.
- **Data rooms** (/portals → Data rooms): folders, NDA gate with versioned undertakings, grants, per-document open and
  denial log. docs/PORTALS.md.
- **Requests**: document requests to sponsors and partners through their portals, with review.
