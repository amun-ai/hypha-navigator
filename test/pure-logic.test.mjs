/**
 * Pure-logic tests for the leaf shared modules (no Chrome APIs). Node 24 strips
 * TypeScript types on import, so we import the .ts sources directly — these
 * modules have no relative imports, so no .js→.ts resolution is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { wrapFn } from "../src/shared/utils/wrap-fn.ts";
import { buildAgentInstruction } from "../src/shared/relay/instruction.ts";
import { buildServiceUrl, randomHex } from "../src/shared/relay/service-url.ts";
import { generateSkillMd } from "../src/shared/services/skill.ts";

test("wrapFn maps a kwargs object to positional args in SCHEMA PROPERTY ORDER", async () => {
  const fn = (...args) => args;
  fn.__schema__ = {
    name: "demo",
    parameters: {
      type: "object",
      properties: { origin: {}, name: {}, description: {}, content: {} },
    },
  };
  const wrapped = wrapFn(fn);

  // kwargs intentionally OUT of order — must be reordered to schema order.
  const out = await wrapped({ content: "C", origin: "O", description: "D", name: "N" });
  assert.deepEqual(out, ["O", "N", "D", "C"]);

  // toString must expose the unminified param names for hypha-rpc.
  assert.equal(wrapped.toString(), "function (origin, name, description, content) {}");
  assert.equal(wrapped.length, 4);
});

test("wrapFn forwards positional args unchanged and handles empty kwargs", async () => {
  const fn = (a, b) => [a, b];
  fn.__schema__ = { parameters: { properties: { a: {}, b: {} } } };
  const wrapped = wrapFn(fn);
  assert.deepEqual(await wrapped("x", "y"), ["x", "y"]); // positional passthrough
  // {} → call with no args (so defaults apply)
  const fn2 = (a = "def") => a;
  fn2.__schema__ = { parameters: { properties: { a: {} } } };
  assert.equal(await wrapFn(fn2)({}), "def");
});

test("buildAgentInstruction is rebranded to Hypha Navigator and points at get_skill_md", () => {
  const s = buildAgentInstruction("https://hypha.example/svc", {
    subject: "a web browser",
  });
  assert.match(s, /Hypha Navigator is attached to a web browser/);
  assert.match(s, /https:\/\/hypha\.example\/svc\/get_skill_md/);
  assert.doesNotMatch(s, /Hypha debugger|Hypha Debugger/);
});

test("buildAgentInstruction includes the auth header when a token is given", () => {
  const s = buildAgentInstruction("https://x/svc", { token: "tok123" });
  assert.match(s, /Authorization: Bearer tok123/);
});

test("buildServiceUrl + randomHex produce a well-formed service URL", () => {
  const url = buildServiceUrl("https://hypha.aicell.io", "ws/my-service-id");
  assert.match(url, /^https:\/\/hypha\.aicell\.io\//);
  assert.match(url, /my-service-id/);
  const hex = randomHex(16); // 16 bytes → 32 hex chars
  assert.equal(hex.length, 32);
  assert.match(hex, /^[0-9a-f]+$/);
  assert.equal(randomHex(8).length, 16);
});

test("generateSkillMd is rebranded (no 'debugger' brand in frontmatter/intro)", () => {
  const fns = {
    execute_script: {
      __schema__: {
        name: "execute_script",
        description: "Run JS.",
        parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      },
    },
  };
  const md = generateSkillMd(fns, "{SERVICE_URL}", undefined, "GUIDANCE-MARKER");
  assert.match(md, /name: web-navigator/);
  assert.match(md, /author: "hypha-navigator"/);
  assert.match(md, /Hypha Navigator/);
  assert.match(md, /GUIDANCE-MARKER/); // guidance is injected
  assert.match(md, /execute_script/); // tool docs rendered
  // No leftover old-brand identifiers in the generated doc.
  assert.doesNotMatch(md, /web-debugger|Hypha Debugger|"hypha-debugger"/);
});
