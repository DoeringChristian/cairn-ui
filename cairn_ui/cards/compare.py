"""cairn.ui.compare — build a cairn viewer comparison card from Python.

Each ``*_compare(...)`` resolves ``run[tag]`` sources into a schema-validated
:class:`~cairn.ui.card_spec.CardSpec` and returns a
:class:`~cairn.ui.elements.CardElement` — a live ``/embed/card`` iframe. These
render nothing themselves: the browser's card renderer does the work, which is
why they live here rather than in :mod:`cairn.plot`.

They need a reachable cairn server that is serving the viewer. Without one the
element degrades to an inline notice rather than raising.
"""

from __future__ import annotations

import json as _json
import uuid as _uuid
from typing import Any, Sequence

from cairn.sdk.reader import DataRef
from .spec import CardSettingsSpec, CardSpec, SeriesRef
from .elements import CardElement

__all__ = [
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
]


# ---------------------------------------------------------------------------
# Run-integration extras — the server-backed media-compare card helpers.
#
# Each `cairn.plot.*_compare(...)` resolves `run[tag]` sources to a validated
# `CardSpec` and returns a `CardElement` (a live `/embed/card` iframe). These
# stay cairn-only (they need the server); `cp.Compare` (the pure composable) is
# re-exported above for the pure/self-contained composable path.
# ---------------------------------------------------------------------------

def _resolve_series(data: Any, *, builder: str) -> tuple[SeriesRef, int | None]:
    """A `run[tag]` handle -> a validated `SeriesRef` (+ its optional step).

    Raw (non-`DataRef`) data has no card-spec representation today — a
    `SeriesRef` is inherently `(runId, name)`, a pointer into
    server-tracked data, and the schema has no inline-data variant yet. This
    is the WS-INLINE inline-data render path (design spec §6.3), explicitly
    deferred: raise a clear, actionable error rather than doing something
    silently wrong.
    """
    if isinstance(data, DataRef):
        ref = SeriesRef(runId=data.run_id, name=data.tag)
        return ref, data.step
    raise NotImplementedError(
        f"cairn.plot.{builder}(...): raw array/image/bytes data has no "
        "card-spec representation yet (a card `series` entry is a pointer "
        "into server-tracked data — `(runId, name)` — and the "
        "schema has no inline-data variant). This is the WS-INLINE "
        "inline-data render path, deferred — see "
        "docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md "
        "§6.3. Track the data to a run first (`run.track(data, name=...)`) "
        "and pass `run[tag]` instead, e.g. "
        f"`cairn.plot.{builder}(run[\"{{tag}}\"])`."
    )


def _backend_of(source: Any) -> Any:
    """The `_LocalBackend`/`_HttpBackend` behind a `DataRef`'s `Run`, if any."""
    return getattr(getattr(source, "run", None), "_backend", None)


def _repo_path_of(source: Any) -> str | None:
    """Best-effort local ``.cairn`` dir behind a `DataRef`'s `Run`, or
    `None` (HTTP-backed readers, or anything unexpected).

    Threaded into `CardElement(repo_path=...)` so `_resolve_server()` can
    look up *this specific repo's* `servers.json` advertisement instead of
    only the process-global `cairn.configure`/`CAIRN_REPO` state — the
    notebook may be reading a repo that was never `configure()`-d at all.
    """
    return getattr(_backend_of(source), "repo_path", None)


def _server_url_of(source: Any) -> str | None:
    """Best-effort HTTP base behind a `DataRef`'s `Run` when its `Reader`
    was opened in server mode (``Reader(repo="cairn://host:port")``), else
    `None`.

    Threaded into `CardElement(server=...)` so a card renders against the
    SAME server the reader queried — the reader "found" the runs there, so
    the card must resolve there too, with no `cairn.configure`/`CAIRN_REPO`
    needed."""
    return getattr(_backend_of(source), "server_url", None)


def _card_element(
    card_type: str,
    sources: Sequence[Any],
    *,
    builder: str,
    settings: dict[str, Any] | None = None,
) -> CardElement:
    """Build + schema-validate one `CardSpec` from `run[tag]` sources, and
    wrap it in the server-backed `CardElement` display object."""
    series: list[SeriesRef] = []
    step: int | None = None
    repo_path: str | None = None
    reader_server: str | None = None
    for source in sources:
        ref, source_step = _resolve_series(source, builder=builder)
        series.append(ref)
        if step is None and source_step is not None:
            step = source_step
        if repo_path is None:
            repo_path = _repo_path_of(source)
        if reader_server is None:
            reader_server = _server_url_of(source)

    merged_settings = dict(settings or {})
    if step is not None:
        merged_settings.setdefault("step", float(step))
    settings_obj = CardSettingsSpec(**merged_settings) if merged_settings else None

    spec = CardSpec(id=str(_uuid.uuid4()), type=card_type, series=series, settings=settings_obj)
    return CardElement(
        spec.model_dump(exclude_none=True, mode="json"),
        reader_server=reader_server,
        repo_path=repo_path,
    )


def media_compare(*sources: Any, card_type: str = "image") -> Any:
    """Show several `run[tag]` media sources side by side in one card.

    One pane per source, with zoom (images) or camera (3D) kept together
    across panes. `card_type` is the kind the sources are: ``"image"``
    (default), ``"mesh"``, ``"pointcloud"``, ``"volume"`` or ``"boxes3d"``.
    """
    if len(sources) < 1:
        raise ValueError("media_compare needs at least one source")
    return _card_element(card_type, sources, builder="media_compare")


def image_compare(a: Any, b: Any) -> Any:
    """Compare two images.

    Two tags of the same run become one pane split by a draggable divider:
    ``a`` on the left, ``b`` (the card's reference tag) on the right. Images
    from different runs are shown side by side instead.
    """
    same_run = isinstance(a, DataRef) and isinstance(b, DataRef) and a.run_id == b.run_id
    if not same_run:
        return media_compare(a, b, card_type="image")
    reference = {"name": b.tag}
    if b.step is not None:
        reference_step = {"referenceStep": b.step}
    else:
        reference_step = {}
    return _card_element(
        "image", [a], builder="image_compare", settings={"reference": reference, **reference_step}
    )


def mesh_compare(a: Any, b: Any) -> Any:
    """Two meshes side by side, cameras kept together."""
    return media_compare(a, b, card_type="mesh")


def pointcloud_compare(a: Any, b: Any) -> Any:
    """Two point clouds side by side, cameras kept together."""
    return media_compare(a, b, card_type="pointcloud")


def volume_compare(a: Any, b: Any) -> Any:
    """Two volumes side by side (the viewer offers volumes as downloads)."""
    return media_compare(a, b, card_type="volume")


def boxes_compare(a: Any, b: Any) -> Any:
    """Two 3D-box scenes side by side, cameras kept together."""
    return media_compare(a, b, card_type="boxes3d")
