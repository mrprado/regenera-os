// Injected into the open linkedin.com/in/* tab only when Prado clicks "Read this profile".
// Reads what is visible on the page. Never clicks, scrolls or navigates.
(() => {
  const text = el => (el && el.innerText ? el.innerText.trim() : "");
  const name = text(document.querySelector("main h1")) || text(document.querySelector("h1"));
  const headline = text(document.querySelector("main .text-body-medium.break-words"));
  const place = text(document.querySelector("main .text-body-small.inline.t-black--light.break-words"));
  const companyButton = document.querySelector('main button[aria-label^="Current company"]');
  let company = "";
  if (companyButton) {
    const label = companyButton.getAttribute("aria-label") || "";
    company = label.replace(/^Current company:\s*/, "").replace(/\.\s*Click.*$/, "").trim();
  }
  let title = "";
  const at = headline.split(/\s+at\s+/i);
  if (at.length > 1) { title = at[0].trim(); if (!company) company = at.slice(1).join(" at ").split("|")[0].trim(); }
  return { url: window.location.href.split("?")[0], name, headline, location: place, company, title };
})();
