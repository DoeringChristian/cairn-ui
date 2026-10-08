"""Pydantic mirror of the card-spec single source of truth.

The authoritative definition lives in TypeScript
(``src/lib/cards/card-spec.ts``); ``npm run gen:card-schema``
derives ``docs/schemas/cairn-card-spec.schema.json`` from it. THIS module is
a hand-written pydantic v2 mirror of that JSON Schema, kept honest by
``tests/unit/test_card_spec_conformance.py`` (asserts the models match the
committed schema field-for-field, so the Python side can never silently
drift from TS).

The ``cairn.ui`` compare helpers (``compare.py``) build a :class:`CardSpec`
from these models and ``.model_dump()`` it into the spec a ``CardElement``
posts to the server for ``/embed/card`` to render. Python only ever *emits*
validated specs; it never parses markdown and never re-implements
``cardFromSpec``.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict

class _Strict(BaseModel):
    """Base for objects the schema marks ``additionalProperties: false``."""

    model_config = ConfigDict(extra="forbid")


__all__ = [
    "CARD_TYPES",
    "CardType",
    "SeriesRef",
    "CardSettingsSpec",
    "CardSpec",
    "FilterOperator",
    "FilterChipSpec",
    "FilterExprSpec",
    "FilterGroupSpec",
    "FilterNodeSpec",
    "GroupBySourceSpec",
    "GroupByParamSpec",
    "GroupByExprSpec",
    "GroupBySpec",
    "SortKeySpec",
    "RunSetSpec",
    "RunViewSpec",
    "CardsSpec",
    "ReportSpec",
]

# The canonical card-type vocabulary. Mirrors `CARD_TYPES` in
# src/lib/cards/card-spec.ts — the conformance test asserts this
# tuple equals the committed schema's CardType enum (same members, same
# order), so a card type added on the TS side without updating this fails CI.
CARD_TYPES: tuple[str, ...] = (
    # Per-metric "series" cards.
    "scalar",
    "image",
    "figure",
    "audio",
    "video",
    "histogram",
    "tensor",
    "text",
    "pointcloud",
    "mesh",
    "boxes3d",
    "volume",
    "preset",
    # A custom viewer (`settings.viewer`) over custom data or a built-in kind.
    "custom",
    # Workspace-level "multi-run" cards.
    "parallel",
    "scatter",
    "bar",
    "tile",
    "importance",
    "run-compare",
    "code-diff",
    "scalars",
    "config",
    # Renderer-only types (CardRenderer.tsx's object_type switch).
    "table",
    "html",
    "markdown",
    "artifact",
)

CardType = Literal[
    "scalar",
    "image",
    "figure",
    "audio",
    "video",
    "histogram",
    "tensor",
    "text",
    "pointcloud",
    "mesh",
    "boxes3d",
    "volume",
    "preset",
    "custom",
    "parallel",
    "scatter",
    "bar",
    "tile",
    "importance",
    "run-compare",
    "code-diff",
    "scalars",
    "config",
    "table",
    "html",
    "markdown",
    "artifact",
]


class SeriesRef(_Strict):
    """= ``ComparisonSeriesRef`` — one (run, metric) binding for a card."""

    runId: str
    name: str


class CardSettingsSpec(BaseModel):
    """Permissive per-card settings side-channel (a few well-known keys +
    arbitrary JSON), matching ``additionalProperties`` in the schema."""

    model_config = ConfigDict(extra="allow")

    version: Optional[int] = None
    yScale: Optional[Literal["linear", "log"]] = None
    smoothing: Optional[float] = None
    smoothingKind: Optional[Literal["ema", "twema", "gaussian", "window"]] = None
    step: Optional[float] = None
    # Scalar cards: the x-axis as an expression (``"step"``, ``"epoch"``, ``"step * 32"``).
    x: Optional[str] = None


class CardSpec(_Strict):
    """One card entry — id/type/series (= ``ComparisonCard``) + optional
    inline ``settings``."""

    id: str
    type: CardType
    series: list[SeriesRef]
    settings: Optional[CardSettingsSpec] = None


FilterOperator = Literal[
    "exact", "iexact", "gt", "gte", "lt", "lte", "in",
    "contains", "icontains", "startswith", "endswith", "isnull",
]


class FilterChipSpec(_Strict):
    """A runs-table filter chip: ``field op arg``."""

    kind: Literal["chip"]
    field: str
    op: FilterOperator
    arg: str


class FilterExprSpec(_Strict):
    kind: Literal["expr"]
    expr: str


class FilterGroupSpec(_Strict):
    kind: Literal["group"]
    op: Literal["and", "or"]
    children: list["FilterNodeSpec"]


FilterNodeSpec = Union[FilterChipSpec, FilterExprSpec, FilterGroupSpec]


class GroupBySourceSpec(_Strict):
    source: Literal["group", "job_type", "tag"]


class GroupByParamSpec(_Strict):
    source: Literal["param"]
    key: str


class GroupByExprSpec(_Strict):
    source: Literal["expr"]
    expr: str


GroupBySpec = Union[GroupBySourceSpec, GroupByParamSpec, GroupByExprSpec]


class SortKeySpec(_Strict):
    column: str
    direction: Literal["asc", "desc"]


class RunSetSpec(_Strict):
    """A run set (``RunSet`` in src/lib/run-sets.ts): the runs table state,
    frozen; its runs are resolved live."""

    name: Optional[str] = None
    filter: Optional[FilterGroupSpec] = None
    groupBy: Optional[list[GroupBySpec]] = None
    latestOnly: Optional[bool] = None
    sort: Optional[list[SortKeySpec]] = None
    eyes: Optional[dict[str, bool]] = None


class RunViewSpec(_Strict):
    """A cell's run view (mirrors ``RunView`` in lib/run-view.tsx)."""

    hidden: Optional[list[str]] = None
    pinned: Optional[list[str]] = None
    baseline: Optional[str] = None


class CardsSpec(_Strict):
    """The `````cairn`` dialect root — run sets + a list of cards."""

    id: Optional[str] = None
    runSets: Optional[list[RunSetSpec]] = None
    view: Optional[RunViewSpec] = None
    title: Optional[str] = None
    cards: Optional[list[CardSpec]] = None


class ReportSpec(_Strict):
    """The ``cairn.Report.publish()`` payload — canonical markdown ``source``
    plus create-route metadata (mirrors ``ReportCreate`` server-side)."""

    name: str
    source: str
    project: Optional[str] = None


FilterGroupSpec.model_rebuild()
