# Swarm fan-out is single-harness for v1

A **Swarm** fans one composer submission out to N parallel **Contender**
runs (`{model, reasoning?}` per slot, shared prompt/harness/mode). v1
deliberately keeps all contenders on the *same* harness; per-slot harness
variation (e.g. racing cursor against opencode) is deferred.

## Why this scope boundary

- **The opencode regression guard.** `agents.ts:295ff` deliberately avoids
  ACP `set_config_option("model")` on harnesses that expose model as a config
  option (opencode, codex), because on opencode 1.15.x that call corrupts the
  session. Per-slot harness fans-out would force mixing this guarded path
  with the native `set_model` path inside one ensemble, doubling the surface
  where a harness mismatch can sink the whole comparison with a misleading
  `-32603`.
- **`spawn_agent` assumes one harness shape.** The native I/O boundary
  spawns one binary per process; a cross-harness ensemble means each
  contender spawns a *different* binary with different ACP capabilities
  (mode axes, reasoning axes, probe behaviour). Validating capability
  parity across contenders before spawn is real work we don't need in v1.
- **The user's framing is models, not harnesses.** "Parallel work on different
  models" maps cleanly to same-harness, different-model-id racing;
  cross-harness comparison is a related but separable feature and can ship
  later without reshaping the ensemble entity — it's an additive axis.
- **Real trade-off, reversible.** The boundary is easy to *loosen* later
  (lifted into a per-slot `harness` field once the opencode guard is
  resolved upstream). We are scoping v1 to the highest-value, lowest-risk
  axis.

## Consequence

The `Contender` type carries `model` and an optional `reasoning` only;
`harness` (and the prompt/mode/selection) is intentionally a property of the
**Swarm**, not the contender.
Per-flow `resolveModel` (flows.ts:74) gains a new most-specific tier (explicit
contender pick > per-flow override > global default) and must reconcile each
contender's model/reasoning against the single active harness's probed lists
the same way `refreshModels` reconciles global picks.
