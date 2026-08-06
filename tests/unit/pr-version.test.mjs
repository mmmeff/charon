import assert from "node:assert/strict";
import test from "node:test";

import {
  currentPrVersionValue,
  prVersionKey,
} from "../../src/lib/pr-version.ts";

const selected = {
  number: 42,
  headSha: "head-current",
};

test("pull request data keys include the number and head SHA", () => {
  assert.equal(
    prVersionKey(selected),
    "42:head-current",
  );
});

test("pull request data never crosses a number or head SHA boundary", () => {
  const loaded = {
    key: prVersionKey(selected),
    value: {
      files: ["src/current.ts"],
    },
  };

  assert.deepEqual(
    currentPrVersionValue(loaded, selected),
    loaded.value,
  );
  assert.equal(
    currentPrVersionValue(loaded, {
      ...selected,
      number: 43,
    }),
    null,
  );
  assert.equal(
    currentPrVersionValue(loaded, {
      ...selected,
      headSha: "head-next",
    }),
    null,
  );
});
