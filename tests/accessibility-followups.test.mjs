import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("accessibility follow-ups", () => {
  it("exposes listing variant choices as accessible radio groups", () => {
    const selector = source("src/components/VariantSelector.tsx");
    assert.match(selector, /role="radiogroup"/);
    assert.match(selector, /aria-labelledby=\{`\$\{baseId\}-\$\{group\.id\}-label`\}/);
    assert.match(selector, /role="radio"/);
    assert.match(selector, /aria-checked=\{isSelected\}/);
    assert.match(selector, /aria-disabled=\{!opt\.inStock\}/);
    assert.match(selector, /ArrowRight/);
    assert.match(selector, /ArrowLeft/);
    assert.match(selector, /Home/);
    assert.match(selector, /End/);
  });

  it("associates open-case fields and errors with form controls", () => {
    const form = source("src/components/OpenCaseForm.tsx");
    assert.match(form, /htmlFor=\{reasonId\}/);
    assert.match(form, /id=\{reasonId\}/);
    assert.match(form, /htmlFor=\{descriptionId\}/);
    assert.match(form, /id=\{descriptionId\}/);
    assert.match(form, /aria-describedby=\{`\$\{descriptionHelpId\}/);
    assert.match(form, /aria-invalid=\{Boolean\(error\)\}/);
    assert.match(form, /role="alert"/);
  });

  it("connects checkout address validation errors to their inputs", () => {
    const form = source("src/components/ShippingAddressForm.tsx");
    for (const id of ["sa-name", "sa-line1", "sa-city", "sa-state", "sa-zip"]) {
      assert.match(form, new RegExp(`aria-describedby=\\{errors\\.[a-zA-Z0-9]+ \\? "${id}-error"`));
      assert.match(form, new RegExp(`id="${id}-error"`));
    }
    assert.match(form, /aria-invalid=\{Boolean\(errors\.name\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.line1\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.city\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.state\)\}/);
    assert.match(form, /aria-invalid=\{Boolean\(errors\.postalCode\)\}/);
    assert.match(form, /role="alert"/);
  });

  it("keeps the image crop modal a real dialog with focus and scroll management", () => {
    const modal = source("src/components/ImageCropModal.tsx");
    assert.match(modal, /useDialogFocus\(mounted, dialogRef, onCancel\)/);
    assert.match(modal, /useBodyScrollLock\(mounted\)/);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-modal="true"/);
    assert.match(modal, /aria-labelledby=\{titleId\}/);
    assert.match(modal, /tabIndex=\{-1\}/);
  });

  it("labels interactive map canvases and exposes text alternatives", () => {
    assert.match(source("src/components/AllSellersMap.tsx"), /role="application"/);
    assert.match(source("src/components/AllSellersMap.tsx"), /aria-label="Map of Grainline makers"/);
    assert.match(source("src/components/AllSellersMap.tsx"), /className="sr-only"/);
    assert.match(source("src/components/MaplibreMap.tsx"), /aria-label="Map showing this location"/);
    assert.match(source("src/components/LocationPicker.tsx"), /aria-label="Map picker for pickup location"/);
    assert.match(source("src/components/MapCard.tsx"), /aria-label=\{label \? `Map showing \$\{label\}` : "Map preview"\}/);
    assert.match(source("src/components/SellersMap.tsx"), /aria-label="Map of Grainline sellers"/);
  });
});
