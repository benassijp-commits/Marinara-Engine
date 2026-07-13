# Narrative Director — single-lorebook transport

## Result

The v2 project now uses one chat-scoped transport lorebook shared by the two fixed agents. The optional public lorebook remains separate. No Marinara core file was changed.

Two enabled technical entries coexist in that lorebook:

- `__ND_DIRECTOR_PROJECT_V2__` contains the complete compact project document;
- `__ND_TRACKER_PROJECT_V2__` contains only the sanitized observable tracking plan.

Both fixed agents use `search_lorebook` with their exact sentinel name. The entries use `(?!)` as their only regular-expression activation key, which can never match roleplay text. They are non-constant, excluded from vectorization, non-recursive and have no secondary activation mechanisms.

The transport lorebook is linked by `chatId` and specific chat scope but kept out of `activeLorebookIds`. This allows the standard agent search tool to find it without making it a default Knowledge Router source. It must not be manually selected as a Knowledge Router source.

## Preserved concepts

- Character focus and World / ensemble import modes;
- atomic Public, Private and Uncertain review;
- native card fields and deterministic public-resource compilation;
- character knowledge matrix and per-character secret knowledge;
- adaptive arcs and optional candidate beats;
- gradual secret layers;
- conservative `abandoned` semantics;
- strict protection of `{{user}}` agency;
- Director as scene architect, never narrator;
- tracker limited to observable facts, IDs, evidence, blockers and confidence;
- seven existing `nd_*` runtime fields;
- chronological initialization and exact resume cursor;
- fixed agents, manually imported and configured by the user.

## Privacy and token boundary

Disabled entries cannot be returned by standard `search_lorebook`, so the transport entries remain enabled behind an impossible regex key. This prevents activation by the ordinary scanner under the current contract, but does not hide content from a local administrator, API access or agent debug traces.

Each agent retrieves one entry per run. The tracker entry is deliberately minimal. The Director document stores the structured project once, as compact JSON, instead of duplicating its largest fields.

## Manual validation still required

1. Update/reimport the fixed-agent preset and assign tool-capable connections.
2. Synchronize a fictional project and verify that exactly one lorebook contains both sentinel entries.
3. Generate roleplay with diagnostics enabled and confirm each agent calls only its own sentinel.
4. Inspect the assembled main-model prompt and confirm neither sentinel entry appears as normal lorebook context.
5. Disable diagnostics afterward because tool results can contain private content.
