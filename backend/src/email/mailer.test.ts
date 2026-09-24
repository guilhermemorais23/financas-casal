import { describe, expect, it } from "vitest";
import { escapeHtml } from "./mailer";

describe("escapeHtml", () => {
  it("keeps typed feedback from becoming markup in the email", () => {
    expect(escapeHtml(`<img src=x onerror="alert('oi')"> & tal`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;oi&#39;)&quot;&gt; &amp; tal"
    );
  });
});
